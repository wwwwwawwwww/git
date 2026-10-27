// 拉评论 v2：匿名下主楼只给 3 条，改走「主楼 + 楼中楼(每楼 20 条)」多拿样本
// 用法: node dump-comments.js [--roots 6] BV1xxx ...
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function eatCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
const H = (ref = 'https://www.bilibili.com/') => ({
  'user-agent': UA, referer: ref, origin: 'https://www.bilibili.com',
  'accept-language': 'zh-CN,zh;q=0.9', ...(jar.size ? { cookie: cookieHeader() } : {}),
});
async function get(url, ref) { const res = await fetch(url, { headers: H(ref) }); eatCookies(res); return res.json(); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mixinKey = (i, s) => TAB.map((x) => (i + s)[x]).join('').slice(0, 32);
function wbiSign(p, ik, sk) {
  const q = { ...p, wts: Math.floor(Date.now() / 1000) };
  const str = Object.keys(q).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${str}&w_rid=${crypto.createHash('md5').update(str + mixinKey(ik, sk)).digest('hex')}`;
}
const flat = (s) => (s || '').replace(/@[\u4e00-\u9fa5A-Za-z0-9_\-]+/g, '').replace(/\s+/g, ' ').trim();

(async () => {
  const roots = process.argv.includes('--roots') ? parseInt(process.argv[process.argv.indexOf('--roots') + 1], 10) : 6;
  const bvids = process.argv.slice(2).filter((a) => a.startsWith('BV'));

  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});
  const spi = await get('https://api.bilibili.com/x/frontend/finger/spi');
  if (spi.code === 0) { jar.set('buvid3', spi.data.b_3); jar.set('buvid4', spi.data.b_4); }
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  const ik = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const sk = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];

  const out = [];
  for (const bv of bvids) {
    const v = await get(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`);
    if (v.code !== 0) { console.log(`${bv} 取不到: ${v.message}`); continue; }
    const { aid, title } = v.data;
    const ref = `https://www.bilibili.com/video/${bv}/`;

    // 主楼：热门(mode3) + 最新(mode2)，各给 3 条，合起来最多 6 个
    const rootMap = new Map();
    for (const mode of [3, 2]) {
      const q = wbiSign({ type: 1, oid: aid, mode, plat: 1, web_location: 333.999, pagination_str: JSON.stringify({ offset: '' }) }, ik, sk);
      const r = await get(`https://api.bilibili.com/x/v2/reply/wbi/main?${q}`, ref);
      for (const c of [...(r.data?.replies || []), ...(r.data?.top_replies || [])]) rootMap.set(c.rpid, c);
      await wait(400);
    }

    const rows = [];
    for (const c of [...rootMap.values()].slice(0, roots)) {
      rows.push({ kind: 'root', like: c.like, user: c.member?.uname, msg: flat(c.content?.message), rpid: c.rpid });
      const q2 = `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${c.rpid}&ps=20&pn=1`;
      const r2 = await get(q2, ref);
      for (const s of r2.data?.replies || []) {
        rows.push({ kind: 'sub', like: s.like, user: s.member?.uname, msg: flat(s.content?.message), rpid: s.rpid });
      }
      await wait(350);
    }
    console.log(`✓ ${title.slice(0, 32)} | 主楼 ${rootMap.size} / 评论样本 ${rows.length} | ${bv}`);
    out.push({ bvid: bv, title, aid, views: v.data.stat.view, rows });
    await wait(400);
  }
  fs.writeFileSync(path.join(__dirname, 'comments-dump.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(`\n共 ${out.reduce((s, o) => s + o.rows.length, 0)} 条 -> bili/comments-dump.json`);
})().catch((e) => console.error('FAIL', e));
