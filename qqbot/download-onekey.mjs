import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const assetName = 'NapCat.Shell.Windows.OneKey.zip';
const dest = path.join(HERE, assetName);

const api = await fetch('https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest', {
  headers: { 'user-agent': 'dsh' },
}).then((r) => r.json());
const asset = api.assets.find((a) => a.name === assetName);
const official = (asset.digest || '').replace(/^sha256:/, '').toLowerCase();
console.log('official sha256=', official || '(none)');

const url = 'https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/' + assetName;
const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
if (!r.ok) throw new Error('HTTP ' + r.status);
await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
console.log('size=' + fs.statSync(dest).size + ' sha256=' + hash);
if (official && hash !== official) {
  fs.unlinkSync(dest);
  throw new Error('SHA256 mismatch');
}
console.log('verified ok');
