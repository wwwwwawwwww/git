// 搜索 B 站并下载封面，用来"看"大肥鱼形象
// 用法: node fetch-covers.js "关键词" [数量]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function eatCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
const H = () => ({ 'user-agent': UA, referer: 'https://www.bilibili.com/', 'accept-language': 'zh-CN,zh;q=0.9', ...(jar.size ? { cookie: cookieHeader() } : {}) });
async function get(url) { const res = await fetch(url, { headers: H() }); eatCookies(res); return res.json(); }
const mixinKey = (i, s) => TAB.map((x) => (i + s)[x]).join('').slice(0, 32);
function wbiSign(params, imgKey, subKey) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${crypto.createHash('md5').update(query + mixinKey(imgKey, subKey)).digest('hex')}`;
}
const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

(async () => {
  const kw = process.argv[2];
  const n = Number(process.argv[3] || 6);
  const dir = path.join(__dirname, 'covers');
  fs.mkdirSync(dir, { recursive: true });
  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  const imgKey = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const subKey = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  const q = wbiSign({ search_type: 'video', keyword: kw, page: '1', page_size: '30', order: 'totalrank' }, imgKey, subKey);
  const r = await get(`https://api.bilibili.com/x/web-interface/wbi/search/type?${q}`);
  const list = (r?.data?.result || []).slice(0, n);
  for (const [i, v] of list.entries()) {
    const pic = v.pic.startsWith('//') ? 'https:' + v.pic : v.pic;
    const res = await fetch(pic, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}_${v.bvid}.jpg`);
    fs.writeFileSync(file, buf);
    console.log(`${String(i + 1).padStart(2)}. ${strip(v.title).slice(0, 40)} | ${v.author} | ${file} | ${buf.length}B`);
  }
})().catch((e) => console.error('FAIL', e));
