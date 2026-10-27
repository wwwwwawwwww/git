import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(HERE, 'onekey', 'QQ.exe');
const official =
  'https://qqdl.gtimg.cn/qqfile/QQNT/9.9.33/release/497e2f1f/QQ_9.9.33_260813_x64_01.exe';
const mirror =
  'https://gh-proxy.com/https://github.com/Rodert/qq-versions/releases/download/qq-packages-20260813-1d08f1d4/QQ_9.9.33_260813_x64_01.exe';

for (const [label, url] of [
  ['official', official],
  ['mirror', mirror],
]) {
  try {
    console.log('try ' + label + ' ...');
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = Number(r.headers.get('content-length') || 0);
    console.log('content-length=' + total);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
    const size = fs.statSync(dest).size;
    console.log('done size=' + size);
    if (total && size !== total) throw new Error('size mismatch');
    process.exit(0);
  } catch (e) {
    console.log('failed: ' + (e && e.message));
    try { fs.unlinkSync(dest); } catch {}
  }
}
process.exit(1);
