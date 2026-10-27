/**
 * 端到端加密原语（纯 JS，零依赖）
 *
 * 为什么不用 WebCrypto：手机通过局域网 http://192.168.x.x 访问时不是
 * secure context，crypto.subtle 不可用。这里用纯 JS 实现
 * SHA-256 / HMAC / PBKDF2 / ChaCha20-Poly1305，任何 HTTP 页面都能跑。
 * 随机数用 crypto.getRandomValues（唯一在非安全上下文也可用的接口）。
 *
 * 所有密钥只在浏览器内存/localStorage 里，服务器永远只看到密文。
 */

const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = (s) => te.encode(s);
export const utf8Decode = (b) => td.decode(b);

/* ------------------------------ 编码工具 ------------------------------ */

export function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-f]+/gi, '');
  if (clean.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function b64urlEncode(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  const CHUNK = 65536;
  for (let i = 0; i < n; i += CHUNK) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + CHUNK, n)));
  }
  return out;
}

export function randomB64(n = 32) {
  return b64urlEncode(randomBytes(n));
}

/** 内存安全比较（避免提前返回泄露长度以外的信息） */
export function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------- SHA-256 ------------------------------- */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.len = 0;
  }

  clone() {
    const c = new Sha256();
    c.h.set(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.len = this.len;
    return c;
  }

  update(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    this.len += data.length;
    let i = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        this._compress(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this._compress(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = data.length - i;
    }
    return this;
  }

  _compress(data, off) {
    const w = new Uint32Array(64);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
    let e = this.h[4], f = this.h[5], g = this.h[6], h = this.h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  digest() {
    const c = this.clone();
    const bitLen = c.len * 8;
    c.buf[c.bufLen++] = 0x80;
    if (c.bufLen > 56) {
      c.buf.fill(0, c.bufLen, 64);
      c._compress(c.buf, 0);
      c.bufLen = 0;
    }
    c.buf.fill(0, c.bufLen, 56);
    const dv = new DataView(c.buf.buffer);
    dv.setUint32(56, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(60, bitLen >>> 0, false);
    c._compress(c.buf, 0);
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setUint32(i * 4, c.h[i], false);
    return out;
  }
}

export function sha256(...parts) {
  const h = new Sha256();
  for (const p of parts) h.update(p);
  return h.digest();
}

/* -------------------------------- HMAC -------------------------------- */

export function hmacSha256(key, ...parts) {
  return makeHmac(key)(...parts);
}

/** 预计算 HMAC 状态的工厂，PBKDF2 热路径复用 */
export function makeHmac(key) {
  const k = key.length > 64 ? sha256(key) : key;
  const ipad = new Uint8Array(64).fill(0x36);
  const opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  const inner = new Sha256().update(ipad);
  const outer = new Sha256().update(opad);
  return (...parts) => {
    const hi = inner.clone();
    for (const p of parts) hi.update(p);
    const ih = hi.digest();
    const ho = outer.clone();
    ho.update(ih);
    return ho.digest();
  };
}

/* ------------------------------- PBKDF2 ------------------------------- */

export function pbkdf2Sha256(password, salt, iterations, dkLen = 32) {
  if (iterations < 1) throw new Error('iterations must be >= 1');
  const mac = makeHmac(password);
  const out = new Uint8Array(dkLen);
  const blocks = Math.ceil(dkLen / 32);
  for (let b = 1; b <= blocks; b++) {
    const s = new Uint8Array(salt.length + 4);
    s.set(salt);
    s[salt.length] = (b >>> 24) & 0xff;
    s[salt.length + 1] = (b >>> 16) & 0xff;
    s[salt.length + 2] = (b >>> 8) & 0xff;
    s[salt.length + 3] = b & 0xff;
    let u = mac(s);
    const t = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = mac(u);
      for (let j = 0; j < 32; j++) t[j] ^= u[j];
    }
    out.set(t.subarray(0, Math.min(32, dkLen - (b - 1) * 32)), (b - 1) * 32);
  }
  return out;
}

/* ----------------------------- ChaCha20 ------------------------------- */

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function quarterRound(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl32(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl32(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl32(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl32(x[b] ^ x[c], 7);
}

function chacha20Block(key, nonce, counter, out) {
  const st = new Uint32Array(16);
  st[0] = 0x61707865;
  st[1] = 0x3320646e;
  st[2] = 0x79622d32;
  st[3] = 0x6b206574;
  const kv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) st[4 + i] = kv.getUint32(i * 4, true);
  st[12] = counter >>> 0;
  const nv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  st[13] = nv.getUint32(0, true);
  st[14] = nv.getUint32(4, true);
  st[15] = nv.getUint32(8, true);

  const x = st.slice();
  for (let i = 0; i < 10; i++) {
    quarterRound(x, 0, 4, 8, 12);
    quarterRound(x, 1, 5, 9, 13);
    quarterRound(x, 2, 6, 10, 14);
    quarterRound(x, 3, 7, 11, 15);
    quarterRound(x, 0, 5, 10, 15);
    quarterRound(x, 1, 6, 11, 12);
    quarterRound(x, 2, 7, 8, 13);
    quarterRound(x, 3, 4, 9, 14);
  }
  const ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < 16; i++) ov.setUint32(i * 4, (x[i] + st[i]) >>> 0, true);
}

function chacha20Xor(key, nonce, counter, input) {
  const out = new Uint8Array(input.length);
  const block = new Uint8Array(64);
  for (let off = 0; off < input.length; off += 64) {
    chacha20Block(key, nonce, counter++, block);
    const end = Math.min(64, input.length - off);
    for (let i = 0; i < end; i++) out[off + i] = input[off + i] ^ block[i];
  }
  return out;
}

/* ------------------------------ Poly1305 ------------------------------ */

function leToBigInt(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

function bigIntToLe(n, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function poly1305(key, msg) {
  const rBytes = key.slice(0, 16);
  rBytes[3] &= 15;
  rBytes[7] &= 15;
  rBytes[11] &= 15;
  rBytes[15] &= 15;
  rBytes[4] &= 252;
  rBytes[8] &= 252;
  rBytes[12] &= 252;
  const r = leToBigInt(rBytes);
  const s = leToBigInt(key.slice(16, 32));
  const p = (1n << 130n) - 5n;
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  let acc = 0n;
  const full = msg.length - (msg.length % 16);
  for (let off = 0; off < full; off += 16) {
    const lo = dv.getBigUint64(off, true);
    const hi = dv.getBigUint64(off + 8, true);
    acc = ((acc + (lo | (hi << 64n)) + (1n << 128n)) * r) % p;
  }
  if (full < msg.length) {
    const tail = msg.subarray(full);
    acc = ((acc + leToBigInt(tail) + (1n << BigInt(8 * tail.length))) * r) % p;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  return bigIntToLe(acc, 16);
}

/* --------------------------- AEAD 封装 ---------------------------- */

const EMPTY = new Uint8Array(0);

function pad16(data) {
  const rem = data.length % 16;
  if (rem === 0) return EMPTY;
  return new Uint8Array(16 - rem);
}

function le64(n) {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** 加密：aad 只参与认证，不写入密文；返回密文||tag */
export function aeadSeal(key, nonce, aad, plaintext) {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('bad key/nonce size');
  const block0 = new Uint8Array(64);
  chacha20Block(key, nonce, 0, block0);
  const otk = block0.subarray(0, 32);
  const ct = chacha20Xor(key, nonce, 1, plaintext);
  const mac = new Uint8Array(
    aad.length + pad16(aad).length + ct.length + pad16(ct).length + 16,
  );
  let off = 0;
  mac.set(aad, off); off += aad.length;
  mac.set(pad16(aad), off); off += pad16(aad).length;
  mac.set(ct, off); off += ct.length;
  mac.set(pad16(ct), off); off += pad16(ct).length;
  mac.set(le64(BigInt(aad.length)), off); off += 8;
  mac.set(le64(BigInt(ct.length)), off);
  const tag = poly1305(otk, mac);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct, 0);
  out.set(tag, ct.length);
  return out;
}

export function aeadOpen(key, nonce, aad, sealed) {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('bad key/nonce size');
  if (sealed.length < 16) throw new Error('ciphertext too short');
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const block0 = new Uint8Array(64);
  chacha20Block(key, nonce, 0, block0);
  const otk = block0.subarray(0, 32);
  const mac = new Uint8Array(
    aad.length + pad16(aad).length + ct.length + pad16(ct).length + 16,
  );
  let off = 0;
  mac.set(aad, off); off += aad.length;
  mac.set(pad16(aad), off); off += pad16(aad).length;
  mac.set(ct, off); off += ct.length;
  mac.set(pad16(ct), off); off += pad16(ct).length;
  mac.set(le64(BigInt(aad.length)), off); off += 8;
  mac.set(le64(BigInt(ct.length)), off);
  const expect = poly1305(otk, mac);
  if (!ctEqual(expect, tag)) throw new Error('authentication failed');
  return chacha20Xor(key, nonce, 1, ct);
}

/* --------------------------- 协议辅助函数 --------------------------- */

/** KDF 迭代次数：手机纯 JS 约 0.5~1.5 秒，足以抵抗离线爆破 */
export const KDF_ITERATIONS = 200000;

export function makeSalt() {
  return randomBytes(16);
}

/** 密码 → 认证密钥 + 包裹密钥（两个用途互相隔离） */
export function kdfKeys(password, salt, iterations = KDF_ITERATIONS) {
  const dk = pbkdf2Sha256(utf8(password), salt, iterations, 64);
  return { authKey: dk.slice(0, 32), wrapKey: dk.slice(32, 64) };
}

export function authProof(authKey, roomId, memberName, challenge) {
  return hmacSha256(authKey, utf8(`dsh-chat-login-v1|${roomId}|${memberName}|${challenge}`));
}

export const WRAP_AAD = (roomId, memberName) => `dsh-chat-wrap-v1|${roomId}|${memberName}`;

export function wrapMasterKey(masterKey, wrapKey, roomId, memberName) {
  const nonce = randomBytes(12);
  const ct = aeadSeal(wrapKey, nonce, utf8(WRAP_AAD(roomId, memberName)), masterKey);
  return { nonce, ct };
}

export function unwrapMasterKey(wrapped, wrapKey, roomId, memberName) {
  return aeadOpen(wrapKey, wrapped.nonce, utf8(WRAP_AAD(roomId, memberName)), wrapped.ct);
}

export function deriveKey(masterKey, label) {
  return hmacSha256(masterKey, utf8(label));
}

export function roomFingerprint(masterKey) {
  const h = hmacSha256(masterKey, utf8('dsh-chat-fingerprint-v1'));
  return bytesToHex(h.subarray(0, 8)).match(/.{4}/g).join(' ').toUpperCase();
}

export function messageKey(masterKey) {
  return deriveKey(masterKey, 'dsh-chat-msg-v1');
}

export function fileKey(masterKey) {
  return deriveKey(masterKey, 'dsh-chat-file-v1');
}

export function sealPayload(key, aad, obj, nonce) {
  const n = nonce || randomBytes(12);
  const ct = aeadSeal(key, n, utf8(aad), utf8(JSON.stringify(obj)));
  return { nonce: b64urlEncode(n), ct: b64urlEncode(ct) };
}

export function openPayload(key, aad, nonceB64, ctB64) {
  const pt = aeadOpen(key, b64urlDecode(nonceB64), utf8(aad), b64urlDecode(ctB64));
  return JSON.parse(utf8Decode(pt));
}

/** 消息 AAD：把房间、发送者、类型、clientId 绑进密文，防止搬运/篡改 */
export function messageAad(roomId, senderId, kind, clientId) {
  return `dsh-chat-msg-v1|${roomId}|${senderId}|${kind}|${clientId}`;
}

/**
 * 把任意密码降成可显示强度分数（0-4），客户端用，纯启发式。
 */
export function passwordStrength(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}
