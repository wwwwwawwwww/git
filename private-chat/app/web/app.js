/**
 * 私密双人聊天 · 前端
 *
 * 明文只存在于这个浏览器里：房间主密钥由密码经 PBKDF2 解出，
 * 消息/附件用 ChaCha20-Poly1305 加密后才发给服务器。
 */
import * as C from './crypto.js';

/* ============================== 小工具 ============================== */

const $ = (id) => document.getElementById(id);
const STORE = {
  room: 'dsh.room.v1',
  key: (roomId) => `dsh.key.v1.${roomId}`,
  fingerprint: (roomId) => `dsh.fp.v1.${roomId}`,
};
const ACTION_NAMES = {
  room_created: '创建房间',
  member_joined: '加入房间',
  login_ok: '登录成功',
  login_failed: '登录失败',
  password_changed: '修改密码',
  invite_created: '生成邀请',
  logout: '退出登录',
};
const MAX_FILE = 12 * 1024 * 1024;

const state = {
  roomId: null,
  shortCode: null,
  roomName: '私密房间',
  members: [],
  me: null,
  online: [],
  messages: [],
  pending: [],
  lastSeq: 0,
  myReadSeq: 0,
  peerReadSeq: 0,
  hasMore: false,
  loadingOlder: false,
  es: null,
  connected: false,
  unread: 0,
  salt: null,
  iterations: C.KDF_ITERATIONS,
  wrapped: null,
  savedRoom: null,
  pendingInvite: null,
  currentInvite: null,
  peerTypingUntil: 0,
  typingTimer: null,
  objectUrls: new Map(),
  msgKey: null,
  fileKey: null,
  masterKey: null,
  searchAllLoaded: false,
  lanIps: [],
  lanPort: null,
  configLoaded: false,
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, val); return true; } catch { return false; }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}
function storageJSON(key) {
  try { return JSON.parse(storageGet(key) || 'null'); } catch { return null; }
}

function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
  const target = $(`screen-${name}`);
  if (target) target.classList.remove('hidden');
}

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

let overlayShown = false;
function showOverlay(text) {
  $('overlay-text').textContent = text;
  $('overlay').classList.remove('hidden');
  overlayShown = true;
}
function hideOverlay() {
  if (!overlayShown) return;
  $('overlay').classList.add('hidden');
  overlayShown = false;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.className = 'sr-hidden';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function setError(id, msg) {
  $(id).textContent = msg || '';
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function formatDay(ts) {
  const day = startOfDay(ts);
  const today = startOfDay(Date.now());
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff > 1 && diff < 7) return `${diff} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${formatTime(ts)}`;
}
function humanSize(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function safeFileName(name) {
  return String(name || '文件').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
}
function memberById(id) {
  return state.members.find((m) => m.id === id) || null;
}
function peer() {
  return state.members.find((m) => m.id !== state.me?.id) || null;
}
function b64u(bytes) { return C.b64urlEncode(bytes); }
function unb64u(str) { return C.b64urlDecode(str); }

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  const opts = { method, headers, credentials: 'same-origin' };
  if (options.body !== undefined) {
    if (options.body instanceof Uint8Array || options.body instanceof Blob) {
      opts.body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(options.body);
    }
  }
  if (method !== 'GET') headers['X-Dsh'] = '1';
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError('网络连接失败，检查一下服务是否还开着', 0, 'network');
  }
  const ctype = res.headers.get('Content-Type') || '';
  let data = null;
  if (ctype.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    data = await res.blob();
  }
  if (!res.ok) {
    if (res.status === 401 && state.me) onSessionExpired();
    throw new ApiError((data && data.message) || `请求失败（${res.status}）`, res.status, data && data.error);
  }
  return data;
}

function onSessionExpired() {
  if (state.me) {
    state.me = null;
    state.masterKey = null;
    state.msgKey = null;
    state.fileKey = null;
    disconnectSSE();
    toast('登录已过期，请重新登录');
    showLoginPrefill();
    showScreen('welcome');
  }
}

/* ============================== 启动 ============================== */

function parseInviteHash() {
  const hash = location.hash || '';
  if (!hash.startsWith('#/join')) return null;
  const qIndex = hash.indexOf('?');
  if (qIndex < 0) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  const roomId = params.get('r');
  const code = params.get('c');
  const keyB64 = params.get('k');
  if (!roomId || !code || !keyB64) return null;
  if (!/^[A-Za-z0-9_-]{20,32}$/.test(roomId)) return null;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  try {
    const key = unb64u(keyB64);
    if (key.length !== 32) return null;
    return { roomId, code, key };
  } catch {
    return null;
  }
}

function clearInviteHash() {
  if (location.hash.startsWith('#/join')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

/** iOS 键盘弹出时 visualViewport 会缩小，把聊天高度跟着调，输入框才不会被挡住 */
function syncViewportHeight() {
  if (!window.visualViewport) return;
  const h = Math.round(window.visualViewport.height);
  if (h > 0) document.documentElement.style.setProperty('--app-height', h + 'px');
}

function watchViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', syncViewportHeight);
  vv.addEventListener('scroll', syncViewportHeight);
  window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 150));
}

async function boot() {
  syncViewportHeight();
  watchViewport();
  wireUI();
  initObserver();
  registerSW();
  loadConfig();
  state.savedRoom = storageJSON(STORE.room);

  const invite = parseInviteHash();
  if (invite) {
    showScreen('welcome');
    switchTab('join');
    $('join-link').value = location.href;
    await previewInviteLink(location.href);
    return;
  }

  if (!state.savedRoom || !state.savedRoom.roomId) {
    showScreen('welcome');
    return;
  }

  try {
    const me = await api('/api/me');
    applyMe(me);
    const keyB64 = storageGet(STORE.key(state.savedRoom.roomId));
    if (keyB64) {
      const key = unb64u(keyB64);
      if (key.length === 32) {
        state.masterKey = key;
        await enterChat();
        return;
      }
    }
    showUnlock(me);
  } catch (e) {
    if (e.status === 401) showLoginPrefill();
    else toast(e.message || '无法连接服务器');
    showScreen('welcome');
  }
}

