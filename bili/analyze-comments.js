// 分析评论：按赞数取样 + 关键词聚类，输出可读摘要
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'comments-dump.json'), 'utf8'));
const all = [];
for (const v of data) for (const r of v.rows) if (r.msg && r.msg.length >= 4) all.push({ ...r, video: v.title.slice(0, 18), bvid: v.bvid });

console.log(`样本 ${all.length} 条评论 / ${data.length} 个视频\n`);

const seen = new Set();
const top = [...all].sort((a, b) => b.like - a.like).filter((r) => {
  const k = r.msg.slice(0, 18); if (seen.has(k)) return false; seen.add(k); return true;
}).slice(0, 60);
console.log('===== 高赞评论 TOP60 =====');
for (const r of top) console.log(`[${r.like}] ${r.msg.slice(0, 110)}`);

const CATS = {
  '人格/提示词': /提示词|人格|人设|设定|性格|语气|prompt/i,
  '记忆/长期': /记忆|记住|忘了|忘掉|记忆库|长期记忆|历史/,
  'token/成本': /token|省钱|花费|账单|贵|便宜|烧钱|费用|额度/,
  '插件/工具': /插件|skill|mcp|工具|配置|部署/,
  '效果吐槽': /不好用|难用|答非所问|智障|笨|幻觉|胡编|乱写|重复|卡|慢|崩溃|报错|抽风/,
  '鱼灾/刷屏': /鱼灾|刷屏|水军|评论区|封号|违规|举报|泛滥/,
  '隐私/安全': /隐私|权限|安全|密钥|key|泄露|删库|危险/,
  '期待/好评': /好用|牛|强|厉害|喜欢|爱|惊艳|爽|神器|离不开/,
};
console.log('\n===== 关键词聚类 =====');
for (const [name, re] of Object.entries(CATS)) {
  const hits = all.filter((r) => re.test(r.msg));
  console.log(`\n【${name}】${hits.length} 条`);
  for (const r of hits.sort((a, b) => b.like - a.like).slice(0, 6)) console.log(`  [${r.like}] ${r.msg.slice(0, 96)}`);
}
