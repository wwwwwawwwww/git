import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = 'https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/NapCat.Shell.zip';
const dest = path.join(HERE, 'NapCat.Shell.zip');

for (let i = 1; i <= 3; i++) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
    console.log('ok size=' + fs.statSync(dest).size);
    process.exit(0);
  } catch (e) {
    console.log('try ' + i + ' failed: ' + (e && e.message));
    await new Promise((r) => setTimeout(r, 3000));
  }
}
process.exit(1);
