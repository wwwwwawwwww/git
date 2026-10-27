// 拉取指定 BV 号的热评，感受一下弹幕/评论区的味道
// 用法: node comments.js BV1xxx BV2xxx ...
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function eatCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', ...(jar.size ? { cookie: cookieHeader() } : {}) } });
  eatCookies(res); return res.json();
}
const mixinKey = (i, s) => TAB.map((x) => (i + s)[x]).join('').slice(0, 32);
function wbiSign(params, imgKey, subKey) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${crypto.createHash('md5').update(query + mixinKey(imgKey, subKey)).digest('hex')}`;
}
const wan = (n) => (n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));

(async () => {
  const bvids = process.argv.slice(2).filter((a) => a.startsWith('BV'));
  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  const imgKey = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const subKey = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];

  for (const bv of bvids) {
    const v = await get(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`);
    if (v.code !== 0) { console.log(`\n${bv} 取信息失败 code=${v.code} ${v.message}`); continue; }
    const d = v.data;
    console.log(`\n=== ${d.title}`);
    console.log(`    UP:${d.owner?.name} | ${wan(d.stat.view)}播放 ${wan(d.stat.danmaku)}弹幕 ${wan(d.stat.reply)}评论 | 点赞${wan(d.stat.like)} 投币${wan(d.stat.coin)} 收藏${wan(d.stat.favorite)}`);
    console.log(`    ${(d.desc || '').replace(/\s+/g, ' ').slice(0, 120)}`);
    const q = wbiSign({ type: 1, oid: d.aid, mode: 3, plat: 1, web_location: 1315875, pagination_str: '{"offset":""}' }, imgKey, subKey);
    const c = await get(`https://api.bilibili.com/x/v2/reply/wbi/main?${q}`);
    const hots = c?.data?.replies || [];
    if (c.code !== 0) console.log(`    评论拉取失败 code=${c.code} ${c.message}`);
    for (const r of hots.slice(0, 3)) {
      const txt = (r.content?.message || '').replace(/\s+/g, ' ').slice(0, 100);
      console.log(`    💬 [${wan(r.like)}赞] ${r.member?.uname}: ${txt}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
})().catch((e) => console.error('FAIL', e));
