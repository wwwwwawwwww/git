/**
 * 端到端协议测试：真的起一个服务器，用和浏览器同一份 crypto.js
 * 走完 创建房间 → 邀请 → 加入 → 发消息 → 附件 → SSE → 改密码 全流程。
 *
 * 运行：node tests/e2e.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  b64urlEncode, bytesToHex, utf8,
  kdfKeys, makeSalt, wrapMasterKey, unwrapMasterKey, authProof,
  messageKey, fileKey, messageAad, sealPayload, openPayload,
  aeadSeal, aeadOpen, sha256, randomBytes, randomB64,
} from '../app/web/crypto.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8800 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const ITER = 100000;
const dataDir = mkdtempSync(join(tmpdir(), 'dsh-chat-e2e-'));
const py = process.env.PYTHON || 'python';

let passed = 0;
let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok  ' + name); })
    .catch((e) => { failed++; console.error('FAIL  ' + name); console.error(e); });
}

const serverLogFd = openSync(join(dataDir, 'server.log'), 'w');
const server = spawn(py, ['app/server.py', '--port', String(PORT), '--data-dir', dataDir], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', serverLogFd],
  windowsHide: true,
});

async function waitHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务器没起来');
}

function newClient() {
  return { cookie: null };
}

async function api(client, path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined && !(opts.body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
  }
  if (client.cookie) headers['Cookie'] = client.cookie;
  if (method !== 'GET') headers['X-Dsh'] = '1';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined
      : opts.body instanceof Uint8Array ? Buffer.from(opts.body)
      : JSON.stringify(opts.body),
  });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const sc of setCookies) {
    const m = /^dsh_sid=([^;]+)/.exec(sc);
    if (m) client.cookie = 'dsh_sid=' + m[1];
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function expectStatus(r, status, label) {
  assert.equal(r.status, status, `${label}: ${r.status} ${JSON.stringify(r.data)}`);
}

function sseStream(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async function nextEvent(wanted, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) ev = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (ev === wanted) return JSON.parse(data);
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('等待 SSE 事件超时: ' + wanted);
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SSE 读超时')), left)),
      ]);
      if (chunk.done) throw new Error('SSE 已断开');
      buf += dec.decode(chunk.value, { stream: true });
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(200);
    }
  }
}

async function main() {
  await waitHealth();
  console.log(`服务器已启动: ${BASE}，数据目录 ${dataDir}\n`);

  const roomId = randomB64(16);
  const master = randomBytes(32);
  const nameA = '阿鱼';
  const pwA = 'Fish-Bowl-2026!strong';
  const saltA = makeSalt();
  const keysA = kdfKeys(pwA, saltA, ITER);
  const wrappedA = wrapMasterKey(master, keysA.wrapKey, roomId, nameA);
  const inviteCode = randomB64(32);
  const inviteHash = bytesToHex(sha256(utf8(inviteCode)));
  const roomNameEnc = sealPayload(master, `dsh-chat-room-name-v1|${roomId}`, { name: '小鱼缸' });

  const A = newClient();
  await check('创建房间', async () => {
    const r = await api(A, '/api/rooms', {
      method: 'POST',
      body: {
        roomId,
        roomName: { nonce: roomNameEnc.nonce, ct: roomNameEnc.ct },
        memberName: nameA,
        color: '#4f8cff',
        salt: b64urlEncode(saltA),
        iterations: ITER,
        authKey: bytesToHex(keysA.authKey),
        wrapped: { nonce: b64urlEncode(wrappedA.nonce), ct: b64urlEncode(wrappedA.ct) },
        invite: { hash: inviteHash, expiresAt: Date.now() + 86400000 },
      },
    });
    expectStatus(r, 201, 'create');
    assert.match(r.data.room.shortCode, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(r.data.member.name, nameA);
    assert.equal(r.data.members.length, 1);
    assert.ok(A.cookie, '应下发会话 cookie');
  });

  let meA;
  await check('读取 /api/me 并解密房间名', async () => {
    const r = await api(A, '/api/me');
    expectStatus(r, 200, 'me');
    meA = r.data;
    const name = openPayload(master, `dsh-chat-room-name-v1|${roomId}`,
      meA.room.name.nonce, meA.room.name.ct);
    assert.equal(name.name, '小鱼缸');
    assert.equal(meA.room.shortCode.length, 8);
  });

  await check('错误密码登录失败且提示统一', async () => {
    const c = await api(newClient(), '/api/auth/challenge', {
      method: 'POST', body: { roomId, memberName: nameA },
    });
    expectStatus(c, 200, 'challenge');
    const wrongKeys = kdfKeys('wrong-password-123', b64urlDecodeSafe(c.data.salt), ITER);
    const proof = bytesToHex(authProof(wrongKeys.authKey, c.data.roomId, nameA, c.data.challengeId));
    const r = await api(newClient(), '/api/auth/login', {
      method: 'POST', body: { roomId: c.data.roomId, memberName: nameA, challengeId: c.data.challengeId, proof },
    });
    expectStatus(r, 401, 'wrong password');
    assert.equal(r.data.message, '房间码、昵称或密码不正确');
  });

  await check('正确密码登录并解出主密钥', async () => {
    const c = await api(newClient(), '/api/auth/challenge', {
      method: 'POST', body: { roomId: meA.room.shortCode, memberName: nameA },
    });
    expectStatus(c, 200, 'challenge by short code');
    assert.equal(c.data.roomId, roomId);
    const keys = kdfKeys(pwA, b64urlDecodeSafe(c.data.salt), c.data.iterations);
    const proof = bytesToHex(authProof(keys.authKey, c.data.roomId, nameA, c.data.challengeId));
    const B = newClient();
    const r = await api(B, '/api/auth/login', {
      method: 'POST',
      body: { roomId: c.data.roomId, memberName: nameA, challengeId: c.data.challengeId, proof },
    });
    expectStatus(r, 200, 'login');
    const unwrapped = unwrapMasterKey(
      { nonce: b64urlDecodeSafe(r.data.wrapped.nonce), ct: b64urlDecodeSafe(r.data.wrapped.ct) },
      keys.wrapKey, roomId, nameA,
    );
    assert.equal(bytesToHex(unwrapped), bytesToHex(master));
  });
  const A2 = newClient();
  await check('第二设备登录（供后续使用）', async () => {
    const c = await api(A2, '/api/auth/challenge', {
      method: 'POST', body: { roomId, memberName: nameA },
    });
    const keys = kdfKeys(pwA, b64urlDecodeSafe(c.data.salt), c.data.iterations);
    const proof = bytesToHex(authProof(keys.authKey, c.data.roomId, nameA, c.data.challengeId));
    const r = await api(A2, '/api/auth/login', {
      method: 'POST',
      body: { roomId, memberName: nameA, challengeId: c.data.challengeId, proof },
    });
    expectStatus(r, 200, 'login');
  });

  const msgKey = messageKey(master);
  let firstSeq;
  await check('发送并读取第一条消息', async () => {
    const clientId = randomB64(16);
    const aad = messageAad(roomId, meA.member.id, 'text', clientId);
    const p = sealPayload(msgKey, aad, { text: '你好，铲屎官 🐳' });
    const r = await api(A, '/api/messages', {
      method: 'POST',
      body: { clientId, kind: 'text', nonce: p.nonce, ct: p.ct, attachmentIds: [] },
    });
    expectStatus(r, 201, 'send');
    firstSeq = r.data.message.seq;
    assert.equal(firstSeq, 1);

    const list = await api(A, '/api/messages?after=0&limit=50');
    expectStatus(list, 200, 'messages');
    assert.equal(list.data.messages.length, 1);
    const m = list.data.messages[0];
    const payload = openPayload(msgKey, messageAad(roomId, meA.member.id, 'text', m.clientId), m.nonce, m.ct);
    assert.equal(payload.text, '你好，铲屎官 🐳');
  });

  await check('重复发送同一 clientId 幂等', async () => {
    const clientId = randomB64(16);
    const p = sealPayload(msgKey, messageAad(roomId, meA.member.id, 'text', clientId), { text: 'dup' });
    const body = { clientId, kind: 'text', nonce: p.nonce, ct: p.ct, attachmentIds: [] };
    const r1 = await api(A, '/api/messages', { method: 'POST', body });
    const r2 = await api(A, '/api/messages', { method: 'POST', body });
    expectStatus(r1, 201, 'send1');
    expectStatus(r2, 200, 'send2');
    assert.equal(r2.data.duplicate, true);
    assert.equal(r1.data.message.seq, r2.data.message.seq);
  });

  await check('邀请信息可读，房间名可解密', async () => {
    const r = await api(newClient(), `/api/invites/${inviteCode}`);
    expectStatus(r, 200, 'invite info');
    assert.equal(r.data.roomId, roomId);
    assert.equal(r.data.members.length, 1);
    const name = openPayload(master, `dsh-chat-room-name-v1|${roomId}`, r.data.name.nonce, r.data.name.ct);
    assert.equal(name.name, '小鱼缸');
  });

  const nameB = '铲屎官';
  const pwB = 'Poop-Scooper-2026!';
  const saltB = makeSalt();
  const keysB = kdfKeys(pwB, saltB, ITER);
  const wrappedB = wrapMasterKey(master, keysB.wrapKey, roomId, nameB);
  const B = newClient();
  let meB;
  await check('第二人凭邀请码加入（房间满两人）', async () => {
    const r = await api(B, '/api/rooms/join', {
      method: 'POST',
      body: {
        inviteCode,
        memberName: nameB,
        color: '#ff8a5c',
        salt: b64urlEncode(saltB),
        iterations: ITER,
        authKey: bytesToHex(keysB.authKey),
        wrapped: { nonce: b64urlEncode(wrappedB.nonce), ct: b64urlEncode(wrappedB.ct) },
      },
    });
    expectStatus(r, 201, 'join');
    meB = { member: r.data.member, room: r.data.room };
    assert.equal(r.data.members.length, 2);
    assert.ok(B.cookie);
  });

  await check('邀请码一次性：加入后失效', async () => {
    const r = await api(newClient(), `/api/invites/${inviteCode}`);
    expectStatus(r, 404, 'invite consumed');
  });

  await check('房间满后不能再生成邀请', async () => {
    const newInvite = randomB64(32);
    const hash = bytesToHex(sha256(utf8(newInvite)));
    const r = await api(A, '/api/invite', {
      method: 'POST', body: { hash, expiresAt: Date.now() + 86400000 },
    });
    expectStatus(r, 409, 'invite full');
  });

  let attachmentId, attachmentNonce, attachmentBytes, lastSeq;
  await check('加密附件上传 + 消息引用 + 对方下载解密', async () => {
    attachmentId = randomB64(16);
    attachmentNonce = randomBytes(12);
    attachmentBytes = randomBytes(2048);
    const fileAad = `dsh-chat-file-v1|${roomId}|${attachmentId}|${attachmentBytes.length}`;
    const sealed = aeadSeal(fileKey(master), attachmentNonce, utf8(fileAad), attachmentBytes);
    const up = await api(B, `/api/attachments/${attachmentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Nonce': b64urlEncode(attachmentNonce) },
      body: sealed,
    });
    expectStatus(up, 201, 'upload');

    const clientId = randomB64(16);
    const aad = messageAad(roomId, meB.member.id, 'file', clientId);
    const p = sealPayload(messageKey(master), aad, {
      text: '给你一个文件',
      fileName: '测试.txt',
      mime: 'text/plain',
      size: attachmentBytes.length,
      attachment: { id: attachmentId, nonce: b64urlEncode(attachmentNonce) },
    });
    const sent = await api(B, '/api/messages', {
      method: 'POST', body: { clientId, kind: 'file', nonce: p.nonce, ct: p.ct, attachmentIds: [attachmentId] },
    });
    expectStatus(sent, 201, 'send file message');
    lastSeq = sent.data.message.seq;

    const list = await api(A, `/api/messages?after=${firstSeq}&limit=50`);
    expectStatus(list, 200, 'fetch');
    const m = list.data.messages.find((x) => x.seq === lastSeq);
    const payload = openPayload(messageKey(master), messageAad(roomId, meB.member.id, 'file', m.clientId), m.nonce, m.ct);
    assert.equal(payload.fileName, '测试.txt');

    const dl = await fetch(`${BASE}/api/attachments/${attachmentId}`, { headers: { Cookie: A.cookie } });
    assert.equal(dl.status, 200);
    const ctBytes = new Uint8Array(await dl.arrayBuffer());
    const decrypted = aeadOpen(fileKey(master), attachmentNonce, utf8(fileAad), ctBytes);
    assert.equal(bytesToHex(decrypted), bytesToHex(attachmentBytes));
  });

  await check('SSE 实时推送新消息和已读回执', async () => {
    const ac = new AbortController();
    const res = await fetch(`${BASE}/api/events`, { headers: { Cookie: A.cookie }, signal: ac.signal });
    assert.equal(res.status, 200);
    const next = sseStream(res);
    const hello = await next('hello');
    assert.equal(hello.lastSeq, lastSeq);

    const clientId = randomB64(16);
    const p = sealPayload(msgKey, messageAad(roomId, meB.member.id, 'text', clientId), { text: '实时消息' });
    const sent = await api(B, '/api/messages', {
      method: 'POST', body: { clientId, kind: 'text', nonce: p.nonce, ct: p.ct, attachmentIds: [] },
    });
    expectStatus(sent, 201, 'send live');
    const ev = await next('message');
    assert.equal(ev.message.seq, sent.data.message.seq);
    const payload = openPayload(msgKey, messageAad(roomId, meB.member.id, 'text', clientId), ev.message.nonce, ev.message.ct);
    assert.equal(payload.text, '实时消息');

    const read = await api(B, '/api/read', { method: 'POST', body: { seq: sent.data.message.seq } });
    expectStatus(read, 200, 'read');
    const readEv = await next('read');
    assert.equal(readEv.memberId, meB.member.id);
    ac.abort();
    await sleep(300);
  });

  await check('A 改密码后新密码可登录、旧密码失效、其他会话保留', async () => {
    const newSalt = makeSalt();
    const newKeys = kdfKeys('New-Password-2026!x', newSalt, ITER);
    const newWrapped = wrapMasterKey(master, newKeys.wrapKey, roomId, nameA);
    const r = await api(A, '/api/password', {
      method: 'POST',
      body: {
        salt: b64urlEncode(newSalt),
        iterations: ITER,
        authKey: bytesToHex(newKeys.authKey),
        wrapped: { nonce: b64urlEncode(newWrapped.nonce), ct: b64urlEncode(newWrapped.ct) },
      },
    });
    expectStatus(r, 200, 'change pw');

    // 新密码
    const c = await api(newClient(), '/api/auth/challenge', { method: 'POST', body: { roomId, memberName: nameA } });
    const k = kdfKeys('New-Password-2026!x', b64urlDecodeSafe(c.data.salt), c.data.iterations);
    const proof = bytesToHex(authProof(k.authKey, c.data.roomId, nameA, c.data.challengeId));
    const ok = await api(newClient(), '/api/auth/login', {
      method: 'POST', body: { roomId, memberName: nameA, challengeId: c.data.challengeId, proof },
    });
    expectStatus(ok, 200, 'login new pw');

    // 旧密码
    const c2 = await api(newClient(), '/api/auth/challenge', { method: 'POST', body: { roomId, memberName: nameA } });
    const oldProof = bytesToHex(authProof(keysA.authKey, c2.data.roomId, nameA, c2.data.challengeId));
    const bad = await api(newClient(), '/api/auth/login', {
      method: 'POST', body: { roomId, memberName: nameA, challengeId: c2.data.challengeId, proof: oldProof },
    });
    expectStatus(bad, 401, 'login old pw');

    // A 当前会话仍可用
    const me = await api(A, '/api/me');
    expectStatus(me, 200, 'session kept');
  });

  await check('审计日志记录关键动作', async () => {
    const r = await api(B, '/api/audit');
    expectStatus(r, 200, 'audit');
    const actions = r.data.events.map((e) => e.action);
    for (const a of ['room_created', 'member_joined', 'login_ok', 'password_changed']) {
      assert.ok(actions.includes(a), `缺少审计动作 ${a}`);
    }
  });

  await check('历史分页与解密', async () => {
    for (let i = 0; i < 60; i++) {
      const clientId = randomB64(16);
      const aad = messageAad(roomId, meB.member.id, 'text', clientId);
      const p = sealPayload(msgKey, aad, { text: `批量消息 ${i}` });
      const r = await api(B, '/api/messages', {
        method: 'POST',
        body: { clientId, kind: 'text', nonce: p.nonce, ct: p.ct, attachmentIds: [] },
      });
      expectStatus(r, 201, 'bulk send');
    }
    const latest = await api(B, '/api/messages?limit=20');
    expectStatus(latest, 200, 'latest page');
    assert.equal(latest.data.messages.length, 20);
    assert.equal(latest.data.hasMore, true);
    assert.equal(latest.data.messages[19].seq, latest.data.lastSeq);
    const firstOfLatest = latest.data.messages[0].seq;

    const older = await api(B, `/api/messages?before=${firstOfLatest}&limit=20`);
    expectStatus(older, 200, 'older page');
    assert.equal(older.data.messages.length, 20);
    assert.equal(older.data.messages[19].seq, firstOfLatest - 1);

    const m = latest.data.messages[19];
    const payload = openPayload(
      msgKey, messageAad(roomId, meB.member.id, 'text', m.clientId), m.nonce, m.ct,
    );
    assert.match(payload.text, /^批量消息 \d+$/);
  });

  await check('CSRF 与 Origin 防护', async () => {
    const noCsrf = await fetchRetry(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: A.cookie } });
    assert.equal(noCsrf.status, 403);
    const badOrigin = await fetchRetry(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: A.cookie, 'X-Dsh': '1', Origin: 'http://evil.example' },
    });
    assert.equal(badOrigin.status, 403);
  });

  await check('登出后会话失效', async () => {
    const out = await api(A, '/api/auth/logout', { method: 'POST' });
    expectStatus(out, 200, 'logout');
    const me = await api(A, '/api/me');
    expectStatus(me, 401, 'after logout');
  });

  await check('安全响应头', async () => {
    const r = await fetch(`${BASE}/api/health`);
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  });

  await check('局域网配置接口', async () => {
    const r = await fetch(`${BASE}/api/config`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.lanIps));
    assert.equal(typeof data.port, 'number');
  });

  await check('静态页面和 PWA 资源可访问', async () => {
    const home = await fetch(`${BASE}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<title>私密聊天<\/title>/);
    assert.match(home.headers.get('content-type') || '', /text\/html/);
    const js = await fetch(`${BASE}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') || '', /javascript/);
    const manifest = await fetch(`${BASE}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const mf = await manifest.json();
    assert.equal(mf.name, '私密聊天');
    const sw = await fetch(`${BASE}/sw.js`);
    assert.equal(sw.status, 200);
  });

  console.log(`\n${passed} 项通过${failed ? `，${failed} 项失败` : ''}`);
  if (failed) process.exitCode = 1;
}

// 小工具：宽松 base64url 解码（测试里只用于已知合法值）
function b64urlDecodeSafe(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    server.kill();
    await sleep(300);
    if (process.exitCode) {
      try { console.error('\n--- server.log ---\n' + readFileSync(join(dataDir, 'server.log'), 'utf8')); } catch {}
    }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    process.exit(process.exitCode || 0);
  });
