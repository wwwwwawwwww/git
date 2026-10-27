/**
 * 前端流程测试：邀请加入 / 房间码登录 / 本机解锁
 * 每个场景都起独立 JSDOM 页面，但共用同一个真实服务端。
 *
 * 运行：node tests/dom-flows.mjs
 */
import { JSDOM } from 'jsdom';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  randomB64, randomBytes, makeSalt, kdfKeys, wrapMasterKey,
  sealPayload, b64urlEncode, bytesToHex, sha256, utf8,
} from '../app/web/crypto.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8980 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const ITER = 100000;
const dataDir = mkdtempSync(join(tmpdir(), 'dsh-chat-flows-'));
const py = process.env.PYTHON || 'python';
const HTML = readFileSync(join(ROOT, 'app', 'web', 'index.html'), 'utf8');
const realFetch = globalThis.fetch.bind(globalThis);

const server = spawn(py, ['app/server.py', '--port', String(PORT), '--data-dir', dataDir], {
  cwd: ROOT,
  stdio: 'ignore',
  windowsHide: true,
});

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

async function waitHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await realFetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('服务器没起来');
}

async function apiJson(path, { method = 'GET', body, cookie = '' } = {}) {
  const headers = { 'X-Dsh': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await realFetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

async function createRoomViaApi(password, memberName = '阿鱼') {
  const roomId = randomB64(16);
  const master = randomBytes(32);
  const salt = makeSalt();
  const keys = kdfKeys(password, salt, ITER);
  const wrapped = wrapMasterKey(master, keys.wrapKey, roomId, memberName);
  const nameEnc = sealPayload(master, `dsh-chat-room-name-v1|${roomId}`, { name: '鱼缸' });
  const inviteCode = randomB64(32);
  const inviteHash = bytesToHex(sha256(utf8(inviteCode)));
  const { res, data } = await apiJson('/api/rooms', {
    method: 'POST',
    body: {
      roomId,
      roomName: { nonce: nameEnc.nonce, ct: nameEnc.ct },
      memberName,
      color: '#4f8cff',
      salt: b64urlEncode(salt),
      iterations: ITER,
      authKey: bytesToHex(keys.authKey),
      wrapped: { nonce: b64urlEncode(wrapped.nonce), ct: b64urlEncode(wrapped.ct) },
      invite: { hash: inviteHash, expiresAt: Date.now() + 86400000 },
    },
  });
  if (res.status !== 201) throw new Error('建房失败: ' + res.status + ' ' + JSON.stringify(data));
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const inviteLink = `${BASE}/#/join?r=${roomId}&c=${inviteCode}&k=${b64urlEncode(master)}`;
  return { roomId, shortCode: data.room.shortCode, memberName, password, master, keys, salt, cookie, inviteLink };
}

let cookie = '';
let pageSeq = 0;
const openSources = new Set();

async function makePage({ url = BASE + '/', roomStorage = null, cookie: initialCookie = '' } = {}) {
  cookie = initialCookie;
  const dom = new JSDOM(HTML, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const doc = window.document;

  async function testFetch(input, init = {}) {
    const u = typeof input === 'string' ? new URL(input, BASE).href : input.url;
    const headers = new Headers(init.headers || {});
    if (cookie) headers.set('Cookie', cookie);
    const res = await realFetch(u, { ...init, headers });
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
    constructor(u) {
      super();
      this.url = u;
      this.closed = false;
      this.readyState = 0;
      openSources.add(this);
      this._start();
    }
    close() {
      this.closed = true;
      this.readyState = 2;
      openSources.delete(this);
      if (this.ctrl) this.ctrl.abort();
    }
    async _start() {
      this.ctrl = new AbortController();
      try {
        const res = await testFetch(this.url, { headers: { Accept: 'text/event-stream' }, signal: this.ctrl.signal });
        if (!res.ok) { this.dispatchEvent(new window.Event('error')); return; }
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
      } catch {
        if (!this.closed) this.dispatchEvent(new window.Event('error'));
      }
    }
  }

  class FakeObserver {
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

  if (roomStorage) {
    window.localStorage.setItem('dsh.room.v1', JSON.stringify(roomStorage));
  }

  global.window = window;
  global.document = doc;
  global.location = window.location;
  global.history = window.history;
  global.localStorage = window.localStorage;
  global.Event = window.Event;
  global.SubmitEvent = window.SubmitEvent || window.Event;
  global.EventSource = FakeEventSource;
  global.IntersectionObserver = FakeObserver;
  global.fetch = testFetch;
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  await import('../app/web/app.js?flow=' + (++pageSeq));

  const waitFor = async (fn, timeout = 30000, label = '') => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await fn()) return; } catch {}
      await sleep(100);
    }
    throw new Error('等待超时: ' + label);
  };
  const visible = (id) => !doc.getElementById(id).classList.contains('hidden');
  const setValue = (id, value) => {
    const el = doc.getElementById(id);
    el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = (id) => {
    const form = doc.getElementById(id);
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new window.SubmitEvent('submit', { bubbles: true, cancelable: true }));
  };
  return { dom, window, doc, waitFor, visible, setValue, submit, errors };
}

