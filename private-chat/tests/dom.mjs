/**
 * 前端 DOM 集成测试（jsdom，无需真实浏览器）
 *
 * 用同一份 index.html + app.js + crypto.js 跑一遍：
 * 欢迎页 → 创建房间 → 进入聊天 → 发消息 → 搜索 → 设置页。
 * 服务器真的起在本地，HTTP 和 SSE 都走真实接口。
 *
 * 运行：node tests/dom.mjs
 */
import { JSDOM } from 'jsdom';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'dsh-chat-dom-'));
const py = process.env.PYTHON || 'python';
const HTML = readFileSync(join(ROOT, 'app', 'web', 'index.html'), 'utf8');

const server = spawn(py, ['app/server.py', '--port', String(PORT), '--data-dir', dataDir], {
  cwd: ROOT,
  stdio: 'ignore',
  windowsHide: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch.bind(globalThis);
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

async function waitHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('服务器没起来');
}

async function main() {
  await waitHealth();
  console.log(`服务器已启动: ${BASE}\n`);

  const dom = new JSDOM(HTML, {
    url: BASE + '/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const doc = window.document;

  // ---- 浏览器环境垫片 ----
  let cookie = '';
  async function testFetch(input, init = {}) {
    const url = typeof input === 'string' ? new URL(input, BASE).href : input.url;
    const headers = new Headers(init.headers || {});
    if (cookie) headers.set('Cookie', cookie);
    const res = await realFetch(url, { ...init, headers });
    const sc = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const item of sc) {
      const m = /^dsh_sid=([^;]+)/.exec(item);
      if (m) cookie = 'dsh_sid=' + m[1];
    }
    return res;
  }

  class FakeEventSource extends window.EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      this.readyState = 0;
      this._start();
    }
    close() {
      this.closed = true;
      this.readyState = 2;
      if (this.ctrl) this.ctrl.abort();
    }
    async _start() {
      this.ctrl = new AbortController();
      try {
        const res = await testFetch(this.url, {
          headers: { Accept: 'text/event-stream' },
          signal: this.ctrl.signal,
        });
        if (!res.ok) {
          this.dispatchEvent(new window.Event('error'));
          return;
        }
        this.readyState = 1;
        this.dispatchEvent(new window.Event('open'));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7);
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if (!data) continue;
            const ev = new window.Event(event);
            ev.data = data;
            this.dispatchEvent(ev);
          }
        }
      } catch (e) {
        if (!this.closed) this.dispatchEvent(new window.Event('error'));
      }
    }
  }

  class FakeIntersectionObserver {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
    unobserve() {}
    disconnect() {}
  }

  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.URL.createObjectURL = () => 'blob:jsdom';
  window.URL.revokeObjectURL = () => {};
  try {
    Object.defineProperty(window, 'isSecureContext', { value: true });
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
  } catch {}

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error?.stack || e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  global.window = window;
  global.document = doc;
  global.location = window.location;
  global.history = window.history;
  global.localStorage = window.localStorage;
  global.Event = window.Event;
  global.SubmitEvent = window.SubmitEvent || window.Event;
  global.EventSource = FakeEventSource;
  global.IntersectionObserver = FakeIntersectionObserver;
  global.fetch = testFetch;
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  await import('../app/web/app.js?dom=' + Date.now());

  const waitFor = async (fn, timeout = 30000, label = '') => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await fn()) return;
      } catch {}
      await sleep(100);
    }
    throw new Error('等待超时: ' + label);
  };
  const visible = (id) => !doc.getElementById(id).classList.contains('hidden');

  await check('欢迎页出现', async () => {
    await waitFor(() => visible('screen-welcome'), 15000, '欢迎页');
    if (!visible('screen-boot') === false) { /* boot 隐藏 */ }
    if (!doc.getElementById('screen-boot').classList.contains('hidden')) throw new Error('boot 没隐藏');
  });

  await check('创建房间并进入聊天', async () => {
    const set = (id, v) => {
      const el = doc.getElementById(id);
      el.value = v;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    set('create-room-name', '鱼缸');
    set('create-name', '阿鱼');
    set('create-password', 'Fish-Bowl-2026!strong');
    set('create-password2', 'Fish-Bowl-2026!strong');
    const form = doc.getElementById('form-create');
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new window.SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => visible('screen-chat'), 60000, '进入聊天');
    const title = doc.getElementById('room-title').textContent;
    if (title !== '鱼缸') throw new Error('房间名不对: ' + title);
  });

  await check('生成一次性邀请链接', async () => {
    await waitFor(() => doc.getElementById('invite-link').value.length > 20, 15000, '邀请链接');
    const link = doc.getElementById('invite-link').value;
    if (!link.includes('#/join?') || !link.includes('&k=')) throw new Error('链接格式不对: ' + link);
    doc.querySelector('[data-close-sheet="sheet-invite"]').click();
  });

  await check('发送并渲染加密消息', async () => {
    const input = doc.getElementById('input');
    input.value = '你好，铲屎官 🐳';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.getElementById('btn-send').click();
    await waitFor(
      () => [...doc.querySelectorAll('.msg.self .bubble')].some((b) => b.textContent.includes('你好，铲屎官')),
      15000,
      '自己的消息',
    );
    await waitFor(
      () => ![...doc.querySelectorAll('.msg.self .tick')].some((t) => t.textContent.includes('发送中')),
      15000,
      '发送完成',
    );
    const tick = doc.querySelector('.msg.self .tick');
    if (!tick || tick.textContent !== '✓') throw new Error('送达状态不对: ' + (tick && tick.textContent));
  });

  await check('设置页信息完整', async () => {
    doc.getElementById('btn-settings').click();
    await waitFor(() => visible('sheet-settings'), 5000, '设置页');
    const code = doc.getElementById('settings-room-code').textContent;
    if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code)) throw new Error('房间码不对: ' + code);
    const fp = doc.getElementById('settings-fingerprint').textContent;
    if (!/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/.test(fp)) throw new Error('指纹不对: ' + fp);
    const members = doc.getElementById('settings-member-count').textContent;
    if (!members.includes('1 / 2')) throw new Error('成员数不对: ' + members);
    doc.querySelector('[data-close-sheet="sheet-settings"]').click();
  });

  await check('搜索能命中已解密消息', async () => {
    doc.getElementById('btn-search').click();
    await waitFor(() => visible('sheet-search'), 5000, '搜索页');
    const input = doc.getElementById('search-input');
    input.value = '铲屎官';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await waitFor(() => doc.querySelectorAll('.search-result').length > 0, 5000, '搜索结果');
    if (!doc.querySelector('.search-result').textContent.includes('你好')) {
      throw new Error('搜索结果内容不对');
    }
    doc.querySelector('[data-close-sheet="sheet-search"]').click();
  });

  await check('本地存储里有房间和密钥', async () => {
    const room = JSON.parse(window.localStorage.getItem('dsh.room.v1') || 'null');
    if (!room || !room.roomId) throw new Error('没有房间信息');
    const key = window.localStorage.getItem('dsh.key.v1.' + room.roomId);
    if (!key) throw new Error('没有本地密钥');
    const fp = window.localStorage.getItem('dsh.fp.v1.' + room.roomId);
    if (!fp) throw new Error('没有指纹');
  });

  await check('没有未捕获的前端异常', async () => {
    await sleep(500);
    if (errors.length) throw new Error(errors.join('\n'));
  });

  console.log(`\n${passed} 项通过${failed ? `，${failed} 项失败` : ''}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    server.kill();
    await sleep(300);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    process.exit(process.exitCode || 0);
  });