function showLoginPrefill() {
  const saved = state.savedRoom;
  if (saved) {
    $('login-room').value = saved.shortCode || saved.roomId || '';
    $('login-name').value = saved.memberName || '';
  }
  switchTab('login');
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ============================== 欢迎页交互 ============================== */

function switchTab(tab) {
  for (const btn of document.querySelectorAll('.tab')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', pane.id !== `form-${tab}`);
  }
}

const PASSWORD_MIN = 10;

function passwordProblem(pw, pw2) {
  if (!pw || pw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (pw !== pw2) return '两次输入的密码不一样';
  return '';
}

function updatePwMeter(pw) {
  const score = C.passwordStrength(pw);
  const meter = $('create-pw-meter');
  if (meter) meter.dataset.score = String(score);
}

async function handleCreate(e) {
  e.preventDefault();
  setError('create-error', '');
  const roomName = $('create-room-name').value.trim() || '两个人的房间';
  const memberName = $('create-name').value.trim();
  const pw = $('create-password').value;
  const pw2 = $('create-password2').value;

  if (!memberName) return setError('create-error', '先给自己起个昵称');
  const problem = passwordProblem(pw, pw2);
  if (problem) return setError('create-error', problem);
  if (roomName.length > 40) return setError('create-error', '房间名太长了');

  const roomId = C.randomB64(16);
  const masterKey = C.randomBytes(32);
  const salt = C.makeSalt();
  const inviteCode = C.randomB64(32);
  const inviteHash = C.bytesToHex(C.sha256(C.utf8(inviteCode)));
  const iterations = C.KDF_ITERATIONS;

  showOverlay('正在生成只有你们俩知道的密钥…');
  await nextFrame();
  try {
    const keys = C.kdfKeys(pw, salt, iterations);
    const wrapped = C.wrapMasterKey(masterKey, keys.wrapKey, roomId, memberName);
    const roomNameEnc = C.sealPayload(
      masterKey,
      `dsh-chat-room-name-v1|${roomId}`,
      { name: roomName },
    );
    const data = await api('/api/rooms', {
      method: 'POST',
      body: {
        roomId,
        roomName: { nonce: roomNameEnc.nonce, ct: roomNameEnc.ct },
        memberName,
        color: '#4f8cff',
        salt: b64u(salt),
        iterations,
        authKey: C.bytesToHex(keys.authKey),
        wrapped: { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) },
        invite: { hash: inviteHash, expiresAt: Date.now() + 7 * 86400000 },
      },
    });
    state.masterKey = masterKey;
    state.wrapped = { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) };
    persistRoom(data.room.id, data.room.shortCode, memberName, masterKey);
    applyMe({ ...data, salt: b64u(salt), iterations, wrapped: state.wrapped });
    hideOverlay();
    await enterChat();
    await generateInvite(7 * 86400000);
  } catch (err) {
    hideOverlay();
    setError('create-error', err.message || '创建失败');
  }
}

async function handleJoin(e) {
  e.preventDefault();
  setError('join-error', '');
  const invite = state.pendingInvite;
  const memberName = $('join-name').value.trim();
  const pw = $('join-password').value;
  const pw2 = $('join-password2').value;
  if (!invite) return setError('join-error', '先粘贴一条有效的邀请链接');
  if (!memberName) return setError('join-error', '先给自己起个昵称');
  const problem = passwordProblem(pw, pw2);
  if (problem) return setError('join-error', problem);

  const salt = C.makeSalt();
  const iterations = C.KDF_ITERATIONS;
  showOverlay('正在用邀请里的钥匙解开房间…');
  await nextFrame();
  try {
    const keys = C.kdfKeys(pw, salt, iterations);
    const wrapped = C.wrapMasterKey(invite.key, keys.wrapKey, invite.roomId, memberName);
    const data = await api('/api/rooms/join', {
      method: 'POST',
      body: {
        inviteCode: invite.code,
        memberName,
        color: '#ff8a5c',
        salt: b64u(salt),
        iterations,
        authKey: C.bytesToHex(keys.authKey),
        wrapped: { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) },
      },
    });
    state.masterKey = invite.key;
    state.wrapped = { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) };
    persistRoom(data.room.id, data.room.shortCode, memberName, invite.key);
    applyMe({ ...data, salt: b64u(salt), iterations, wrapped: state.wrapped });
    clearInviteHash();
    hideOverlay();
    await enterChat();
    toast('进来了，鱼缸里现在有两条鱼');
  } catch (err) {
    hideOverlay();
    setError('join-error', err.message || '加入失败');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  setError('login-error', '');
  const roomRef = $('login-room').value.trim();
  const memberName = $('login-name').value.trim();
  const pw = $('login-password').value;
  if (!roomRef) return setError('login-error', '输入房间码');
  if (!memberName) return setError('login-error', '输入昵称');
  if (!pw) return setError('login-error', '输入密码');

  showOverlay('正在验证密码…');
  await nextFrame();
  try {
    const ch = await api('/api/auth/challenge', {
      method: 'POST',
      body: { roomId: roomRef, memberName },
    });
    const keys = C.kdfKeys(pw, unb64u(ch.salt), ch.iterations);
    const proof = C.bytesToHex(
      C.authProof(keys.authKey, ch.roomId, ch.memberName || memberName, ch.challengeId),
    );
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { roomId: ch.roomId, memberName, challengeId: ch.challengeId, proof },
    });
    let masterKey;
    try {
      masterKey = C.unwrapMasterKey(
        { nonce: unb64u(data.wrapped.nonce), ct: unb64u(data.wrapped.ct) },
        keys.wrapKey,
        data.room.id,
        data.member.name,
      );
    } catch {
      throw new ApiError('密码好像对，但密钥解不开。可能有人在服务器上动过密钥。', 0, 'unwrap');
    }
    state.masterKey = masterKey;
    state.wrapped = data.wrapped;
    persistRoom(data.room.id, data.room.shortCode, data.member.name, masterKey);
    applyMe({
      ...data,
      salt: data.salt,
      iterations: data.iterations,
      wrapped: data.wrapped,
    });
    $('login-password').value = '';
    hideOverlay();
    await enterChat();
  } catch (err) {
    hideOverlay();
    setError('login-error', err.message || '登录失败');
  }
}

function persistRoom(roomId, shortCode, memberName, masterKey) {
  const prev = state.savedRoom && state.savedRoom.roomId;
  if (prev && prev !== roomId) {
    storageRemove(STORE.key(prev));
    storageRemove(STORE.fingerprint(prev));
  }
  storageSet(STORE.room, JSON.stringify({ roomId, shortCode, memberName }));
  storageSet(STORE.key(roomId), b64u(masterKey));
  storageSet(STORE.fingerprint(roomId), C.roomFingerprint(masterKey));
  state.savedRoom = { roomId, shortCode, memberName };
}

