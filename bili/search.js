// B站 wbi 搜索：按关键词搜视频，输出播放/弹幕/评论数
// 用法: node search.js "关键词1" "关键词2" ... [--page 1]
const crypto = require('crypto');
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
const wan = (n) => (n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n || 0));
const strip = (s) => (s || '').replace(/<[^>]+>/g, '');

(async () => {
  const kw = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const page = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : 1;
  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  const imgKey = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const subKey = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];

  for (const k of kw) {
    const q = wbiSign({ search_type: 'video', keyword: k, page: String(page), page_size: '20', order: 'totalrank' }, imgKey, subKey);
    const r = await get(`https://api.bilibili.com/x/web-interface/wbi/search/type?${q}`);
    console.log(`\n===== 搜索「${k}」 code=${r.code} ${r.code !== 0 ? r.message : ''}`);
    const list = r?.data?.result || [];
    if (!list.length) { console.log(r?.data?.v_voucher || '无结果'); continue; }
    for (const [i, v] of list.slice(0, 12).entries()) {
      console.log(`${String(i + 1).padStart(2)}. ${strip(v.title).slice(0, 46)}`);
      console.log(`    ${v.author} | ${wan(v.play)}播放 ${wan(v.video_review)}弹幕 ${wan(v.favorites)}收藏 | ${v.duration} | ${v.bvid}`);
    }
    await new Promise((r2) => setTimeout(r2, 700));
  }
})().catch((e) => console.error('FAIL', e));
