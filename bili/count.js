// 统计指定热词/梗在弹幕库里的出现次数与跨视频覆盖，并给出例句
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'danmaku.json'), 'utf8'));
const clean = (s) => s.replace(/^\s*\[[^\]]*\]/, '').replace(/^[0-9]{3,}/, '').replace(/\s+/g, '');

const rows = [];
data.forEach((v, vi) => { for (const raw of v.list) { const t = clean(raw); if (t) rows.push({ t, vi }); } });

const TERMS = process.argv.slice(2).length ? process.argv.slice(2) : `kksk 绷不住 难绷 没绷住 神了 彦祖 通透 学到了 笑死 离谱 逆天 抽象 好家伙 卧槽 我去 纳尼 请输入文本 弹幕飞过 正在刷弹幕 前排 打卡 空降 高能 前方高能 逝者安息 一路走好 绝了 破防 泪目 上头 拿捏 好活 整活 硬核 细思极恐 懂了 原来如此 给我整不会了 赛博 大冤种 显眼包 栓Q 尊嘟假嘟 松弛感 正式确诊为 那咋了 老六 双厨狂喜 血赚 亏麻了 我裂开 救命 辣眼睛 古人 杰哥 在现场 冰冰冰 心生爱慕 老地方 通透感 洗脑 循环 上头了 爷青回 破大防 感人 触景生情 弹幕护体 保护 别看我 我要来了 有被冒犯到 尴尬 社死 岁月史书 保留节目 太对味了 对味 上强度 强度 教科书级 全程高能 名场面 前方名场面 名场面预定 名画 我超 我测 我糙 awsl yyds 666 泪目了 好活当赏`.split(/\s+/).filter(Boolean);

const out = [];
for (const term of TERMS) {
  const hits = rows.filter((r) => r.t.toLowerCase().includes(term.toLowerCase()));
  if (!hits.length) continue;
  const vids = new Set(hits.map((h) => h.vi));
  out.push({ term, n: hits.length, vids: vids.size, ex: hits[Math.floor(hits.length / 2)].t.slice(0, 36) });
}
out.sort((a, b) => b.vids - a.vids || b.n - a.n);
console.log(`样本 ${rows.length} 条弹幕 / ${data.length} 个视频\n`);
for (const o of out) console.log(`${String(o.vids).padStart(2)}视频 ${String(o.n).padStart(4)}条  ${o.term.padEnd(10)} ← ${o.ex}`);
console.log('\n一条都没出现的：', TERMS.filter((t) => !out.some((o) => o.term === t)).join(' '));
