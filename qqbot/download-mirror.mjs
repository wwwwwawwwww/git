import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const assetName = 'NapCat.Shell.zip';
const dest = path.join(HERE, assetName);

const api = await fetch('https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest', {
  headers: { 'user-agent': 'dsh' },
}).then((r) => r.json());
const asset = api.assets.find((a) => a.name === assetName);
if (!asset) throw new Error('asset not found');
const official = (asset.digest || '').replace(/^sha256:/, '').toLowerCase();
console.log('official sha256=', official || '(none)');

const mirrors = [
  'https://ghfast.top/https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/' + assetName,
  'https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/' + assetName,
  'https://ghproxy.net/https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/' + assetName,
  'https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/' + assetName,
];

for (const url of mirrors) {
  try {
    console.log('try ' + url);
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
    const size = fs.statSync(dest).size;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    console.log('downloaded size=' + size + ' sha256=' + hash);
    if (official && hash !== official) {
      console.log('SHA256 MISMATCH — removing file');
      fs.unlinkSync(dest);
      continue;
    }
    console.log('verified ok');
    process.exit(0);
  } catch (e) {
    console.log('failed: ' + (e && e.message));
  }
}
process.exit(1);