function applyMe(me) {
  state.roomId = me.room.id;
  state.shortCode = me.room.shortCode;
  state.members = me.members || [];
  state.me = me.member;
  state.room = me.room;
  state.salt = me.salt || state.salt;
  state.iterations = me.iterations || state.iterations;
  state.wrapped = me.wrapped || state.wrapped;
  let keyBytes = state.masterKey;
  if (!keyBytes) {
    const storedKey = storageGet(STORE.key(me.room.id));
    if (storedKey) {
      try {
        const k = unb64u(storedKey);
        if (k.length === 32) keyBytes = k;
      } catch {}
    }
  }
  if (keyBytes && keyBytes.length === 32) {
    try {
      const name = C.openPayload(
        keyBytes,
        `dsh-chat-room-name-v1|${me.room.id}`,
        me.room.name.nonce,
        me.room.name.ct,
      );
      state.roomName = name.name || '私密房间';
    } catch {
      state.roomName = '私密房间';
    }
  }
  const meRow = state.members.find((m) => m.id === state.me.id);
  if (meRow) state.myReadSeq = Math.max(state.myReadSeq, meRow.readSeq || 0);
  const peerRow = state.members.find((m) => m.id !== state.me.id);
  if (peerRow) state.peerReadSeq = Math.max(state.peerReadSeq, peerRow.readSeq || 0);
}

function showUnlock(me) {
  state.roomId = me.room.id;
  state.shortCode = me.room.shortCode;
  state.members = me.members || [];
  state.me = me.member;
  state.room = me.room;
  state.salt = me.salt;
  state.iterations = me.iterations;
  state.wrapped = me.wrapped;
  $('unlock-room').textContent = `房间 ${me.room.shortCode} · ${me.member.name}`;
  $('unlock-password').value = '';
  setError('unlock-error', '');
  showScreen('unlock');
  setTimeout(() => $('unlock-password').focus(), 100);
}

async function handleUnlock(e) {
  e.preventDefault();
  setError('unlock-error', '');
  const pw = $('unlock-password').value;
  if (!pw) return setError('unlock-error', '输入密码');
  showOverlay('正在本机解开密钥…');
  await nextFrame();
  try {
    const keys = C.kdfKeys(pw, unb64u(state.salt), state.iterations);
    let masterKey;
    try {
      masterKey = C.unwrapMasterKey(
        { nonce: unb64u(state.wrapped.nonce), ct: unb64u(state.wrapped.ct) },
        keys.wrapKey,
        state.roomId,
        state.me.name,
      );
    } catch {
      throw new ApiError('密码不对', 0, 'unwrap');
    }
    state.masterKey = masterKey;
    storageSet(STORE.key(state.roomId), b64u(masterKey));
    storageSet(STORE.fingerprint(state.roomId), C.roomFingerprint(masterKey));
    hideOverlay();
    await enterChat();
  } catch (err) {
    hideOverlay();
    setError('unlock-error', err.message || '解锁失败');
  }
}

/* ============================== 进入聊天 ============================== */

async function enterChat() {
  if (!state.masterKey) return;
  const fingerprint = C.roomFingerprint(state.masterKey);
  const stored = storageGet(STORE.fingerprint(state.roomId));
  if (stored && stored !== fingerprint) {
    const ok = await confirmDialog(
      '密钥指纹不一致',
      `这台设备记住的指纹是 ${stored}，这次解出来的是 ${fingerprint}。\n\n` +
      '正常情况下永远不会变。变了说明服务器上的密钥包裹被换过，或者有人给了你另一把钥匙。\n\n' +
      '如果不是你自己改的密码，别继续聊。',
      '仍然继续（有风险）',
    );
    if (!ok) {
      storageRemove(STORE.key(state.roomId));
      state.masterKey = null;
      location.reload();
      return;
    }
  }
  storageSet(STORE.fingerprint(state.roomId), fingerprint);

  state.msgKey = C.messageKey(state.masterKey);
  state.fileKey = C.fileKey(state.masterKey);
  state.messages = [];
  state.pending = [];
  state.lastSeq = 0;
  state.unread = 0;
  state.hasMore = false;
  state.myReadSeq = state.members.find((m) => m.id === state.me.id)?.readSeq || 0;
  state.peerReadSeq = state.members.find((m) => m.id !== state.me.id)?.readSeq || 0;
  try {
    const name = C.openPayload(
      state.masterKey,
      `dsh-chat-room-name-v1|${state.roomId}`,
      state.room.name.nonce,
      state.room.name.ct,
    );
    if (name && name.name) state.roomName = name.name;
  } catch {}

  applyRoomUI();
  showScreen('chat');
  try {
    await loadInitial();
    connectSSE();
  } catch (e) {
    toast(e.message || '加载失败');
    if (e.status === 401) onSessionExpired();
  }
}

function applyRoomUI() {
  state.roomName = state.roomName || '私密房间';
  $('room-title').textContent = state.roomName;
  const p = peer();
  const av = $('peer-avatar');
  av.textContent = p ? (p.name || '?').slice(0, 1) : '?';
  document.title = `${state.roomName} · 私密聊天`;
  updatePresence();
}

function updatePresence() {
  const p = peer();
  const dot = document.querySelector('#presence .dot');
  const text = $('presence-text');
  if (!state.connected) {
    dot.classList.remove('online');
    text.textContent = '连接断开，重连中…';
    return;
  }
  if (!p) {
    dot.classList.remove('online');
    text.textContent = '等待对方加入';
    return;
  }
  const on = state.online.includes(p.id);
  dot.classList.toggle('online', on);
  text.textContent = on ? `${p.name} 在线` : `${p.name} 离线`;
}

/* ============================== 消息 ============================== */

function decryptMessage(raw) {
  try {
    const payload = C.openPayload(
      state.msgKey,
      C.messageAad(state.roomId, raw.senderId, raw.kind, raw.clientId),
      raw.nonce,
      raw.ct,
    );
    return { ...raw, payload, decrypted: true };
  } catch {
    return { ...raw, payload: null, decrypted: false };
  }
}

function insertMessage(raw) {
  if (state.messages.some((m) => m.seq === raw.seq)) return null;
  const m = decryptMessage(raw);
  state.messages.push(m);
  state.messages.sort((a, b) => a.seq - b.seq);
  state.lastSeq = Math.max(state.lastSeq, raw.seq);
  return m;
}

