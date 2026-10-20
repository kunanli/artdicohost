"""Offline, verified Node bootstrap using the Python bundled with custom.debian11."""
import hashlib
import lzma
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

NODE_SHA256 = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'
MAX_COMPRESSED_BYTES = 36_000_000
MAX_RUNTIME_BYTES = 192 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024


def open_runtime(path):
    """Open just the named regular input, rejecting links in every parent."""
    path = Path(path).absolute()
    for parent in reversed(path.parents):
        if stat.S_ISLNK(parent.lstat().st_mode):
            raise ValueError('Invalid runtime input')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_COMPRESSED_BYTES:
            raise ValueError('Invalid runtime input')
        return os.fdopen(descriptor, 'rb')
    except BaseException:
        os.close(descriptor)
        raise


def decode_runtime(source, output, expected_sha256, max_bytes=MAX_RUNTIME_BYTES):
    """A single bounded XZ stream; hash original bytes before they can execute."""
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=96 * 1024 * 1024)
    digest = hashlib.sha256()
    length = 0
    header = bytearray()

    def write(block):
        nonlocal length
        length += len(block)
        if length > max_bytes:
            raise ValueError('Invalid runtime size')
        if len(header) < 64:
            header.extend(block[:64 - len(header)])
        digest.update(block)
        output.write(block)

    while True:
        block = source.read(CHUNK_BYTES)
        if not block:
            break
        if decoder.eof:
            raise ValueError('Unexpected runtime data')
        write(decoder.decompress(block, max_length=CHUNK_BYTES))
        while not decoder.needs_input and not decoder.eof:
            write(decoder.decompress(b'', max_length=CHUNK_BYTES))
        if decoder.eof and decoder.unused_data:
            raise ValueError('Unexpected runtime data')
    if not decoder.eof or decoder.check != lzma.CHECK_CRC64 or length < 64 or digest.hexdigest() != expected_sha256:
        raise ValueError('Runtime verification failed')
    if (header[:7] != b'\x7fELF\x02\x01\x01'
            or int.from_bytes(header[18:20], 'little') != 62
            or int.from_bytes(header[20:24], 'little') != 1):
        raise ValueError('Invalid runtime architecture')
    return length


def prepare_runtime(source_path, temporary_parent=Path('/tmp')):
    directory = Path(tempfile.mkdtemp(prefix='artdicohost-node-', dir=temporary_parent))
    runtime = directory / 'node'
    try:
        descriptor = os.open(runtime, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as output, open_runtime(source_path) as source:
            decode_runtime(source, output, NODE_SHA256)
            output.flush()
            os.fsync(output.fileno())
        runtime.chmod(0o700)
        return runtime
    except BaseException:
        shutil.rmtree(directory)
        raise


def main():
    # The code root and interpreter are fixed, not selected by request or environment.
    runtime = prepare_runtime(Path('/code/runtime/node/bin/node.xz'))
    try:
        os.execv(str(runtime), [str(runtime), '/code/functions/fc-api/server.mjs'])
    except BaseException:
        shutil.rmtree(runtime.parent)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FC runtime bootstrap verification failed.', file=sys.stderr)
        sys.exit(1)
