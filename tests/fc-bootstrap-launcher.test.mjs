import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../functions/fc-api/launch.py', import.meta.url));
const preamble = `
import sys
sys.dont_write_bytecode = True
assert sys.flags.isolated == 1 and sys.flags.no_site == 1
import hashlib
import importlib.util
import io
import lzma
import os
from pathlib import Path
import stat
import tempfile

spec = importlib.util.spec_from_file_location('_artdico_synthetic_launcher_test', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert sys.dont_write_bytecode

def synthetic_elf(payload=b''):
    header = bytearray(64)
    header[:7] = b'\\x7fELF\\x02\\x01\\x01'
    header[16:18] = (2).to_bytes(2, 'little')
    header[18:20] = (62).to_bytes(2, 'little')
    header[20:24] = (1).to_bytes(4, 'little')
    return bytes(header) + payload

def compressed(raw):
    return lzma.compress(raw, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=0)

def rejected(operation, types=ValueError, message=None):
    try:
        operation()
    except types as error:
        if message is not None:
            assert message in str(error), 'Unexpected rejection classification'
    else:
        raise AssertionError('Unsafe synthetic runtime was accepted')
`;

function isolatedPython(source) {
  const result = spawnSync('python3', ['-I', '-S', '-c', preamble + '\n' + source, launcher], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
  });
  assert.equal(result.error, undefined, 'isolated Python check starts and finishes within its limit');
  assert.equal(result.status, 0, result.stderr || 'isolated launcher assertions succeed');
  assert.equal(result.stdout, '', 'launcher import and synthetic checks do not log runtime data');
}

test('isolated launcher import verifies original runtime SHA independently of XZ integrity', () => {
  isolatedPython(`
raw = synthetic_elf(b'SYNTHETIC-NOT-EXECUTABLE')
packed = compressed(raw)
output = io.BytesIO()
length = module.decode_runtime(io.BytesIO(packed), output, hashlib.sha256(raw).hexdigest())
assert length == len(raw) and output.getvalue() == raw
rejected(lambda: module.decode_runtime(io.BytesIO(packed), io.BytesIO(), '0' * 64), message='Runtime verification failed')
`);
});

test('matching hashes cannot authorize an invalid ELF header or non-x64 runtime', () => {
  isolatedPython(`
raw = synthetic_elf()
mutations = [(0, 0), (4, 1), (5, 2), (6, 2), (18, 183), (20, 0)]
for index, value in mutations:
    invalid = bytearray(raw)
    invalid[index] = value
    invalid = bytes(invalid)
    rejected(lambda: module.decode_runtime(io.BytesIO(compressed(invalid)), io.BytesIO(), hashlib.sha256(invalid).hexdigest()), message='Invalid runtime architecture')
short = raw[:63]
rejected(lambda: module.decode_runtime(io.BytesIO(compressed(short)), io.BytesIO(), hashlib.sha256(short).hexdigest()), message='Runtime verification failed')
`);
});

test('only one complete XZ stream is accepted, including when its end falls on a read boundary', () => {
  isolatedPython(`
raw = synthetic_elf(b'synthetic stream framing')
packed = compressed(raw)
digest = hashlib.sha256(raw).hexdigest()
for truncated in [b'', packed[:8], packed[:-1], packed[:-12]]:
    rejected(lambda: module.decode_runtime(io.BytesIO(truncated), io.BytesIO(), digest), types=(ValueError, lzma.LZMAError))
for chunk_bytes in [7, len(packed), len(packed) * 4]:
    module.CHUNK_BYTES = chunk_bytes
    assert module.decode_runtime(io.BytesIO(packed), io.BytesIO(), digest) == len(raw)
    for trailing in [b'X', b'\\x00' * 4, packed]:
        rejected(lambda: module.decode_runtime(io.BytesIO(packed + trailing), io.BytesIO(), digest), message='Unexpected runtime data')
`);
});

test('decoded output remains within the explicit byte bound before a block is written', () => {
  isolatedPython(`
raw = synthetic_elf(b'A' * 4096)
packed = compressed(raw)
digest = hashlib.sha256(raw).hexdigest()
module.CHUNK_BYTES = 17
output = io.BytesIO()
assert module.decode_runtime(io.BytesIO(packed), output, digest, max_bytes=len(raw)) == len(raw)
assert output.getvalue() == raw
for limit in [0, 63, len(raw) - 1]:
    output = io.BytesIO()
    rejected(lambda: module.decode_runtime(io.BytesIO(packed), output, digest, max_bytes=limit), message='Invalid runtime size')
    assert len(output.getvalue()) <= limit
`);
});

