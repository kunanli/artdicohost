import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMPRESS, INSPECT_CANDIDATE_NODE } from '../scripts/cloud-content-package.mjs';

const launcher = fileURLToPath(new URL('../functions/fc-api/launch.py', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
function python(source, input, args = []) {
  const result = spawnSync('python3', ['-I', '-S', '-c', source, launcher, ...args], {
    input, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
  });
  assert.equal(result.error, undefined, 'isolated synthetic compression check finishes within its bound');
  return result;
}
function successful(result) {
  assert.equal(result.status, 0, result.stderr?.toString() || 'isolated Python check succeeds');
  return result.stdout;
}
function syntheticElf() {
  const result = Buffer.alloc(64 + 32768 * 5);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(result);
  result.writeUInt16LE(2, 16); result.writeUInt16LE(62, 18); result.writeUInt32LE(1, 20);
  // Actual relative x86 CALL encodings to a repeated bounded target set. BCJ
  // normalizes these targets; the fixture contains no executable entry point.
  for (let index = 0; index < 32768; index++) {
    const offset = 64 + index * 5, target = 64 + index % 32 * 5;
    result[offset] = 0xe8; result.writeInt32LE(target - offset - 5, offset + 1);
  }
  return result;
}
const raw = syntheticElf();
let packed;
const produced = () => packed ??= successful(python(COMPRESS, raw));
const preamble = String.raw`
import sys
sys.dont_write_bytecode = True
assert sys.flags.isolated == 1 and sys.flags.no_site == 1
import importlib.util,io,lzma,zlib
spec=importlib.util.spec_from_file_location('_artdico_bcj_test',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
packed=sys.stdin.buffer.read()
digest=sys.argv[2]

def rejected(operation,types=(ValueError,lzma.LZMAError),message=None):
    try:
        operation()
    except types as error:
        if message is not None:
            assert message in str(error)
    else:
        raise AssertionError('Unsafe compressed runtime accepted')

def vli(data,pos):
    value=0
    for shift in range(0,63,7):
        byte=data[pos];pos+=1;value|=(byte&127)<<shift
        if not byte&128:
            return value,pos
    raise AssertionError('Invalid fixture VLI')

def filters(data):
    size=(data[12]+1)*4
    header=data[12:12+size];flags=header[1];pos=2
    if flags&64: _,pos=vli(header,pos)
    if flags&128: _,pos=vli(header,pos)
    result=[]
    for _ in range((flags&3)+1):
        identifier,pos=vli(header,pos);length,pos=vli(header,pos)
        result.append((identifier,header[pos:pos+length],pos));pos+=length
    return size,header,result

def enlarged_dictionary(data,prop):
    size,original,chain=filters(data);header=bytearray(original)
    for identifier,value,pos in chain:
        if identifier==lzma.FILTER_LZMA2:
            assert len(value)==1
            header[pos]=prop
    header[-4:]=zlib.crc32(header[:-4]).to_bytes(4,'little')
    return data[:12]+bytes(header)+data[12+size:]
`;

test('actual candidate producer uses x86 BCJ, CRC64 and the original preset-six dictionary', () => {
  const result = successful(python(preamble + String.raw`
size,header,chain=filters(packed)
assert [entry[0] for entry in chain]==[lzma.FILTER_X86,lzma.FILTER_LZMA2]
assert chain[0][1]==b''
assert chain[1][1]==bytes([22]) # LZMA2 dictionary property: 8 MiB
decoder=lzma.LZMADecompressor(format=lzma.FORMAT_XZ,memlimit=96*1024*1024)
decoded=decoder.decompress(packed)
assert decoder.eof and decoder.check==lzma.CHECK_CRC64 and not decoder.unused_data
sys.stdout.buffer.write(decoded)
`, produced(), [sha(raw)]));
  assert.deepEqual(result, raw);
  const legacy = successful(python('import lzma,sys\nsys.stdout.buffer.write(lzma.compress(sys.stdin.buffer.read(),format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC64,preset=6))', raw));
  assert.ok(produced().length < legacy.length / 2, 'BCJ transforms real relative branch operands rather than only relabeling the stream');
});

test('the unchanged launcher and candidate inspector recover exact original bytes from BCJ and legacy streams', () => {
  const legacy = successful(python('import lzma,sys\nsys.stdout.buffer.write(lzma.compress(sys.stdin.buffer.read(),format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC64,preset=6))', raw));
  for (const input of [produced(), legacy]) {
    const decoded = successful(python(preamble + String.raw`
output=io.BytesIO()
assert module.decode_runtime(io.BytesIO(packed),output,digest)==int(sys.argv[3])
sys.stdout.buffer.write(output.getvalue())
`, input, [sha(raw), String(raw.length)]));
    assert.deepEqual(decoded, raw);
    const inspected = JSON.parse(successful(python(INSPECT_CANDIDATE_NODE, input)));
    assert.equal(inspected.sha256, sha(raw)); assert.equal(inspected.bytes, raw.length);
    assert.equal(inspected.header, raw.subarray(0, 64).toString('hex'));
  }
});

test('BCJ does not bypass original SHA, x64 ELF validation or the explicit output bound', () => {
  successful(python(preamble + String.raw`
rejected(lambda:module.decode_runtime(io.BytesIO(packed),io.BytesIO(),'0'*64),message='Runtime verification failed')
output=io.BytesIO()
rejected(lambda:module.decode_runtime(io.BytesIO(packed),output,digest,max_bytes=100),message='Invalid runtime size')
assert len(output.getvalue())<=100
`, produced(), [sha(raw)]));
  const arm = Buffer.from(raw); arm.writeUInt16LE(183, 18);
  const badArchitecture = successful(python(COMPRESS, arm));
  successful(python(preamble + String.raw`
rejected(lambda:module.decode_runtime(io.BytesIO(packed),io.BytesIO(),digest),message='Invalid runtime architecture')
`, badArchitecture, [sha(arm)]));
});

test('BCJ streams retain single-stream framing and CRC64 integrity checks', () => {
  successful(python(preamble + String.raw`
for invalid in [packed[:-1],packed[:-12],packed+b'X',packed+b'\x00'*4,packed+packed]:
    rejected(lambda:module.decode_runtime(io.BytesIO(invalid),io.BytesIO(),digest))
# The footer's backward size locates the Index; its single unpadded block size
# locates the actual CRC64 bytes, so this is a checksum fault, not a header fault.
index_size=(int.from_bytes(packed[-8:-4],'little')+1)*4
index_start=len(packed)-12-index_size
assert packed[index_start]==0
count,pos=vli(packed,index_start+1);assert count==1
unpadded,pos=vli(packed,pos)
damaged=bytearray(packed);damaged[12+unpadded-8]^=1
rejected(lambda:module.decode_runtime(io.BytesIO(bytes(damaged)),io.BytesIO(),digest),types=lzma.LZMAError)
`, produced(), [sha(raw)]));
  const wrongCheck = successful(python('import lzma,sys\nsys.stdout.buffer.write(lzma.compress(sys.stdin.buffer.read(),format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC32,filters=[{"id":lzma.FILTER_X86},{"id":lzma.FILTER_LZMA2,"preset":6}]))', raw));
  successful(python(preamble + String.raw`
rejected(lambda:module.decode_runtime(io.BytesIO(packed),io.BytesIO(),digest),message='Runtime verification failed')
`, wrongCheck, [sha(raw)]));
  assert.notEqual(python(INSPECT_CANDIDATE_NODE, Buffer.concat([produced(), produced()])).status, 0);
});

test('valid XZ dictionary declarations above 96 MiB fail before producing output in both decoders', () => {
  for (const property of [30, 32]) {
    const oversized = successful(python(preamble + '\nsys.stdout.buffer.write(enlarged_dictionary(packed,int(sys.argv[3])))', produced(), [sha(raw), String(property)]));
    successful(python(preamble + String.raw`
output=io.BytesIO()
rejected(lambda:module.decode_runtime(io.BytesIO(packed),output,digest),types=lzma.LZMAError,message='Memory usage limit exceeded')
assert output.getvalue()==b''
`, oversized, [sha(raw)]));
    const inspected = python(INSPECT_CANDIDATE_NODE, oversized);
    assert.notEqual(inspected.status, 0); assert.match(inspected.stderr.toString(), /Memory usage limit exceeded/u);
  }
});