function isNearBottom() {
  const list = $('messages');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
}
function isAtBottom() {
  const list = $('messages');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
}
function scrollToBottom(smooth = false) {
  const list = $('messages');
  list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function loadInitial() {
  const data = await api('/api/messages?limit=50');
  state.lastSeq = data.lastSeq;
  state.myReadSeq = data.readSeq;
  state.hasMore = data.hasMore;
  for (const raw of data.messages) insertMessage(raw);
  renderTimeline();
  scrollToBottom(false);
  if (isAtBottom() && document.visibilityState === 'visible') markRead();
}

function renderTimeline(opts = {}) {
  const timeline = $('timeline');
  const empty = $('empty-state');
  const frag = document.createDocumentFragment();
  const items = [...state.messages, ...state.pending.map((p) => ({ ...p, pending: true }))];
  items.sort((a, b) => (a.seq || Infinity) - (b.seq || Infinity));

  empty.classList.toggle('hidden', items.length > 0);
  let lastDay = null;

  for (const m of items) {
    const day = startOfDay(m.createdAt || Date.now());
    if (day !== lastDay) {
      lastDay = day;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = formatDay(m.createdAt || Date.now());
      frag.appendChild(sep);
    }
    frag.appendChild(renderMessage(m));
  }
  timeline.replaceChildren(frag);

  const lm = $('btn-load-more');
  lm.parentElement.classList.toggle('hidden', !state.hasMore || items.length === 0);

  if (opts.scroll === 'bottom') scrollToBottom(false);
}

function renderMessage(m) {
  const self = m.senderId === state.me?.id;
  const row = document.createElement('div');
  row.className = 'msg ' + (self ? 'self' : 'peer');
  if (!m.pending) row.id = `msg-${m.seq}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = self ? '' : (memberById(m.senderId)?.name || '?').slice(0, 1);
  row.appendChild(avatar);

  const main = document.createElement('div');
  main.className = 'msg-main';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (!m.decrypted && !m.pending) {
    bubble.textContent = '🔒 无法解密这条消息（密钥不匹配）';
    bubble.classList.add('undecryptable');
  } else if (m.payload) {
    if (m.payload.text) appendLinkified(bubble, String(m.payload.text));
    if (m.kind === 'image' && m.payload.attachment) {
      bubble.classList.add('has-image');
      bubble.appendChild(renderImage(m.payload));
    } else if (m.kind === 'file' && m.payload.attachment) {
      bubble.appendChild(renderFile(m.payload));
    }
  } else if (m.pending) {
    bubble.textContent = m.payload?.text || m.payload?.fileName || '…';
  }

  main.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = document.createElement('span');
  time.textContent = formatTime(m.createdAt || Date.now());
  meta.appendChild(time);

  if (self) {
    const tick = document.createElement('span');
    tick.className = 'tick';
    if (m.status === 'sending') {
      tick.textContent = '发送中…';
    } else if (m.status === 'failed') {
      tick.textContent = '发送失败';
      tick.classList.add('failed');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'link-btn';
      retry.textContent = '重试';
      retry.addEventListener('click', () => retryMessage(m));
      meta.appendChild(retry);
    } else if (m.seq && m.seq <= state.peerReadSeq) {
      tick.textContent = '✓✓';
      tick.classList.add('read');
      tick.title = '对方已读';
    } else {
      tick.textContent = '✓';
      tick.title = '已送达';
    }
    if (m.status !== 'failed') meta.appendChild(tick);
  } else {
    const name = document.createElement('span');
    name.textContent = memberById(m.senderId)?.name || '';
    if (name.textContent) meta.insertBefore(name, time);
  }

  main.appendChild(meta);
  row.appendChild(main);
  return row;
}

function appendLinkified(parent, text) {
  const re = /(https?:\/\/[^\s<>"']+)/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const a = document.createElement('a');
    a.href = match[1];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = match[1];
    parent.appendChild(a);
    last = re.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function attachmentAad(id, size) {
  return `dsh-chat-file-v1|${state.roomId}|${id}|${size}`;
}

function renderImage(payload) {
  const att = payload.attachment;
  const cached = state.objectUrls.get(att.id);
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap loading';
  wrap.dataset.attId = att.id;
  wrap.dataset.nonce = att.nonce;
  wrap.dataset.size = String(payload.size || 0);
  wrap.dataset.mime = payload.mime || 'image/*';
  wrap.dataset.name = payload.fileName || '图片';
  if (cached) {
    wrap.classList.remove('loading');
    wrap.appendChild(makeImg(cached, payload));
  } else {
    wrap.textContent = '解密中…';
    imageObserver.observe(wrap);
  }
  return wrap;
}

function makeImg(url, payload) {
  const img = document.createElement('img');
  img.className = 'msg-img';
  img.src = url;
  img.alt = payload.fileName || '图片';
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(url));
  return img;
}

function rememberObjectUrl(id, url) {
  if (state.objectUrls.size >= 40) {
    const first = state.objectUrls.keys().next().value;
    const old = state.objectUrls.get(first);
    if (old) URL.revokeObjectURL(old);
    state.objectUrls.delete(first);
  }
  state.objectUrls.set(id, url);
}

const imageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      imageObserver.unobserve(entry.target);
      loadImageInto(entry.target);
    }
  },
  { root: $('messages'), rootMargin: '300px 0px' },
);

async function loadImageInto(wrap) {
  const id = wrap.dataset.attId;
  const nonce = wrap.dataset.nonce;
  const size = Number(wrap.dataset.size);
  const mime = wrap.dataset.mime;
  try {
    const bytes = await downloadAttachmentBytes(id, nonce, size);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/*' }));
    rememberObjectUrl(id, url);
    wrap.classList.remove('loading');
    wrap.replaceChildren(makeImg(url, { fileName: wrap.dataset.name }));
  } catch {
    wrap.classList.remove('loading');
    wrap.textContent = '图片加载失败';
  }
}

function renderFile(payload) {
  const card = document.createElement('div');
  card.className = 'file-card';
  const icon = document.createElement('div');
  icon.className = 'file-icon';
  icon.textContent = (payload.mime || '').startsWith('image/') ? '🖼️' : '📄';
  const info = document.createElement('div');
  info.className = 'file-info';
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = payload.fileName || '文件';
  const size = document.createElement('div');
  size.className = 'file-size';
  size.textContent = humanSize(payload.size || 0);
  info.append(name, size);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'file-dl';
  btn.textContent = '下载';
  btn.addEventListener('click', () => downloadAttachment(payload, btn));
  card.append(icon, info, btn);
  return card;
}

async function downloadAttachmentBytes(id, nonce, size) {
  const res = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('附件下载失败');
  const sealed = new Uint8Array(await res.arrayBuffer());
  return C.aeadOpen(state.fileKey, unb64u(nonce), C.utf8(attachmentAad(id, size)), sealed);
}

async function downloadAttachment(payload, btn) {
  const att = payload.attachment;
  if (!att) return;
  if (btn) { btn.disabled = true; btn.textContent = '解密中'; }
  try {
    const bytes = await downloadAttachmentBytes(att.id, att.nonce, payload.size || 0);
    const blob = new Blob([bytes], { type: payload.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName(payload.fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch {
    toast('文件解密失败');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '下载'; }
  }
}

async function sendMessage(kind, payload, attachmentIds = []) {
  if (!state.msgKey) return;
  const clientId = C.randomB64(16);
  const aad = C.messageAad(state.roomId, state.me.id, kind, clientId);
  const sealed = C.sealPayload(state.msgKey, aad, payload);
  const pending = {
    clientId,
    senderId: state.me.id,
    kind,
    payload,
    sealed,
    attachmentIds,
    createdAt: Date.now(),
    status: 'sending',
    pending: true,
  };
  state.pending.push(pending);
  const stick = isNearBottom();
  renderTimeline();
  if (stick) scrollToBottom(false);
  hideJump();
  await submitPending(pending, stick);
}

async function submitPending(pending, stick) {
  try {
    const res = await api('/api/messages', {
      method: 'POST',
      body: {
        clientId: pending.clientId,
        kind: pending.kind,
        nonce: pending.sealed.nonce,
        ct: pending.sealed.ct,
        attachmentIds: pending.attachmentIds || [],
      },
    });
    state.pending = state.pending.filter((p) => p.clientId !== pending.clientId);
    insertMessage(res.message);
    renderTimeline();
    if (stick || isNearBottom()) scrollToBottom(false);
    markRead();
  } catch (e) {
    pending.status = 'failed';
    renderTimeline();
    toast(e.message || '发送失败');
  }
}

function retryMessage(m) {
  const pending = state.pending.find((p) => p.clientId === m.clientId);
  if (!pending || pending.status !== 'failed') return;
  pending.status = 'sending';
  renderTimeline();
  submitPending(pending, isNearBottom());
}

async function handleFileInput(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_FILE) {
    toast(`文件太大，最多 ${humanSize(MAX_FILE)}`);
    return;
  }
  showOverlay('正在本机加密并上传…');
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const id = C.randomB64(16);
    const nonce = C.randomBytes(12);
    const sealed = C.aeadSeal(state.fileKey, nonce, C.utf8(attachmentAad(id, raw.length)), raw);
    await api(`/api/attachments/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Nonce': b64u(nonce) },
      body: sealed,
    });
    const kind = (file.type || '').startsWith('image/') ? 'image' : 'file';
    const payload = {
      fileName: file.name,
      mime: file.type || 'application/octet-stream',
      size: raw.length,
      attachment: { id, nonce: b64u(nonce) },
    };
    if (kind === 'image') {
      rememberObjectUrl(id, URL.createObjectURL(new Blob([raw], { type: payload.mime })));
    }
    hideOverlay();
    await sendMessage(kind, payload, [id]);
  } catch (err) {
    hideOverlay();
    toast(err.message || '上传失败');
  }
}

