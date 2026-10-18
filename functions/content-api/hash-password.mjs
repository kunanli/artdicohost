import { hashPassword } from './auth.mjs';

// Read only stdin: passwords must not be embedded in command arguments or files.
if (process.argv.length > 2) {
  console.error('请通过标准输入提供密码，不要使用命令行参数。');
  process.exitCode = 1;
} else {
  const parts = [];
  let length = 0;
  try {
    for await (const part of process.stdin) {
      length += part.length;
      if (length > 1026) throw new TypeError('密码过长。');
      parts.push(part);
    }
    const password = Buffer.concat(parts).toString('utf8').replace(/\r?\n$/u, '');
    console.log(await hashPassword(password));
  } catch {
    console.error('无法生成摘要；请通过标准输入提供 12–1024 字节密码。');
    process.exitCode = 1;
  } finally {
    for (const part of parts) part.fill(0);
  }
}