async function closePage(page) {
  for (const es of openSources) es.close();
  openSources.clear();
  try { page.window.close(); } catch {}
  await sleep(100);
}

async function main() {
  await waitHealth();
  console.log(`服务器已启动: ${BASE}\n`);

  // ---------- 场景一：邀请链接加入 ----------
  await check('邀请链接加入房间', async () => {
    const room = await createRoomViaApi('Creator-Pass-2026!');
    const page = await makePage({ url: room.inviteLink });
    try {
      await page.waitFor(
        () => page.visible('screen-welcome') &&
          !page.doc.getElementById('join-preview').classList.contains('hidden'),
        30000,
        '邀请预览',
      );
      const preview = page.doc.getElementById('join-preview').textContent;
      if (!preview.includes('鱼缸')) throw new Error('预览里没有房间名: ' + preview);
      page.setValue('join-name', '铲屎官');
      page.setValue('join-password', 'Joiner-Pass-2026!');
      page.setValue('join-password2', 'Joiner-Pass-2026!');
      page.submit('form-join');
      await page.waitFor(() => page.visible('screen-chat'), 60000, '加入后进入聊天');
      const title = page.doc.getElementById('room-title').textContent;
      if (title !== '鱼缸') throw new Error('房间名不对: ' + title);
      if (page.doc.getElementById('presence-text').textContent.includes('等待对方加入')) {
        throw new Error('在线状态没刷新');
      }
      if (page.errors.length) throw new Error(page.errors.join('\n'));
    } finally {
      await closePage(page);
    }
  });

  // ---------- 场景二：房间码 + 昵称 + 密码登录 ----------
  await check('房间码登录', async () => {
    const room = await createRoomViaApi('Login-Pass-2026!x');
    const page = await makePage({
      roomStorage: { roomId: room.roomId, shortCode: room.shortCode, memberName: '阿鱼' },
    });
    try {
      await page.waitFor(() => page.visible('screen-welcome'), 15000, '欢迎页');
      // 没有会话时 boot 会落到登录页
      const activeTab = page.doc.querySelector('.tab.is-active');
      if (!activeTab || activeTab.dataset.tab !== 'login') throw new Error('没有切到登录页');
      page.setValue('login-room', room.shortCode);
      page.setValue('login-name', '阿鱼');
      page.setValue('login-password', 'Login-Pass-2026!x');
      page.submit('form-login');
      await page.waitFor(() => page.visible('screen-chat'), 60000, '登录后进入聊天');
      if (page.doc.getElementById('room-title').textContent !== '鱼缸') throw new Error('房间名不对');
      if (page.errors.length) throw new Error(page.errors.join('\n'));
    } finally {
      await closePage(page);
    }
  });

  // ---------- 场景三：有会话无密钥时，用密码解锁 ----------
  await check('本机解锁（会话还在、密钥不在）', async () => {
    const room = await createRoomViaApi('Unlock-Pass-2026!');
    const page = await makePage({
      roomStorage: { roomId: room.roomId, shortCode: room.shortCode, memberName: '阿鱼' },
      cookie: room.cookie,
    });
    try {
      await page.waitFor(() => page.visible('screen-unlock'), 15000, '解锁页');
      page.setValue('unlock-password', 'Unlock-Pass-2026!');
      page.submit('form-unlock');
      await page.waitFor(() => page.visible('screen-chat'), 60000, '解锁后进入聊天');
      if (page.doc.getElementById('room-title').textContent !== '鱼缸') throw new Error('房间名不对');
      if (page.errors.length) throw new Error(page.errors.join('\n'));
    } finally {
      await closePage(page);
    }
  });

  console.log(`\n${passed} 项通过${failed ? `，${failed} 项失败` : ''}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    for (const es of openSources) es.close();
    server.kill();
    await sleep(300);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    process.exit(process.exitCode || 0);
  });