/* ============================== SSE ============================== */

function connectSSE() {
  disconnectSSE();
  const es = new EventSource('/api/events');
  state.es = es;
  es.addEventListener('hello', (ev) => {
    const data = JSON.parse(ev.data);
    state.connected = true;
    state.online = data.online || [];
    updatePresence();
    ensureMembersKnown();
    if (data.lastSeq > state.lastSeq) syncAfter();
  });
  es.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data);
    onIncoming(data.message);
  });
  es.addEventListener('read', (ev) => {
    const data = JSON.parse(ev.data);
    if (data.memberId !== state.me.id) {
      state.peerReadSeq = Math.max(state.peerReadSeq, data.seq || 0);
      renderTimeline();
    }
  });
  es.addEventListener('typing', (ev) => {
    const data = JSON.parse(ev.data);
    if (data.memberId !== state.me.id) {
      state.peerTypingUntil = Date.now() + 4500;
      $('typing').classList.remove('hidden');
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => $('typing').classList.add('hidden'), 4500);
    }
  });
  es.addEventListener('presence', (ev) => {
    const data = JSON.parse(ev.data);
    state.online = data.online || [];
    updatePresence();
    ensureMembersKnown();
  });
  es.addEventListener('security', () => {
    toast('对方更新了安全设置，其他设备已下线');
  });
  es.addEventListener('error', () => {
    state.connected = false;
    updatePresence();
  });
  es.addEventListener('open', () => {
    state.connected = true;
    updatePresence();
  });
}

function disconnectSSE() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.connected = false;
}

function onIncoming(raw) {
  if (state.messages.some((m) => m.seq === raw.seq)) return;
  const wasNear = isNearBottom();
  const prevLast = state.lastSeq;
  const m = insertMessage(raw);
  if (!m) return;
  if (raw.seq > prevLast + 1) syncAfter();

  const follow = wasNear && document.visibilityState === 'visible';
  if (!follow && raw.senderId !== state.me.id) state.unread++;
  renderTimeline();
  if (follow) {
    scrollToBottom(false);
    markRead();
  } else {
    updateJump();
  }
  updateTitle();
}

async function syncAfter() {
  try {
    let addedCount = 0;
    for (let i = 0; i < 20; i++) {
      const data = await api(`/api/messages?after=${state.lastSeq}&limit=200`);
      if (!data.messages.length) break;
      let added = 0;
      for (const raw of data.messages) {
        if (!state.messages.some((x) => x.seq === raw.seq)) {
          insertMessage(raw);
          added++;
          if (raw.senderId !== state.me.id) addedCount++;
        }
      }
      if (!added || data.messages.length < 200) break;
    }
    if (addedCount && document.visibilityState !== 'visible') state.unread += addedCount;
    renderTimeline();
    if (isNearBottom() && document.visibilityState === 'visible') {
      scrollToBottom(false);
      markRead();
    } else if (addedCount) {
      updateJump();
    }
  } catch {}
}

let membersRefreshing = false;
async function ensureMembersKnown() {
  if (!state.online.length) return;
  if (state.online.every((id) => state.members.some((m) => m.id === id))) return;
  if (membersRefreshing) return;
  membersRefreshing = true;
  try {
    const me = await api('/api/me');
    state.members = me.members;
    const meRow = state.members.find((m) => m.id === state.me.id);
    const peerRow = state.members.find((m) => m.id !== state.me.id);
    state.myReadSeq = Math.max(state.myReadSeq, meRow?.readSeq || 0);
    state.peerReadSeq = Math.max(state.peerReadSeq, peerRow?.readSeq || 0);
    applyRoomUI();
    renderTimeline();
  } catch {}
  membersRefreshing = false;
}

