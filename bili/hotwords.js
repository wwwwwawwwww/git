// 弹幕热词挖掘 v3：清洗高级弹幕前缀 + 用"跨视频覆盖"过滤掉单一视频的私货梗
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'danmaku.json'), 'utf8'));

const STOP = new Set(`这个 那个 一个 一次 一点 一样 一定 一直 一起 一下 一些 我的 你的 他的 她的 我们 你们 他们 大家 自己
就是 还是 什么 怎么 这么 那么 真的 真是 有点 有些 出来 来了 好的 了吗 好了 没有 不是 这是 这里 那里 现在 已经
可以 应该 因为 所以 但是 如果 然后 还有 时候 感觉 知道 看到 听到 觉得 不会 不能 不要 左边 右边 前面 后面 上面
下面 第一 分钟 弹幕 视频 屏幕 空降 高能 预警 打卡 前排 路过 的时 之 了 的 是 我 你 他 她 它 们 在 这 那 有 和
与 就 都 也 还 又 很 太 更 最 不 没 要 会 能 想 说 看 听 来 去 上 下 里 外 好 吧 啊 呀 呢 吗 哦 嗯 哈 该 会 让
给 到 从 向 对 为 以 于 及 但 却 才 再 已 曾 将 正 越 挺 蛮 多 少 快 慢 大 小 高 低 很 更 挺 真 挺 挺
不过 有一 人的 的一 这一 了一 的是 是我 是你 哈哈 哈哈哈 哈哈哈哈哈 哈哈哈哈哈 哈哈哈哈哈哈 哈哈哈哈哈哈
是什么 为什么 怎么这么 真的真的 可以可以 好看 好听 厉害 牛逼 优秀 喜欢 加油 谢谢 支持 作者 up 主 UP 主 视频里`.split(/\s+/).filter(Boolean));

const clean = (s) => s
  .replace(/^\s*\[[^\]]*\]/, '')                 // 高级弹幕样式前缀 [0,0,"1-1",4,"SimHei",...]
  .replace(/^[0-9]{3,}/, '')                      // 残留数字串
  .replace(/[\s\u3000]+/g, '')
  .replace(/[\[\]【】（）()「」《》<>~～!！?？。，,.、:：;；'"“”‘’…—\-_=+*#@%&/\\|]+/g, '');

// 每段文本记下出现在几个不同视频里
const texts = []; // {t, vi}
data.forEach((v, vi) => {
  for (const raw of v.list) {
    const c = clean(raw);
    if (c.length >= 2) texts.push({ t: c, vi });
  }
});
const titles = data.map((v) => clean(v.title || ''));
const isTitleWater = (g) => titles.some((t) => t.includes(g));

const gramVideos = new Map(); // gram -> Set(video)
const gramDf = new Map();
function addGram(g, vi) {
  if (!gramVideos.has(g)) gramVideos.set(g, new Set());
  gramVideos.get(g).add(vi);
}
for (const { t, vi } of texts) {
  const seen = new Set();
  for (let n = 2; n <= 6; n++)
    for (let i = 0; i + n <= t.length; i++) seen.add(t.slice(i, i + n));
  for (const g of seen) { addGram(g, vi); gramDf.set(g, (gramDf.get(g) || 0) + 1); }
}

const ok = (g) => !STOP.has(g) && !isTitleWater(g) && /[\u4e00-\u9fa5]/.test(g) && !/^[0-9a-zA-Z]+$/.test(g);
const cands = [...gramDf.entries()]
  .filter(([g, c]) => c >= 6 && gramVideos.get(g).size >= 2 && ok(g));
const kept = cands.filter(([g, c]) =>
  !cands.some(([g2, c2]) => g2.length > g.length && g2.includes(g) && c2 >= c * 0.8));
kept.sort((a, b) => gramVideos.get(b[0]).size - gramVideos.get(a[0]).size || b[1] - a[1]);

console.log(`样本：${data.length} 个视频 / ${texts.length} 条弹幕\n`);
console.log('===== 跨视频通用热词（视频数 / 弹幕数 / 例句） =====');
for (const [g, c] of kept.slice(0, 40)) {
  const ex = texts.find((x) => x.t.includes(g));
  console.log(`${String(gramVideos.get(g).size).padStart(2)}视频 ${String(c).padStart(3)}条  ${g.padEnd(7)} ← ${ex.t.slice(0, 30)}`);
}

console.log('\n===== 全站通用整句（出现≥3次，且跨视频） =====');
const fq = new Map(); // text -> {c, vids:Set}
for (const { t, vi } of texts) {
  if (!fq.has(t)) fq.set(t, { c: 0, vids: new Set() });
  const o = fq.get(t); o.c++; o.vids.add(vi);
}
for (const [k, o] of [...fq.entries()].filter(([, o]) => o.c >= 3 && o.vids.size >= 2).sort((a, b) => b[1].c - a[1].c).slice(0, 20))
  console.log(`${String(o.vids.size).padStart(2)}视频 ${String(o.c).padStart(3)}条  ${k.slice(0, 34)}`);

console.log('\n===== 单一视频的私货梗（≥8次，仅供参考） =====');
for (const [k, o] of [...fq.entries()].filter(([, o]) => o.c >= 8 && o.vids.size === 1).sort((a, b) => b[1].c - a[1].c).slice(0, 15)) {
  const vi = [...o.vids][0];
  console.log(`${String(o.c).padStart(3)}条  ${k.slice(0, 24).padEnd(26)} @${data[vi].title.slice(0, 16)}`);
}
