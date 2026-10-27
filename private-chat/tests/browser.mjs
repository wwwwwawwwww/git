/**
 * 真实浏览器端到端测试（Chromium DevTools Protocol）
 *
 * 需要 Edge，且需要能启动 Chromium 的环境（DSH 沙箱会拦命名管道，
 * 所以这个脚本要用完整权限跑）。
 *
 * 用法：先启动服务（默认 8787），再 node tests/browser.mjs
 * 环境变量：BASE、EDGE、KEEP=1（保留浏览器窗口/数据）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const KEEP = process.env.KEEP === '1';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL  ' + name);
    console.error(e && e.stack ? e.stack : e);
  }
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('WebSocket 打开超时')), 10000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WebSocket 错误')); };
      this.ws.onmessage = (ev) => this._onMessage(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      this.ws.onclose = () => {};
    });
  }

  _onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.errors.push(d.exception?.description || d.text || 'exception');
    } else if (msg.method === 'Log.entryAdded') {
      if (msg.params.entry.level === 'error') this.errors.push('LOG: ' + msg.params.entry.text);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        this.errors.push('CONSOLE: ' + text);
      }
    }
    const handlers = this.listeners.get(msg.method) || [];
    for (const fn of handlers) fn(msg.params);
  }

  send(method, params = {}) {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(payload);
    return p;
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error('页面内异常: ' + (d.exception?.description || d.text));
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 30000, label = expression) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch {}
      await sleep(150);
    }
    throw new Error('等待超时: ' + label);
  }

  async screenshot(name) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name), Buffer.from(shot.data, 'base64'));
  }
}

async function waitHttp(url, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('等待服务超时: ' + url);
}

function launchEdge(port) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-edge-'));
  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,MediaRouter',
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    '--window-size=430,900',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  return { proc, dir };
}

async function attach(port) {
  await waitHttp(`http://127.0.0.1:${port}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面 target');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  return cdp;
}

async function setMobile(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
}

function killEdge(session) {
  if (!session) return;
  try { session.proc.kill(); } catch {}
  if (!KEEP) {
    try { rmSync(session.dir, { recursive: true, force: true }); } catch {}
  }
}

const A = { session: null, cdp: null };
const B = { session: null, cdp: null };

async function main() {
  await waitHttp(`${BASE}/api/health`);
  console.log('服务在线，启动两个浏览器…\n');

  A.session = launchEdge(9333);
  B.session = launchEdge(9334);
  A.cdp = await attach(9333);
  B.cdp = await attach(9334);
  await setMobile(A.cdp);
  await setMobile(B.cdp);

  console.log('浏览器已连上\n');

  let inviteLink = '';

  await check('打开欢迎页', async () => {
    await A.cdp.send('Page.navigate', { url: BASE + '/' });
    await A.cdp.waitFor("!!document.getElementById('screen-welcome') && !document.getElementById('screen-welcome').classList.contains('hidden')", 30000, '欢迎页');
    await A.cdp.screenshot('01-welcome.png');
  });

  await check('创建房间', async () => {
    await A.cdp.eval(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('create-room-name', '鱼缸');
      set('create-name', '阿鱼');
      set('create-password', 'Fish-Bowl-2026!strong');
      set('create-password2', 'Fish-Bowl-2026!strong');
      document.getElementById('form-create').requestSubmit();
      return true;
    })()`);
    await A.cdp.waitFor("!document.getElementById('screen-chat').classList.contains('hidden')", 60000, '进入聊天');
    await A.cdp.waitFor("document.getElementById('invite-link').value.length > 20", 20000, '邀请链接');
    inviteLink = await A.cdp.eval("document.getElementById('invite-link').value");
    if (!inviteLink.includes('#/join?')) throw new Error('邀请链接格式不对: ' + inviteLink);
    const title = await A.cdp.eval("document.getElementById('room-title').textContent");
    if (title !== '鱼缸') throw new Error('房间名不对: ' + title);
  });

  await check('关闭邀请弹层并截图', async () => {
    await A.cdp.eval("document.querySelector('[data-close-sheet=\"invite\"]').click(); true");
    await sleep(350);
    await A.cdp.waitFor("!document.getElementById('empty-state').classList.contains('hidden')", 5000, '空状态');
    const debugEmpty = await A.cdp.eval(`(() => {
      const e = document.getElementById('empty-state');
      const m = document.getElementById('messages');
      const t = document.getElementById('timeline');
      const r = e.getBoundingClientRect();
      const rm = m.getBoundingClientRect();
      const rt = t.getBoundingClientRect();
      return {
        hidden: e.classList.contains('hidden'),
        display: getComputedStyle(e).display,
        text: e.textContent.trim(),
        rect: [r.x, r.y, r.width, r.height],
        msgRect: [rm.x, rm.y, rm.width, rm.height],
        msgScroll: [m.scrollTop, m.scrollHeight, m.clientHeight],
        timelineRect: [rt.x, rt.y, rt.width, rt.height],
      };
    })()`);
    if (debugEmpty.display === 'none' || debugEmpty.rect[3] < 20) {
      throw new Error('空状态没有显示: ' + JSON.stringify(debugEmpty));
    }
    await A.cdp.screenshot('02-chat-empty.png');
  });

  await check('发送第一条消息', async () => {
    await A.cdp.eval(`(() => {
      const i = document.getElementById('input');
      i.value = '你好，铲屎官 🐳';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-send').click();
      return true;
    })()`);
    await A.cdp.waitFor(
      "[...document.querySelectorAll('.msg.self .bubble')].some(b => b.textContent.includes('你好，铲屎官'))",
      15000,
      '自己的消息出现',
    );
    await A.cdp.waitFor(
      "![...document.querySelectorAll('.msg.self .tick')].some(t => t.textContent.includes('发送中'))",
      15000,
      '消息发送完成',
    );
  });

  await check('第二台设备打开邀请链接', async () => {
    await B.cdp.send('Page.navigate', { url: inviteLink });
    await B.cdp.waitFor(
      "!!document.getElementById('join-preview') && !document.getElementById('join-preview').classList.contains('hidden')",
      30000,
      '邀请预览',
    );
    await B.cdp.screenshot('03-join-preview.png');
  });

  await check('第二人加入房间', async () => {
    await B.cdp.eval(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('join-name', '铲屎官');
      set('join-password', 'Poop-Scooper-2026!');
      set('join-password2', 'Poop-Scooper-2026!');
      document.getElementById('form-join').requestSubmit();
      return true;
    })()`);
    await B.cdp.waitFor("!document.getElementById('screen-chat').classList.contains('hidden')", 60000, '第二人进入聊天');
    const title = await B.cdp.eval("document.getElementById('room-title').textContent");
    if (title !== '鱼缸') throw new Error('第二人房间名不对: ' + title);
  });

  await check('双向实时收发', async () => {
    const send = async (cdp, text) => {
      await cdp.eval(`(() => {
        const i = document.getElementById('input');
        i.value = ${JSON.stringify(text)};
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('btn-send').click();
        return true;
      })()`);
    };
    await send(B.cdp, '收到，鱼缸里见 🐠');
    await B.cdp.waitFor(
      "[...document.querySelectorAll('.msg.self .bubble')].some(b => b.textContent.includes('收到，鱼缸里见'))",
      15000, 'B 自己的消息',
    );
    await A.cdp.waitFor(
      "[...document.querySelectorAll('.msg.peer .bubble')].some(b => b.textContent.includes('收到，鱼缸里见'))",
      20000, 'A 收到 B 的消息',
    );

    await send(A.cdp, '第二条消息，测试实时推送');
    await B.cdp.waitFor(
      "[...document.querySelectorAll('.msg.peer .bubble')].some(b => b.textContent.includes('第二条消息，测试实时推送'))",
      20000, 'B 收到 A 的消息',
    );

    await A.cdp.waitFor(
      "!!document.querySelector('.msg.self .tick.read')",
      15000, '已读回执',
    );
  });

  await check('在线状态', async () => {
    await A.cdp.waitFor(
      "document.getElementById('presence-text').textContent.includes('在线')",
      15000, 'A 看到对方在线',
    );
    await B.cdp.waitFor(
      "document.getElementById('presence-text').textContent.includes('在线')",
      15000, 'B 看到对方在线',
    );
  });

  await check('正在输入提示', async () => {
    await B.cdp.eval(`(() => {
      const i = document.getElementById('input');
      i.value = '正在打字';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await A.cdp.waitFor(
      "!document.getElementById('typing').classList.contains('hidden')",
      10000, 'A 看到对方正在输入',
    );
    await B.cdp.eval("document.getElementById('input').value = ''; true");
  });

  await check('发送加密图片', async () => {
    await A.cdp.eval(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 300, 180);
      g.addColorStop(0, '#2f6fd0');
      g.addColorStop(1, '#61d4d4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 300, 180);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
      ctx.fillText('鱼缸明信片', 34, 104);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], '鱼缸明信片.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await A.cdp.waitFor(
      "[...document.querySelectorAll('.msg.self .bubble img')].some(img => img.complete && img.naturalWidth > 0)",
      30000, 'A 的图片显示',
    );
    await B.cdp.waitFor(
      "[...document.querySelectorAll('.msg.peer .bubble img')].some(img => img.complete && img.naturalWidth > 0)",
      30000, 'B 收到并解密图片',
    );
  });

  await check('刷新后自动解锁并恢复历史', async () => {
    await A.cdp.send('Page.reload', { ignoreCache: true });
    await A.cdp.waitFor("!document.getElementById('screen-chat').classList.contains('hidden')", 30000, '刷新后回到聊天');
    await A.cdp.waitFor(
      "[...document.querySelectorAll('.msg .bubble')].some(b => b.textContent.includes('你好，铲屎官'))",
      15000, '历史消息恢复',
    );
  });

  await check('截图聊天界面', async () => {
    await A.cdp.screenshot('04-chat-a.png');
    await B.cdp.screenshot('05-chat-b.png');
  });

  await check('设置页截图', async () => {
    await A.cdp.eval("document.getElementById('btn-settings').click(); true");
    await A.cdp.waitFor("!document.getElementById('sheet-settings').classList.contains('hidden')", 5000, '设置页');
    await sleep(450);
    await A.cdp.screenshot('06-settings.png');
    await A.cdp.eval("document.querySelector('[data-close-sheet=\"settings\"]').click(); true");
  });

  await check('修改密码', async () => {
    await A.cdp.eval("document.getElementById('btn-settings').click(); true");
    await A.cdp.waitFor("!document.getElementById('sheet-settings').classList.contains('hidden')", 5000, '设置页');
    await A.cdp.eval(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('pw-current', 'Fish-Bowl-2026!strong');
      set('pw-new', 'Fish-Bowl-2027!new');
      set('pw-new2', 'Fish-Bowl-2027!new');
      document.getElementById('form-password').requestSubmit();
      return true;
    })()`);
    await A.cdp.waitFor(
      "document.getElementById('toast').textContent.includes('密码已修改')",
      40000, '改密成功',
    );
    await A.cdp.eval("document.querySelector('[data-close-sheet=\"settings\"]').click(); true");
    await sleep(300);
  });

  await check('锁定本机后用新密码解锁', async () => {
    await A.cdp.eval("document.getElementById('btn-settings').click(); true");
    await A.cdp.waitFor("!document.getElementById('sheet-settings').classList.contains('hidden')", 5000, '设置页');
    await A.cdp.eval("document.getElementById('btn-lock').click(); true");
    await A.cdp.waitFor("!document.getElementById('modal-confirm').classList.contains('hidden')", 5000, '确认框');
    await A.cdp.eval("document.getElementById('confirm-ok').click(); true");
    await A.cdp.waitFor("!document.getElementById('screen-unlock').classList.contains('hidden')", 20000, '解锁页');
    await A.cdp.screenshot('07-unlock.png');
    await A.cdp.eval(`(() => {
      const el = document.getElementById('unlock-password');
      el.value = 'Fish-Bowl-2027!new';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('form-unlock').requestSubmit();
      return true;
    })()`);
    await A.cdp.waitFor("!document.getElementById('screen-chat').classList.contains('hidden')", 30000, '解锁后进入聊天');
    await A.cdp.waitFor(
      "[...document.querySelectorAll('.msg .bubble')].some(b => b.textContent.includes('第二条消息'))",
      15000, '解锁后历史消息',
    );
  });

  await check('浏览器控制台无报错', async () => {
    const noise = (e) => /favicon|net::ERR_ABORTED|Failed to load resource/i.test(e);
    const errs = [...A.cdp.errors, ...B.cdp.errors].filter((e) => !noise(e));
    if (errs.length) throw new Error('控制台报错:\n' + errs.join('\n'));
  });

  console.log(`\n${passed} 项通过${failed ? `，${failed} 项失败` : ''}`);
  console.log('截图目录: ' + SHOTS);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await sleep(300);
    killEdge(A.session);
    killEdge(B.session);
    if (!KEEP) process.exit(process.exitCode || 0);
  });