function updateJump() {
  const btn = $('jump-latest');
  if (state.unread > 0) {
    btn.textContent = `${state.unread} 条新消息 ↓`;
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}
function hideJump() {
  state.unread = 0;
  $('jump-latest').classList.add('hidden');
  updateTitle();
}
function updateTitle() {
  const unread = state.unread > 0 ? `(${state.unread}) ` : '';
  document.title = `${unread}${state.roomName} · 私密聊天`;
}

async function markRead(force = false) {
  if (!state.me) return;
  const maxSeq = state.messages.reduce((max, m) => Math.max(max, m.seq || 0), 0);
  if (!maxSeq || maxSeq <= state.myReadSeq) return;
  if (!force && !(document.visibilityState === 'visible' && isNearBottom())) return;
  state.myReadSeq = maxSeq;
  try {
    await api('/api/read', { method: 'POST', body: { seq: maxSeq } });
  } catch {}
}

/* ============================== 加载更多 / 搜索 ============================== */

async function loadOlder() {
  if (!state.hasMore || state.loadingOlder) return;
  state.loadingOlder = true;
  const list = $('messages');
  const prevHeight = list.scrollHeight;
  const prevTop = list.scrollTop;
  $('load-more-status').textContent = '加载中…';
  try {
    const before = state.messages.length ? state.messages[0].seq : state.lastSeq + 1;
    const data = await api(`/api/messages?before=${before}&limit=50`);
    state.hasMore = data.hasMore;
    for (const raw of data.messages) insertMessage(raw);
    renderTimeline();
    list.scrollTop = list.scrollHeight - prevHeight + prevTop;
    $('load-more-status').textContent = '';
  } catch (e) {
    $('load-more-status').textContent = '加载失败';
  } finally {
    state.loadingOlder = false;
  }
}

async function loadAllHistory(onProgress) {
  let before = state.messages.length ? state.messages[0].seq : null;
  for (let page = 0; page < 200; page++) {
    const url = before === null
      ? '/api/messages?limit=200'
      : `/api/messages?before=${before}&limit=200`;
    const data = await api(url);
    if (!data.messages.length) {
      state.hasMore = false;
      break;
    }
    for (const raw of data.messages) insertMessage(raw);
    state.hasMore = data.hasMore;
    before = data.messages[0].seq;
    if (onProgress) onProgress(state.messages.length);
    if (!data.hasMore) break;
  }
  renderTimeline();
}

async function exportHistory() {
  closeSheet('settings');
  showOverlay('正在收集全部密文…');
  try {
    await loadAllHistory((n) => {
      $('overlay-text').textContent = `正在收集全部密文…已加载 ${n} 条`;
    });
    const exported = {
      app: 'dsh-private-chat',
      version: 1,
      exportedAt: new Date().toISOString(),
      room: {
        id: state.roomId,
        shortCode: state.shortCode,
        name: state.roomName,
        createdAt: state.room?.createdAt,
      },
      members: state.members.map((m) => ({ id: m.id, name: m.name, slot: m.slot })),
      messages: state.messages.map((m) => ({
        seq: m.seq,
        senderId: m.senderId,
        senderName: memberById(m.senderId)?.name || '',
        kind: m.kind,
        createdAt: new Date(m.createdAt).toISOString(),
        text: m.payload?.text || '',
        fileName: m.payload?.fileName || '',
        mime: m.payload?.mime || '',
        size: m.payload?.size || 0,
        attachmentId: m.payload?.attachment?.id || null,
        decryptError: !m.decrypted,
      })),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `私密聊天-${safeFileName(state.roomName)}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    hideOverlay();
    toast(`已导出 ${exported.messages.length} 条消息`);
  } catch (e) {
    hideOverlay();
    toast(e.message || '导出失败');
  }
}

function openSearch() {
  $('search-results').replaceChildren();
  $('search-status').textContent = '只搜索已经加载的消息。';
  $('btn-search-all').classList.toggle('hidden', !state.hasMore);
  $('search-input').value = '';
  openSheet('search');
  setTimeout(() => $('search-input').focus(), 120);
}

function runSearch() {
  const q = $('search-input').value.trim().toLowerCase();
  const results = $('search-results');
  results.replaceChildren();
  if (!q) {
    $('search-status').textContent = `已加载 ${state.messages.length} 条消息。`;
    return;
  }
  const hits = [];
  for (const m of state.messages) {
    if (!m.decrypted) continue;
    const hay = `${m.payload?.text || ''} ${m.payload?.fileName || ''}`.toLowerCase();
    if (hay.includes(q)) hits.push(m);
  }
  $('search-status').textContent = `找到 ${hits.length} 条${state.hasMore ? '（还有更早的记录未加载）' : ''}`;
  for (const m of hits.slice(0, 100)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${formatDate(m.createdAt)} · ${memberById(m.senderId)?.name || ''}`;
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = (m.payload?.text || m.payload?.fileName || '').slice(0, 160);
    btn.append(meta, text);
    btn.addEventListener('click', () => {
      closeSheet('search');
      const el = $(`msg-${m.seq}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 1800);
      }
    });
    results.appendChild(btn);
  }
}

/* ============================== 设置 / 邀请 / 密码 ============================== */

function openSettings() {
  $('settings-room-name').textContent = state.roomName;
  $('settings-room-code').textContent = state.shortCode || '—';
  $('settings-fingerprint').textContent = C.roomFingerprint(state.masterKey);
  $('settings-member-count').textContent = `${state.members.length} / 2`;
  $('settings-created').textContent = state.room?.createdAt ? formatDate(state.room.createdAt) : '—';
  $('settings-version').textContent = `私密聊天 v1.0 · 房间 ${state.roomId.slice(0, 6)}…`;
  const inviteBtn = $('btn-generate-invite');
  const hint = $('settings-invite-hint');
  if (state.members.length >= 2) {
    inviteBtn.classList.add('hidden');
    hint.textContent = '房间已经满员（只有两个座位）。';
  } else {
    inviteBtn.classList.remove('hidden');
    hint.textContent = '生成一条一次性邀请链接，发给另一个人。';
  }
  $('audit-list').classList.add('hidden');
  $('audit-list').replaceChildren();
  setError('pw-error', '');
  openSheet('settings');
}

async function changePassword(e) {
  e.preventDefault();
  setError('pw-error', '');
  const current = $('pw-current').value;
  const next = $('pw-new').value;
  const next2 = $('pw-new2').value;
  if (!current) return setError('pw-error', '先输入当前密码');
  if (next.length < PASSWORD_MIN) return setError('pw-error', `新密码至少 ${PASSWORD_MIN} 位`);
  if (next !== next2) return setError('pw-error', '两次输入的新密码不一样');

  showOverlay('正在验证当前密码…');
  await nextFrame();
  try {
    const me = await api('/api/me');
    state.salt = me.salt;
    state.iterations = me.iterations;
    state.wrapped = me.wrapped;
    const curKeys = C.kdfKeys(current, unb64u(state.salt), state.iterations);
    let ok = false;
    try {
      const unwrapped = C.unwrapMasterKey(
        { nonce: unb64u(state.wrapped.nonce), ct: unb64u(state.wrapped.ct) },
        curKeys.wrapKey,
        state.roomId,
        state.me.name,
      );
      ok = C.bytesToHex(unwrapped) === C.bytesToHex(state.masterKey);
    } catch { ok = false; }
    if (!ok) throw new ApiError('当前密码不对', 0, 'bad_pw');

    $('overlay-text').textContent = '正在生成新密钥…';
    await nextFrame();
    const salt = C.makeSalt();
    const iterations = C.KDF_ITERATIONS;
    const keys = C.kdfKeys(next, salt, iterations);
    const wrapped = C.wrapMasterKey(state.masterKey, keys.wrapKey, state.roomId, state.me.name);
    await api('/api/password', {
      method: 'POST',
      body: {
        salt: b64u(salt),
        iterations,
        authKey: C.bytesToHex(keys.authKey),
        wrapped: { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) },
      },
    });
    state.salt = b64u(salt);
    state.iterations = iterations;
    state.wrapped = { nonce: b64u(wrapped.nonce), ct: b64u(wrapped.ct) };
    $('pw-current').value = '';
    $('pw-new').value = '';
    $('pw-new2').value = '';
    hideOverlay();
    toast('密码已修改，其他设备上的登录已失效');
  } catch (err) {
    hideOverlay();
    setError('pw-error', err.message || '修改失败');
  }
}

function inviteLink(code) {
  return `${inviteOrigin()}${location.pathname}#/join?r=${encodeURIComponent(state.roomId)}&c=${encodeURIComponent(code)}&k=${encodeURIComponent(b64u(state.masterKey))}`;
}

function isLoopbackHost() {
  const host = location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function inviteOrigin() {
  if (isLoopbackHost() && state.lanIps.length) {
    const port = state.lanPort || location.port;
    const suffix = port && String(port) !== '80' ? `:${port}` : '';
    return `http://${state.lanIps[0]}${suffix}`;
  }
  return location.origin;
}

async function loadConfig() {
  try {
    const cfg = await api('/api/config');
    if (Array.isArray(cfg.lanIps)) {
      state.lanIps = cfg.lanIps.filter((ip) => typeof ip === 'string' && ip);
    }
    if (cfg.port) state.lanPort = cfg.port;
  } catch {}
  state.configLoaded = true;
}

function updateInviteHostNote() {
  const note = $('invite-host-note');
  if (!note) return;
  if (!isLoopbackHost()) {
    note.classList.add('hidden');
    return;
  }
  if (state.lanIps.length) {
    note.textContent = `你现在是用 127.0.0.1 打开的，链接已经自动换成局域网地址 ${inviteOrigin()}，对方才能打开。`;
  } else {
    note.textContent = '⚠️ 当前地址是 127.0.0.1，对方打不开。请用本机的局域网 IP（例如 http://172.26.x.x:8787）打开页面后再生成邀请。';
  }
  note.classList.remove('hidden');
}

async function generateInvite(expiryMs) {
  if (!state.masterKey) return;
  if (state.members.length >= 2) {
    toast('房间已经满员了');
    return;
  }
  if (!state.configLoaded) await loadConfig();
  const expiry = expiryMs || Number($('invite-expiry').value) || 7 * 86400000;
  const code = C.randomB64(32);
  const hash = C.bytesToHex(C.sha256(C.utf8(code)));
  setError('invite-error', '');
  try {
    await api('/api/invite', { method: 'POST', body: { hash, expiresAt: Date.now() + expiry } });
    state.currentInvite = { code, link: inviteLink(code) };
    $('invite-link').value = state.currentInvite.link;
    updateInviteHostNote();
    openSheet('invite');
  } catch (e) {
    toast(e.message || '生成邀请失败');
  }
}

async function previewInviteLink(raw) {
  const preview = $('join-preview');
  preview.classList.add('hidden');
  state.pendingInvite = null;
  setError('join-error', '');
  const text = String(raw || '').trim();
  if (!text) return;
  let url;
  try {
    let candidate = text;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      candidate = candidate.startsWith('#')
        ? location.origin + location.pathname + candidate
        : 'http://' + candidate;
    }
    url = new URL(candidate);
  } catch {
    return setError('join-error', '这不像一条完整链接');
  }
  if (!url.hash.startsWith('#/join')) {
    return setError('join-error', '链接格式不对，应该包含 #/join');
  }
  const params = new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1));
  const roomId = params.get('r');
  const code = params.get('c');
  const keyB64 = params.get('k');
  if (!roomId || !code || !keyB64) return setError('join-error', '链接不完整');
  let key;
  try {
    key = unb64u(keyB64);
  } catch {
    return setError('join-error', '链接里的钥匙坏了');
  }
  if (key.length !== 32) return setError('join-error', '链接里的钥匙长度不对');

  try {
    const info = await api(`/api/invites/${encodeURIComponent(code)}`);
    if (info.roomId !== roomId) return setError('join-error', '链接和房间对不上');
    let roomName = '私密房间';
    try {
      const name = C.openPayload(key, `dsh-chat-room-name-v1|${roomId}`, info.name.nonce, info.name.ct);
      roomName = name.name || roomName;
    } catch {}
    state.pendingInvite = { roomId, code, key };
    preview.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `「${roomName}」`;
    const sub = document.createElement('span');
    sub.className = 'muted';
    sub.textContent = info.full
      ? '这个房间已经有两个人了，进不去了。'
      : `已有 ${info.members.length} 人：${info.members.map((m) => m.name).join('、')}。邀请有效到 ${formatDate(info.expiresAt)}。`;
    preview.append(title, sub);
    preview.classList.remove('hidden');
  } catch (e) {
    setError('join-error', e.status === 404 ? '邀请无效或已经被用过了' : (e.message || '读取邀请失败'));
  }
}

function openSheet(name) {
  closeAllSheets();
  const sheet = $(`sheet-${name}`);
  const backdrop = $(`${name}-backdrop`);
  if (sheet) sheet.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}
function closeSheet(name) {
  const sheet = $(`sheet-${name}`);
  const backdrop = $(`${name}-backdrop`);
  if (sheet) sheet.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
}
function closeAllSheets() {
  for (const name of ['settings', 'invite', 'search']) closeSheet(name);
}

function confirmDialog(title, text, okLabel = '继续') {
  return new Promise((resolve) => {
    const modal = $('modal-confirm');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    modal.classList.remove('hidden');
    const cleanup = () => {
      modal.classList.add('hidden');
      $('confirm-ok').removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onBackdrop = (e) => { if (e.target === modal) { cleanup(); resolve(false); } };
    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
  });
}

/* ============================== 审计 / 锁定 / 退出 ============================== */

async function showAudit() {
  try {
    const data = await api('/api/audit');
    const list = $('audit-list');
    list.replaceChildren();
    for (const ev of data.events) {
      const li = document.createElement('li');
      const act = document.createElement('span');
      act.className = 'act';
      act.textContent = ACTION_NAMES[ev.action] || ev.action;
      const time = document.createElement('span');
      time.textContent = formatDate(ev.ts);
      li.append(act, time);
      list.appendChild(li);
    }
    list.classList.toggle('hidden', data.events.length === 0);
    if (!data.events.length) toast('还没有审计记录');
  } catch (e) {
    toast(e.message || '读取审计失败');
  }
}

async function logout() {
  const ok = await confirmDialog('退出登录', '退出后这台设备要重新输入密码才能进来。聊天记录还在服务器上。', '退出');
  if (!ok) return;
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  if (state.roomId) {
    storageRemove(STORE.key(state.roomId));
    storageRemove(STORE.fingerprint(state.roomId));
  }
  storageRemove(STORE.room);
  location.hash = '';
  location.reload();
}

function lockLocal() {
  if (state.roomId) storageRemove(STORE.key(state.roomId));
  state.masterKey = null;
  state.msgKey = null;
  state.fileKey = null;
  location.reload();
}

/* ============================== UI 绑定 ============================== */

function wireUI() {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  $('form-create').addEventListener('submit', handleCreate);
  $('form-join').addEventListener('submit', handleJoin);
  $('form-login').addEventListener('submit', handleLogin);
  $('form-unlock').addEventListener('submit', handleUnlock);
  $('create-password').addEventListener('input', (e) => updatePwMeter(e.target.value));

  let joinTimer = null;
  $('join-link').addEventListener('input', (e) => {
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => previewInviteLink(e.target.value), 350);
  });
  $('join-link').addEventListener('paste', () => {
    setTimeout(() => previewInviteLink($('join-link').value), 60);
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-search').addEventListener('click', openSearch);
  $('search-input').addEventListener('input', () => {
    clearTimeout(runSearch._t);
    runSearch._t = setTimeout(runSearch, 160);
  });
  $('btn-search-all').addEventListener('click', async () => {
    const btn = $('btn-search-all');
    btn.disabled = true;
    btn.textContent = '正在加载全部历史…';
    try {
      await loadAllHistory((n) => { $('search-status').textContent = `已加载 ${n} 条…`; });
      $('btn-search-all').classList.add('hidden');
      runSearch();
    } catch (e) {
      $('search-status').textContent = e.message || '加载失败';
    } finally {
      btn.disabled = false;
      btn.textContent = '加载全部历史再搜索';
    }
  });

  $('btn-load-more').addEventListener('click', loadOlder);
  $('messages').addEventListener('scroll', () => {
    if ($('messages').scrollTop < 90) loadOlder();
    if (isAtBottom()) {
      hideJump();
      markRead();
    }
  }, { passive: true });

  $('jump-latest').addEventListener('click', () => {
    hideJump();
    scrollToBottom(true);
    markRead();
  });

  $('btn-send').addEventListener('click', sendFromInput);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendFromInput();
    }
  });
  $('input').addEventListener('input', () => {
    autoGrow($('input'));
    sendTyping();
  });
  $('btn-attach').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', handleFileInput);

  $('btn-generate-invite').addEventListener('click', () => generateInvite());
  $('btn-copy-invite').addEventListener('click', async () => {
    const link = $('invite-link').value;
    if (!link) return;
    const ok = await copyText(link);
    toast(ok ? '链接已复制，用私密渠道发出去' : '复制失败，长按手动复制');
  });
  $('btn-regenerate-invite').addEventListener('click', () => generateInvite());

  $('form-password').addEventListener('submit', changePassword);
  $('btn-export').addEventListener('click', exportHistory);
  $('btn-audit').addEventListener('click', showAudit);
  $('btn-lock').addEventListener('click', async () => {
    const ok = await confirmDialog('锁定本机', '会从这台设备删掉聊天密钥，下次要用密码解锁。', '锁定');
    if (ok) lockLocal();
  });
  $('btn-logout').addEventListener('click', logout);
  $('unlock-logout').addEventListener('click', () => {
    if (state.roomId) {
      storageRemove(STORE.key(state.roomId));
      storageRemove(STORE.fingerprint(state.roomId));
    }
    storageRemove(STORE.room);
    location.reload();
  });

  $('settings-room-code').addEventListener('click', async () => {
    if (await copyText(state.shortCode || '')) toast('房间码已复制');
  });
  $('settings-fingerprint').addEventListener('click', async () => {
    if (await copyText(C.roomFingerprint(state.masterKey))) toast('密钥指纹已复制');
  });

  for (const btn of document.querySelectorAll('[data-close-sheet]')) {
    btn.addEventListener('click', () => closeSheet(btn.dataset.closeSheet));
  }
  for (const name of ['settings', 'invite', 'search']) {
    const backdrop = $(`${name}-backdrop`);
    if (backdrop) backdrop.addEventListener('click', () => closeSheet(name));
  }
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => {
    if (e.target === $('lightbox')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllSheets();
      closeLightbox();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (state.me && !state.connected) connectSSE();
      if (isAtBottom()) {
        hideJump();
        markRead();
      } else {
        updateJump();
      }
    }
  });
  window.addEventListener('online', () => {
    if (state.me) connectSSE();
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

let lastTypingSent = 0;
function sendTyping() {
  if (!state.me) return;
  const now = Date.now();
  if (now - lastTypingSent < 3000) return;
  if (!$('input').value.trim()) return;
  lastTypingSent = now;
  api('/api/typing', { method: 'POST', body: {} }).catch(() => {});
}

async function sendFromInput() {
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoGrow(input);
  await sendMessage('text', { text });
}

function openLightbox(url) {
  $('lightbox-img').src = url;
  $('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lightbox-img').removeAttribute('src');
}

function initObserver() {
  // imageObserver 已创建；如未来需要其它懒加载可在这里扩展
}

/* ============================== 启动 ============================== */

boot();
