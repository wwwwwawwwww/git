// 拉取 B 站弹幕（protobuf 接口 seg.so），按视频汇总成 JSON
// 用法: node danmaku.js [--segs 4] BV1xxx BV2xxx ...
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function eatCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
const headers = () => ({ 'user-agent': UA, referer: 'https://www.bilibili.com/', ...(jar.size ? { cookie: cookieHeader() } : {}) });
async function getJson(url) {
  const res = await fetch(url, { headers: headers() });
  eatCookies(res);
  return res.json();
}

// --- 极简 protobuf 解析：只抽 DanmakuElem.content(7) ---
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do { b = buf[pos++]; result += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
  return [result, pos];
}
function parseSeg(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key; [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) { let v; [v, pos] = readVarint(buf, pos); }
    else if (wire === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      const payload = buf.subarray(pos, pos + len); pos += len;
      if (field === 1) { // DanmakuElem
        let p = 0, content = '';
        while (p < payload.length) {
          let k2; [k2, p] = readVarint(payload, p);
          const f2 = Math.floor(k2 / 8), w2 = k2 & 7;
          if (w2 === 0) { let v; [v, p] = readVarint(payload, p); }
          else if (w2 === 2) {
            let l2; [l2, p] = readVarint(payload, p);
            const sub = payload.subarray(p, p + l2); p += l2;
            if (f2 === 7) content = sub.toString('utf8');
          } else if (w2 === 5) p += 4;
          else if (w2 === 1) p += 8;
          else break;
        }
        if (content) out.push(content);
      }
    } else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else break;
  }
  return out;
}

(async () => {
  const segs = process.argv.includes('--segs') ? parseInt(process.argv[process.argv.indexOf('--segs') + 1], 10) : 4;
  const bvids = process.argv.slice(2).filter((a) => a.startsWith('BV'));
  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});

  const DB = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : path.join(__dirname, 'danmaku.json');
  const merge = process.argv.includes('--merge');
  const all = merge && fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : [];
  for (const bv of bvids) {
    const v = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`);
    if (v.code !== 0) { console.log(`${bv} 失败 ${v.message}`); continue; }
    const { cid, aid, title, duration } = v.data;
    const dm = [];
    const nSeg = Math.min(segs, Math.max(1, Math.ceil(duration / 360)));
    for (let i = 1; i <= nSeg; i++) {
      const url = `https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid=${cid}&pid=${aid}&segment_index=${i}`;
      const res = await fetch(url, { headers: headers() });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      const got = parseSeg(buf);
      dm.push(...got);
      await new Promise((r) => setTimeout(r, 250));
    }
    const uniq = new Set(dm);
    console.log(`✓ ${title.slice(0, 30)} | 弹幕 ${dm.length} 条 / 去重 ${uniq.size} | ${bv}`);
    all.push({ bvid: bv, title, count: dm.length, uniq: uniq.size, list: dm });
  }
  const dedup = new Map(all.map((a) => [a.bvid, a]));
  fs.writeFileSync(DB, JSON.stringify([...dedup.values()], null, 1), 'utf8');
  console.log(`\n库内 ${dedup.size} 个视频 / ${[...dedup.values()].reduce((s, a) => s + a.count, 0)} 条弹幕`);
})().catch((e) => console.error('FAIL', e));
