// 用 B 站 web 端接口"刷"首页推荐流（无需登录，wbi 签名）
// 用法: node feed.js [页数=3] [--json out.json]
const crypto = require('crypto');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function eatCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
async function get(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer: 'https://www.bilibili.com/',
      'accept-language': 'zh-CN,zh;q=0.9',
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
  });
  eatCookies(res);
  return res.json();
}
const mixinKey = (i, s) => TAB.map((x) => (i + s)[x]).join('').slice(0, 32);
function wbiSign(params, imgKey, subKey) {
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(p).sort().map((k) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`
  ).join('&');
  const w_rid = crypto.createHash('md5').update(query + mixinKey(imgKey, subKey)).digest('hex');
  return `${query}&w_rid=${w_rid}`;
}
const wan = (n) => (n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));

(async () => {
  const pages = Math.max(1, Math.min(10, parseInt(process.argv[2] || '3', 10) || 3));
  const startPage = Math.max(1, parseInt(process.argv[3] || '1', 10) || 1);
  const jsonAt = process.argv.indexOf('--json');
  const outFile = jsonAt > 0 ? process.argv[jsonAt + 1] : null;

  await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA } }).then(eatCookies).catch(() => {});
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  const { img_url, sub_url } = nav.data.wbi_img;
  const imgKey = img_url.split('/').pop().split('.')[0];
  const subKey = sub_url.split('/').pop().split('.')[0];

  const seen = new Map();
  for (let idx = startPage; idx < startPage + pages; idx++) {
    const q = wbiSign({
      web_location: '1430650', y_num: 5, fresh_type: 4, feed_version: 'V8',
      fresh_idx: idx, fresh_idx_1h: idx, fetch_row: idx, ps: 12,
    }, imgKey, subKey);
    const feed = await get(`https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?${q}`);
    const items = feed?.data?.item || [];
    console.log(`— 第 ${idx} 页 code=${feed.code} 条数=${items.length}`);
    for (const v of items) {
      if (!v.bvid || !v.title || seen.has(v.bvid)) continue;
      seen.set(v.bvid, {
        bvid: v.bvid, title: v.title.trim(), up: v.owner?.name, mid: v.owner?.mid,
        view: v.stat?.view || 0, danmaku: v.stat?.danmaku || 0, like: v.stat?.like || 0,
        duration: v.duration || 0, tname: v.tname || '', pubdate: v.pubdate || 0,
        desc: (v.desc || '').slice(0, 160),
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const list = [...seen.values()];
  list.sort((a, b) => b.view - a.view);
  console.log(`\n共刷到 ${list.length} 个不重复视频（按播放排序）：\n`);
  for (const [i, v] of list.entries()) {
    console.log(`${String(i + 1).padStart(2)}. ${v.title}`);
    console.log(`    ${v.up} | ${wan(v.view)}播放 ${wan(v.danmaku)}弹幕 | ${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')} | ${v.tname} | ${v.bvid}`);
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(list, null, 2), 'utf8');
})().catch((e) => console.error('FAIL', e));