test('runtime inputs must be bounded regular files with no symlink in their named path', () => {
  isolatedPython(`
with tempfile.TemporaryDirectory(prefix='artdico-launch-input-test-') as root:
    directory = Path(root)
    source = directory / 'synthetic-node.xz'
    packed = compressed(synthetic_elf())
    source.write_bytes(packed)
    with module.open_runtime(source) as stream:
        assert stream.read() == packed
    empty = directory / 'empty.xz'
    empty.write_bytes(b'')
    rejected(lambda: module.open_runtime(empty), message='Invalid runtime input')
    rejected(lambda: module.open_runtime(directory), message='Invalid runtime input')
    leaf = directory / 'linked-node.xz'
    leaf.symlink_to(source)
    rejected(lambda: module.open_runtime(leaf), types=OSError)
    real_parent = directory / 'real-parent'
    real_parent.mkdir()
    (real_parent / 'node.xz').write_bytes(packed)
    linked_parent = directory / 'linked-parent'
    linked_parent.symlink_to(real_parent, target_is_directory=True)
    rejected(lambda: module.open_runtime(linked_parent / 'node.xz'), message='Invalid runtime input')
    module.MAX_COMPRESSED_BYTES = len(packed) - 1
    rejected(lambda: module.open_runtime(source), message='Invalid runtime input')
`);
});

test('prepare_runtime uses a private directory, writes privately and makes only verified bytes executable', () => {
  isolatedPython(`
raw = synthetic_elf(b'synthetic private output')
# This override is confined to this isolated test import, never an env setting.
module.NODE_SHA256 = hashlib.sha256(raw).hexdigest()
with tempfile.TemporaryDirectory(prefix='artdico-launch-mode-test-') as root:
    directory = Path(root)
    parent = directory / 'outputs'
    parent.mkdir()
    source = directory / 'node.xz'
    source.write_bytes(compressed(raw))
    decode = module.decode_runtime
    def inspect_before_verification(stream, output, digest):
        children = list(parent.iterdir())
        assert len(children) == 1
        assert stat.S_IMODE(children[0].stat().st_mode) == 0o700
        assert stat.S_IMODE(os.fstat(output.fileno()).st_mode) == 0o600
        return decode(stream, output, digest)
    module.decode_runtime = inspect_before_verification
    previous_umask = os.umask(0)
    try:
        runtime = module.prepare_runtime(source, temporary_parent=parent)
    finally:
        os.umask(previous_umask)
    assert runtime.parent.parent == parent
    assert runtime.parent.name.startswith('artdicohost-node-')
    assert stat.S_IMODE(runtime.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(runtime.stat().st_mode) == 0o700
    assert runtime.is_file() and not runtime.is_symlink()
    assert runtime.read_bytes() == raw
    assert [path.name for path in runtime.parent.iterdir()] == ['node']
`);
});

test('prepare_runtime removes failed work directories while preserving unrelated files', () => {
  isolatedPython(`
raw = synthetic_elf(b'synthetic cleanup input')
with tempfile.TemporaryDirectory(prefix='artdico-launch-cleanup-test-') as root:
    directory = Path(root)
    parent = directory / 'outputs'
    parent.mkdir()
    sentinel = parent / 'keep.txt'
    sentinel.write_bytes(b'SYNTHETIC-PRESERVE')
    source = directory / 'node.xz'
    source.write_bytes(compressed(raw))
    def unchanged():
        assert list(parent.iterdir()) == [sentinel]
        assert sentinel.read_bytes() == b'SYNTHETIC-PRESERVE'

    module.NODE_SHA256 = '0' * 64
    rejected(lambda: module.prepare_runtime(source, temporary_parent=parent), message='Runtime verification failed')
    unchanged()
    invalid = b'X' * 64
    source.write_bytes(compressed(invalid))
    module.NODE_SHA256 = hashlib.sha256(invalid).hexdigest()
    rejected(lambda: module.prepare_runtime(source, temporary_parent=parent), message='Invalid runtime architecture')
    unchanged()
    source.write_bytes(compressed(raw))
    module.NODE_SHA256 = hashlib.sha256(raw).hexdigest()
    linked = directory / 'linked.xz'
    linked.symlink_to(source)
    rejected(lambda: module.prepare_runtime(linked, temporary_parent=parent), types=OSError)
    unchanged()

    original_decode = module.decode_runtime
    def partial_failure(stream, output, digest):
        output.write(b'SYNTHETIC-PARTIAL')
        raise RuntimeError('Synthetic partial output failure')
    module.decode_runtime = partial_failure
    rejected(lambda: module.prepare_runtime(source, temporary_parent=parent), types=RuntimeError)
    unchanged()
    module.decode_runtime = original_decode
    def failed_sync(descriptor):
        raise OSError('Synthetic fsync failure')
    module.os.fsync = failed_sync
    rejected(lambda: module.prepare_runtime(source, temporary_parent=parent), types=OSError)
    unchanged()
`);
});
