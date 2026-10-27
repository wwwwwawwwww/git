import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import {
  bytesToHex, hexToBytes, b64urlEncode, b64urlDecode,
  sha256, hmacSha256, pbkdf2Sha256, Sha256,
  aeadSeal, aeadOpen,
  randomBytes, kdfKeys, wrapMasterKey, unwrapMasterKey,
  roomFingerprint, messageKey, sealPayload, openPayload, messageAad, utf8,
} from '../app/web/crypto.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error(e);
    process.exitCode = 1;
  }
};

const hex = bytesToHex;
const nodeHash = (alg, data) => nodeCrypto.createHash(alg).update(data).digest('hex');
const nodeHmac = (data, key) => nodeCrypto.createHmac('sha256', key).update(data).digest('hex');

console.log('SHA-256');
test('空串', () => {
  assert.equal(hex(sha256(utf8(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
test('abc', () => {
  assert.equal(hex(sha256(utf8('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('百万 a', () => {
  const data = new Uint8Array(1000000).fill(0x61);
  assert.equal(hex(sha256(data)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
test('分段 update 等价', () => {
  const h = new Sha256().update(utf8('hello world, ')).update(utf8('this is a long message!'));
  assert.equal(hex(h.digest()), nodeHash('sha256', 'hello world, this is a long message!'));
});
test('随机数据与 Node 对照', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 200, 5000]) {
    const data = randomBytes(n);
    assert.equal(hex(sha256(data)), nodeHash('sha256', data), `length=${n}`);
  }
});

console.log('HMAC-SHA256');
test('RFC 4231 case 1', () => {
  const mac = hmacSha256(new Uint8Array(20).fill(0x0b), utf8('Hi There'));
  assert.equal(hex(mac), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
});
test('RFC 4231 case 2', () => {
  const mac = hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'));
  assert.equal(hex(mac), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});
test('长 key 与 Node 对照', () => {
  const key = randomBytes(200);
  const msg = randomBytes(333);
  assert.equal(hex(hmacSha256(key, msg)), nodeHmac(msg, key));
});

console.log('PBKDF2-HMAC-SHA256');
test('password/salt c=1', () => {
  assert.equal(hex(pbkdf2Sha256(utf8('password'), utf8('salt'), 1, 32)),
    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
});
test('password/salt c=2', () => {
  assert.equal(hex(pbkdf2Sha256(utf8('password'), utf8('salt'), 2, 32)),
    'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
});
test('password/salt c=4096', () => {
  assert.equal(hex(pbkdf2Sha256(utf8('password'), utf8('salt'), 4096, 32)),
    'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
});
test('dkLen=64 与 Node 对照', () => {
  const salt = randomBytes(16);
  for (const iters of [1, 7, 1000]) {
    const mine = pbkdf2Sha256(utf8('p@ss 中文'), salt, iters, 64);
    const ref = nodeCrypto.pbkdf2Sync('p@ss 中文', salt, iters, 64, 'sha256');
    assert.equal(hex(mine), ref.toString('hex'), `iters=${iters}`);
  }
});

console.log('ChaCha20-Poly1305 (RFC 8439 §2.8.2)');
test('AEAD 官方向量', () => {
  const key = hexToBytes('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = hexToBytes('070000004041424344454647');
  const aad = hexToBytes('50515253c0c1c2c3c4c5c6c7');
  const pt = utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
  const sealed = aeadSeal(key, nonce, aad, pt);
  const expectCt = 'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6' +
    '3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36' +
    '92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3' +
    'ff4def08e4b7a9de576d26586cec64b6116';
  assert.equal(hex(sealed.subarray(0, sealed.length - 16)), expectCt);
  assert.equal(hex(sealed.subarray(sealed.length - 16)), '1ae10b594f09e26a7e902ecbd0600691');
  assert.deepEqual(aeadOpen(key, nonce, aad, sealed), pt);
});

console.log('AEAD 行为');
test('随机往返与 Node 对照', () => {
  for (const n of [0, 1, 15, 16, 17, 64, 1000]) {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const aad = utf8('aad-' + n);
    const pt = randomBytes(n);
    const sealed = aeadSeal(key, nonce, aad, pt);
    const ref = nodeCrypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    ref.setAAD(aad);
    const ct = Buffer.concat([ref.update(pt), ref.final()]);
    const refSealed = Buffer.concat([ct, ref.getAuthTag()]);
    assert.equal(hex(sealed), refSealed.toString('hex'), `length=${n}`);
    assert.deepEqual(aeadOpen(key, nonce, aad, sealed), pt);
  }
});
test('篡改检测', () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = utf8('room|sender|kind|client');
  const sealed = aeadSeal(key, nonce, aad, randomBytes(333));
  const bad = sealed.slice();
  bad[0] ^= 1;
  assert.throws(() => aeadOpen(key, nonce, aad, bad));
  assert.throws(() => aeadOpen(key, nonce, utf8('other aad'), sealed));
  const badTag = sealed.slice();
  badTag[badTag.length - 1] ^= 1;
  assert.throws(() => aeadOpen(key, nonce, aad, badTag));
  assert.throws(() => aeadOpen(randomBytes(32), nonce, aad, sealed));
});
test('空明文 / 空 AAD', () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const sealed = aeadSeal(key, nonce, new Uint8Array(0), new Uint8Array(0));
  assert.equal(sealed.length, 16);
  assert.deepEqual(aeadOpen(key, nonce, new Uint8Array(0), sealed), new Uint8Array(0));
});

console.log('协议辅助');
test('base64url 往返', () => {
  for (const n of [0, 1, 100, 65536]) {
    const b = randomBytes(n);
    assert.deepEqual(b64urlDecode(b64urlEncode(b)), b);
  }
});
test('KDF 派生两把密钥且稳定', () => {
  const salt = randomBytes(16);
  const a = kdfKeys('correct horse battery staple', salt, 1000);
  const b = kdfKeys('correct horse battery staple', salt, 1000);
  assert.equal(hex(a.authKey), hex(b.authKey));
  assert.equal(hex(a.wrapKey), hex(b.wrapKey));
  assert.notEqual(hex(a.authKey), hex(a.wrapKey));
  const c = kdfKeys('wrong password', salt, 1000);
  assert.notEqual(hex(a.wrapKey), hex(c.wrapKey));
});
test('包裹/解包 masterKey', () => {
  const master = randomBytes(32);
  const { wrapKey } = kdfKeys('pw', randomBytes(16), 1000);
  const w = wrapMasterKey(master, wrapKey, 'room1', '阿鱼');
  assert.deepEqual(unwrapMasterKey(w, wrapKey, 'room1', '阿鱼'), master);
  assert.throws(() => unwrapMasterKey(w, wrapKey, 'room1', '别人'));
  assert.throws(() => unwrapMasterKey(w, wrapKey, 'room2', '阿鱼'));
});
test('指纹与消息密钥', () => {
  const master = randomBytes(32);
  assert.match(roomFingerprint(master), /^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
  assert.notEqual(hex(messageKey(master)), hex(master));
  assert.notEqual(hex(messageKey(master)), hex(messageKey(randomBytes(32))));
});
test('sealPayload / openPayload 绑定 AAD', () => {
  const master = randomBytes(32);
  const mk = messageKey(master);
  const aad = messageAad('r1', 'm1', 'text', 'c1');
  const p = sealPayload(mk, aad, { text: '你好，世界 🌍' });
  assert.deepEqual(openPayload(mk, aad, p.nonce, p.ct), { text: '你好，世界 🌍' });
  assert.throws(() => openPayload(mk, messageAad('r1', 'm2', 'text', 'c1'), p.nonce, p.ct));
});

console.log('性能');
test('PBKDF2 200k 计时', () => {
  const t0 = performance.now();
  pbkdf2Sha256(utf8('test-password'), randomBytes(16), 200000, 64);
  const ms = performance.now() - t0;
  console.log(`       200k 迭代耗时 ${ms.toFixed(0)} ms`);
  assert.ok(ms < 8000, '太慢了');
});
test('1MB 加密+解密计时', () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const pt = randomBytes(1024 * 1024);
  const t0 = performance.now();
  const sealed = aeadSeal(key, nonce, utf8('file'), pt);
  aeadOpen(key, nonce, utf8('file'), sealed);
  console.log(`       1MB 加密+解密耗时 ${(performance.now() - t0).toFixed(0)} ms`);
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`);
