#!/usr/bin/env python3
"""
私密双人聊天 · 服务端
=====================

设计原则：服务器是「零知识」的。它只保存：
  * 密码经 PBKDF2 派生出的认证密钥（不存密码）
  * 用该密码派生的包裹密钥加密过的房间主密钥（服务器解不开）
  * 聊天消息的 ChaCha20-Poly1305 密文
  * 附件密文

服务器永远看不到：明文密码、房间主密钥、消息内容、附件内容、文件名。

只依赖 Python 标准库（3.11+），SQLite 持久化在 ./data/chat.db。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import socket
import socketserver
import sqlite3
import sys
import threading
import time
import traceback
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
DATA_DIR = APP_DIR.parent / "data"
DB_PATH = DATA_DIR / "chat.db"
BLOB_DIR = DATA_DIR / "blobs"

VERSION = "1.0.0"
SESSION_DAYS = 30
COOKIE_NAME = "dsh_sid"
MAX_JSON_BODY = 1024 * 1024          # 1MB
MAX_ATTACHMENT = 16 * 1024 * 1024    # 16MB 密文
MAX_MESSAGES_PAGE = 200
CHALLENGE_TTL = 300                  # 秒
KDF_ITERATIONS_MIN = 100_000
KDF_ITERATIONS_MAX = 2_000_000
NAME_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,24}$")
ROOM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,32}$")
SHORT_CODE_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{6,12}$")
ATTACH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,40}$")
B64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")
COLORS = ["#4f8cff", "#ff8a5c", "#7bd88f", "#c792ea", "#ffd166", "#61d4d4"]

STOP = threading.Event()


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------

def now_ms() -> int:
    return int(time.time() * 1000)


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def rand_token(nbytes: int = 32) -> str:
    return b64url_encode(secrets.token_bytes(nbytes))


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def valid_b64url(text, nbytes: int | None = None, maxlen: int = 200) -> bool:
    if not isinstance(text, str) or not text or len(text) > maxlen:
        return False
    if not B64URL_RE.match(text):
        return False
    try:
        raw = b64url_decode(text)
    except Exception:
        return False
    return nbytes is None or len(raw) == nbytes


def valid_hex(text, nbytes: int | None = None) -> bool:
    if not isinstance(text, str) or len(text) % 2:
        return False
    try:
        raw = bytes.fromhex(text)
    except ValueError:
        return False
    return nbytes is None or len(raw) == nbytes


def hmac_hex(key_hex: str, message: str) -> str:
    return hmac.new(bytes.fromhex(key_hex), message.encode("utf-8"), hashlib.sha256).hexdigest()


def client_ip(handler: "Handler") -> str:
    return handler.client_address[0]


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# --------------------------------------------------------------------------
# SQLite
# --------------------------------------------------------------------------

_local = threading.local()


def db() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        _local.conn = conn
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL UNIQUE,
  name_nonce TEXT NOT NULL,
  name_ct TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  invite_hash TEXT,
  invite_expires_at INTEGER,
  invite_created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rooms_invite ON rooms(invite_hash);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  auth_key TEXT NOT NULL,
  wrap_nonce TEXT NOT NULL,
  wrap_ct TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  read_seq INTEGER NOT NULL DEFAULT 0,
  UNIQUE(room_id, name),
  UNIQUE(room_id, slot)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  sender_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ct BLOB NOT NULL,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, seq),
  UNIQUE(room_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  message_id INTEGER,
  size INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  room_id TEXT,
  member_name TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  room_id TEXT,
  member_id TEXT,
  action TEXT NOT NULL,
  ip TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_room ON audit(room_id, ts);
"""


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BLOB_DIR.mkdir(parents=True, exist_ok=True)
    conn = db()
    conn.executescript(SCHEMA)
    conn.execute("DELETE FROM challenges WHERE expires_at < ?", (now_ms(),))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_ms(),))
    # 清理超过 24 小时仍未挂到消息上的附件（多半是上传后发送失败）
    cutoff = now_ms() - 24 * 3600 * 1000
    rows = conn.execute(
        "SELECT id, path FROM attachments WHERE message_id IS NULL AND created_at < ?", (cutoff,)
    ).fetchall()
    for row in rows:
        try:
            (BLOB_DIR / row["path"]).unlink(missing_ok=True)
        except OSError:
            pass
        conn.execute("DELETE FROM attachments WHERE id = ?", (row["id"],))


def get_room(room_id: str):
    return db().execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()


def get_room_by_short(code: str):
    return db().execute(
        "SELECT * FROM rooms WHERE short_code = ?", (code.upper(),)
    ).fetchone()


def resolve_room(room_ref: str):
    """同时接受 22 位房间 ID 和 8 位房间码。"""
    if not isinstance(room_ref, str):
        return None
    ref = room_ref.strip()
    if ROOM_ID_RE.match(ref):
        return get_room(ref)
    if SHORT_CODE_RE.match(ref.upper()):
        return get_room_by_short(ref)
    return None


def get_member(room_id: str, name: str):
    return db().execute(
        "SELECT * FROM members WHERE room_id = ? AND name = ?", (room_id, name)
    ).fetchone()


def room_members(room_id: str):
    return db().execute(
        "SELECT * FROM members WHERE room_id = ? ORDER BY slot", (room_id,)
    ).fetchall()


def member_public(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "slot": row["slot"],
        "color": row["color"],
        "readSeq": row["read_seq"],
        "lastSeenAt": row["last_seen_at"],
        "joinedAt": row["created_at"],
    }


def room_public(row) -> dict:
    return {
        "id": row["id"],
        "shortCode": row["short_code"],
        "name": {"nonce": row["name_nonce"], "ct": row["name_ct"]},
        "createdAt": row["created_at"],
        "lastSeq": row["last_seq"],
        "invite": {
            "active": bool(row["invite_hash"]),
            "expiresAt": row["invite_expires_at"],
        },
    }


def audit(room_id, member_id, action, ip=None, detail=None) -> None:
    try:
        db().execute(
            "INSERT INTO audit (ts, room_id, member_id, action, ip, detail) VALUES (?,?,?,?,?,?)",
            (now_ms(), room_id, member_id, action, ip, detail),
        )
    except sqlite3.Error:
        pass


# --------------------------------------------------------------------------
# 会话
# --------------------------------------------------------------------------

def create_session(member_row) -> str:
    token = rand_token(32)
    now = now_ms()
    db().execute(
        "INSERT INTO sessions (token_hash, member_id, room_id, created_at, expires_at, last_used, user_agent)"
        " VALUES (?,?,?,?,?,?,?)",
        (
            sha256_hex(token),
            member_row["id"],
            member_row["room_id"],
            now,
            now + SESSION_DAYS * 86400 * 1000,
            now,
            "",
        ),
    )
    return token


def parse_cookies(handler: "Handler") -> dict:
    raw = handler.headers.get("Cookie", "")
    out = {}
    for part in raw.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def current_session(handler: "Handler", required: bool = True):
    token = parse_cookies(handler).get(COOKIE_NAME)
    if not token:
        if required:
            raise ApiError(401, "unauthorized", "请先登录")
        return None
    row = db().execute(
        "SELECT s.token_hash, s.expires_at, m.* FROM sessions s JOIN members m ON m.id = s.member_id"
        " WHERE s.token_hash = ?",
        (sha256_hex(token),),
    ).fetchone()
    if row is None:
        if required:
            raise ApiError(401, "unauthorized", "登录已失效，请重新登录")
        return None
    now = now_ms()
    if row["expires_at"] < now:
        db().execute("DELETE FROM sessions WHERE token_hash = ?", (row["token_hash"],))
        if required:
            raise ApiError(401, "unauthorized", "登录已过期，请重新登录")
        return None
    db().execute(
        "UPDATE sessions SET last_used = ? WHERE token_hash = ?", (now, row["token_hash"])
    )
    db().execute(
        "UPDATE members SET last_seen_at = ? WHERE id = ?", (now, row["id"])
    )
    return row


def set_session_cookie(handler: "Handler", token: str) -> None:
    handler.extra_cookie = (
        f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS * 86400}"
    )


def clear_session_cookie(handler: "Handler") -> None:
    handler.extra_cookie = f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"


# --------------------------------------------------------------------------
# 限流
# --------------------------------------------------------------------------

class SlidingWindow:
    def __init__(self):
        self._data: dict[str, list[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def hit(self, key: str, limit: int, window: float) -> bool:
        now = time.time()
        with self._lock:
            arr = [t for t in self._data.get(key, ()) if now - t < window]
            ok = len(arr) < limit
            if ok:
                arr.append(now)
            self._data[key] = arr
            self._calls += 1
            if self._calls % 500 == 0:
                for k in list(self._data):
                    if not self._data[k] or now - self._data[k][-1] > 3600:
                        del self._data[k]
            return ok

    def clear(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)


LIMITER = SlidingWindow()


# --------------------------------------------------------------------------
# 事件总线（SSE）
# --------------------------------------------------------------------------

class EventBus:
    def __init__(self):
        self._subs: dict[str, dict[int, dict]] = {}
        self._lock = threading.Lock()
        self._next = 0

    def subscribe(self, room_id: str, member_id: str) -> tuple[int, queue.Queue]:
        with self._lock:
            self._next += 1
            sid = self._next
            q: queue.Queue = queue.Queue(maxsize=256)
            self._subs.setdefault(room_id, {})[sid] = {"member_id": member_id, "q": q}
            return sid, q

    def unsubscribe(self, room_id: str, sid: int) -> None:
        with self._lock:
            self._subs.get(room_id, {}).pop(sid, None)

    def online(self, room_id: str) -> list[str]:
        with self._lock:
            return sorted({v["member_id"] for v in self._subs.get(room_id, {}).values()})

    def publish(self, room_id: str, event: str, data: dict, exclude: str | None = None) -> None:
        with self._lock:
            subs = list(self._subs.get(room_id, {}).values())
        for sub in subs:
            if exclude and sub["member_id"] == exclude:
                continue
            try:
                sub["q"].put_nowait((event, data))
            except queue.Full:
                pass


BUS = EventBus()


# --------------------------------------------------------------------------
# 响应工具
# --------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; "
        "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
        "frame-ancestors 'none'; form-action 'none'; manifest-src 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PrivateChat/" + VERSION
    sys_version = ""

    extra_cookie: str | None = None

    # ---- 通用 ----

    def log_message(self, fmt, *args):
        # 不记录查询串，避免把邀请码写进日志
        sys.stderr.write(
            "%s - %s %s\n" % (self.client_address[0], self.command, urlparse(self.path).path)
        )

    def handle_one_request(self):
        # 浏览器关页面/断网时直接断开，不打印无意义的 traceback
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def _base_headers(self) -> dict:
        headers = dict(SECURITY_HEADERS)
        headers["Cache-Control"] = "no-store"
        if self.extra_cookie:
            headers["Set-Cookie"] = self.extra_cookie
            self.extra_cookie = None
        return headers

    def send_json(self, status: int, obj, headers: dict | None = None) -> None:
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        hdrs = self._base_headers()
        hdrs["Content-Type"] = "application/json; charset=utf-8"
        hdrs["Content-Length"] = str(len(body))
        if headers:
            hdrs.update(headers)
        if status >= 400:
            # 错误响应前可能没读完请求体，直接断开，避免 keep-alive 串包
            hdrs["Connection"] = "close"
            self.close_connection = True
        self.send_response(status)
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error_json(self, status: int, code: str, message: str) -> None:
        self.send_json(status, {"error": code, "message": message})

    def read_body(self, limit: int) -> bytes:
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            n = int(length)
        except ValueError:
            raise ApiError(400, "bad_request", "Content-Length 无效")
        if n < 0 or n > limit:
            raise ApiError(413, "too_large", "请求体过大")
        data = self.rfile.read(n)
        if len(data) != n:
            raise ApiError(400, "bad_request", "请求体不完整")
        return data

    def read_json(self, limit: int = MAX_JSON_BODY) -> dict:
        raw = self.read_body(limit)
        if not raw:
            return {}
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(400, "bad_json", "JSON 格式错误")
        if not isinstance(obj, dict):
            raise ApiError(400, "bad_json", "请求体必须是对象")
        return obj

    def check_csrf(self) -> None:
        if self.headers.get("X-Dsh") != "1":
            raise ApiError(403, "csrf", "缺少请求头")
        origin = self.headers.get("Origin")
        if origin and origin != "null":
            host = self.headers.get("Host", "")
            if urlparse(origin).netloc != host:
                raise ApiError(403, "bad_origin", "来源不匹配")

    def ip_guard(self, limit: int = 600, window: float = 60) -> None:
        if not LIMITER.hit(f"ip:{client_ip(self)}", limit, window):
            raise ApiError(429, "rate_limited", "请求太频繁，稍后再试")

    def route(self, method: str):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)
        # API
        if path.startswith("/api/"):
            try:
                self.ip_guard()
                if method == "POST":
                    self.check_csrf()
                self.handle_api(method, path, query)
            except ApiError as e:
                self.send_error_json(e.status, e.code, e.message)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            except Exception:
                traceback.print_exc()
                try:
                    self.send_error_json(500, "server_error", "服务器出错了")
                except Exception:
                    pass
            return
        if method == "GET":
            self.serve_static(path)
        else:
            self.send_error_json(405, "method", "不支持的方法")

    def do_GET(self):
        self.extra_cookie = None
        self.route("GET")

    def do_POST(self):
        self.extra_cookie = None
        self.route("POST")

    def do_HEAD(self):
        self.extra_cookie = None
        self.route("GET")

    # ---- 静态文件 ----

    def serve_static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"
        rel = path.lstrip("/")
        if ".." in rel or "\x00" in rel or rel.startswith("/"):
            self.send_error_json(400, "bad_path", "非法路径")
            return
        target = (WEB_DIR / rel).resolve()
        base = str(WEB_DIR.resolve())
        if not (str(target) == base or str(target).startswith(base + os.sep)) or not target.is_file():
            self.send_error_json(404, "not_found", "页面不存在")
            return
        try:
            data = target.read_bytes()
        except OSError:
            self.send_error_json(404, "not_found", "页面不存在")
            return
        mime = MIME.get(target.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ------------------------------------------------------------------
    # API 路由
    # ------------------------------------------------------------------

    def handle_api(self, method: str, path: str, query: dict) -> None:
        # 不需要登录
        if method == "GET" and path == "/api/health":
            self.send_json(200, {"ok": True, "version": VERSION, "time": now_ms()})
            return

        if method == "GET" and path == "/api/config":
            # 浏览器用 127.0.0.1 打开时，生成邀请链接要换成局域网地址，否则对方打不开
            self.send_json(200, {
                "lanIps": lan_ips(),
                "port": self.server.server_address[1],
            })
            return

        if method == "POST" and path == "/api/rooms":
            self.api_create_room()
            return

        m = re.match(r"^/api/invites/([A-Za-z0-9_-]+)$", path)
        if method == "GET" and m:
            self.api_invite_info(m.group(1))
            return

        if method == "POST" and path == "/api/rooms/join":
            self.api_join_room()
            return

        if method == "POST" and path == "/api/auth/challenge":
            self.api_challenge()
            return

        if method == "POST" and path == "/api/auth/login":
            self.api_login()
            return

        if method == "POST" and path == "/api/auth/logout":
            self.api_logout()
            return

        # 以下都要登录
        member = current_session(self)
        if method == "GET" and path == "/api/me":
            self.api_me(member)
            return
        if method == "GET" and path == "/api/messages":
            self.api_messages(member, query)
            return
        if method == "POST" and path == "/api/messages":
            self.api_post_message(member)
            return
        if method == "POST" and path == "/api/read":
            self.api_read(member)
            return
        if method == "POST" and path == "/api/typing":
            self.api_typing(member)
            return
        if method == "GET" and path == "/api/events":
            self.api_events(member)
            return
        if method == "POST" and path == "/api/invite":
            self.api_create_invite(member)
            return
        if method == "POST" and path == "/api/password":
            self.api_change_password(member)
            return
        if method == "GET" and path == "/api/audit":
            self.api_audit(member)
            return

        m = re.match(r"^/api/attachments/([A-Za-z0-9_-]{20,40})$", path)
        if m and method == "POST":
            self.api_upload_attachment(member, m.group(1))
            return
        if m and method == "GET":
            self.api_download_attachment(member, m.group(1))
            return

        raise ApiError(404, "not_found", "接口不存在")

    # ---- 创建 / 加入 ----

    def api_create_room(self) -> None:
        if not LIMITER.hit(f"create:{client_ip(self)}", 8, 3600):
            raise ApiError(429, "rate_limited", "创建太频繁，过一会儿再试")
        body = self.read_json()
        room_id = body.get("roomId")
        room_name = body.get("roomName") or {}
        member_name = (body.get("memberName") or "").strip()
        color = body.get("color") or COLORS[0]
        salt = body.get("salt")
        iterations = body.get("iterations")
        auth_key = body.get("authKey")
        wrapped = body.get("wrapped") or {}
        invite = body.get("invite") or {}

        if not (isinstance(room_id, str) and ROOM_ID_RE.match(room_id)):
            raise ApiError(400, "bad_room", "房间 ID 无效")
        if not (isinstance(room_name.get("nonce"), str) and valid_b64url(room_name["nonce"], 12)
                and isinstance(room_name.get("ct"), str) and valid_b64url(room_name["ct"])):
            raise ApiError(400, "bad_room", "房间名密文无效")
        if not NAME_RE.match(member_name):
            raise ApiError(400, "bad_name", "昵称需为 1-24 个字符")
        if not (isinstance(salt, str) and valid_b64url(salt, 16)):
            raise ApiError(400, "bad_salt", "盐值无效")
        if not (isinstance(iterations, int) and KDF_ITERATIONS_MIN <= iterations <= KDF_ITERATIONS_MAX):
            raise ApiError(400, "bad_iterations", "KDF 参数无效")
        if not (isinstance(auth_key, str) and valid_hex(auth_key, 32)):
            raise ApiError(400, "bad_key", "认证密钥无效")
        if not (isinstance(wrapped.get("nonce"), str) and valid_b64url(wrapped["nonce"], 12)
                and isinstance(wrapped.get("ct"), str) and valid_b64url(wrapped["ct"])):
            raise ApiError(400, "bad_key", "密钥包裹无效")
        if not (isinstance(invite.get("hash"), str) and valid_hex(invite["hash"], 32)):
            raise ApiError(400, "bad_invite", "邀请信息无效")
        invite_expires = invite.get("expiresAt")
        if not (isinstance(invite_expires, int) and invite_expires > now_ms()):
            raise ApiError(400, "bad_invite", "邀请有效期无效")
        if color not in COLORS:
            color = COLORS[0]

        if get_room(room_id) is not None:
            raise ApiError(409, "room_exists", "房间 ID 冲突，请重试")

        short_code = self._unique_short_code()
        now = now_ms()
        conn = db()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO rooms (id, short_code, name_nonce, name_ct, created_at, last_seq,"
                " invite_hash, invite_expires_at, invite_created_at) VALUES (?,?,?,?,?,0,?,?,?)",
                (room_id, short_code, room_name["nonce"], room_name["ct"], now,
                 invite["hash"].lower(), invite_expires, now),
            )
            member_id = rand_token(16)
            conn.execute(
                "INSERT INTO members (id, room_id, slot, name, color, salt, iterations, auth_key,"
                " wrap_nonce, wrap_ct, created_at, last_seen_at, read_seq)"
                " VALUES (?,?,1,?,?,?,?,?,?,?,?,?,0)",
                (member_id, room_id, member_name, color, salt, iterations, auth_key.lower(),
                 wrapped["nonce"], wrapped["ct"], now, now),
            )
            conn.execute("COMMIT")
        except sqlite3.IntegrityError:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise ApiError(409, "room_exists", "房间已存在，请重试")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise

        member = get_member(room_id, member_name)
        token = create_session(member)
        set_session_cookie(self, token)
        audit(room_id, member_id, "room_created", client_ip(self))
        self.send_json(201, {
            "room": room_public(get_room(room_id)),
            "member": member_public(member),
            "members": [member_public(m) for m in room_members(room_id)],
        })

    def _unique_short_code(self) -> str:
        alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        for _ in range(50):
            code = "".join(secrets.choice(alphabet) for _ in range(8))
            if get_room_by_short(code) is None:
                return code
        raise ApiError(500, "server_error", "生成房间码失败")

    def api_invite_info(self, code: str) -> None:
        if not B64URL_RE.match(code) or len(code) < 20:
            raise ApiError(404, "not_found", "邀请无效或已使用")
        if not LIMITER.hit(f"invite:{client_ip(self)}", 60, 60):
            raise ApiError(429, "rate_limited", "请求太频繁")
        row = db().execute("SELECT * FROM rooms WHERE invite_hash = ?", (sha256_hex(code),)).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "邀请无效或已使用")
        if row["invite_expires_at"] and row["invite_expires_at"] < now_ms():
            raise ApiError(410, "expired", "邀请已过期")
        members = room_members(row["id"])
        self.send_json(200, {
            "roomId": row["id"],
            "shortCode": row["short_code"],
            "name": {"nonce": row["name_nonce"], "ct": row["name_ct"]},
            "members": [{"name": m["name"], "slot": m["slot"], "color": m["color"]} for m in members],
            "full": len(members) >= 2,
            "expiresAt": row["invite_expires_at"],
        })

    def api_join_room(self) -> None:
        body = self.read_json()
        code = body.get("inviteCode")
        member_name = (body.get("memberName") or "").strip()
        color = body.get("color") or COLORS[1]
        salt = body.get("salt")
        iterations = body.get("iterations")
        auth_key = body.get("authKey")
        wrapped = body.get("wrapped") or {}

        if not (isinstance(code, str) and B64URL_RE.match(code) and len(code) >= 20):
            raise ApiError(400, "bad_invite", "邀请码无效")
        if not NAME_RE.match(member_name):
            raise ApiError(400, "bad_name", "昵称需为 1-24 个字符")
        if not (isinstance(salt, str) and valid_b64url(salt, 16)):
            raise ApiError(400, "bad_salt", "盐值无效")
        if not (isinstance(iterations, int) and KDF_ITERATIONS_MIN <= iterations <= KDF_ITERATIONS_MAX):
            raise ApiError(400, "bad_iterations", "KDF 参数无效")
        if not (isinstance(auth_key, str) and valid_hex(auth_key, 32)):
            raise ApiError(400, "bad_key", "认证密钥无效")
        if not (isinstance(wrapped.get("nonce"), str) and valid_b64url(wrapped["nonce"], 12)
                and isinstance(wrapped.get("ct"), str) and valid_b64url(wrapped["ct"])):
            raise ApiError(400, "bad_key", "密钥包裹无效")
        if color not in COLORS:
            color = COLORS[1]
        if not LIMITER.hit(f"join:{client_ip(self)}", 10, 300):
            raise ApiError(429, "rate_limited", "尝试太频繁，稍后再试")

        invite_hash = sha256_hex(code)
        conn = db()
        try:
            conn.execute("BEGIN IMMEDIATE")
            room = conn.execute("SELECT * FROM rooms WHERE invite_hash = ?", (invite_hash,)).fetchone()
            if room is None:
                raise ApiError(404, "not_found", "邀请无效或已使用")
            if room["invite_expires_at"] and room["invite_expires_at"] < now_ms():
                raise ApiError(410, "expired", "邀请已过期")
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM members WHERE room_id = ?", (room["id"],)
            ).fetchone()["n"]
            if count >= 2:
                raise ApiError(409, "room_full", "房间已满（只允许两个人）")
            if get_member(room["id"], member_name) is not None:
                raise ApiError(409, "name_taken", "这个昵称已被占用")
            member_id = rand_token(16)
            now = now_ms()
            conn.execute(
                "INSERT INTO members (id, room_id, slot, name, color, salt, iterations, auth_key,"
                " wrap_nonce, wrap_ct, created_at, last_seen_at, read_seq)"
                " VALUES (?,?,2,?,?,?,?,?,?,?,?,?,0)",
                (member_id, room["id"], member_name, color, salt, iterations, auth_key.lower(),
                 wrapped["nonce"], wrapped["ct"], now, now),
            )
            conn.execute("UPDATE rooms SET invite_hash = NULL, invite_expires_at = NULL WHERE id = ?",
                         (room["id"],))
            conn.execute("COMMIT")
        except ApiError:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        except sqlite3.IntegrityError:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise ApiError(409, "conflict", "加入失败，请重试")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise

        member = get_member(room["id"], member_name)
        token = create_session(member)
        set_session_cookie(self, token)
        audit(room["id"], member_id, "member_joined", client_ip(self))
        BUS.publish(room["id"], "presence", {"online": BUS.online(room["id"]), "joined": member_id})
        self.send_json(201, {
            "room": room_public(get_room(room["id"])),
            "member": member_public(member),
            "members": [member_public(m) for m in room_members(room["id"])],
        })

    # ---- 登录 ----

    def api_challenge(self) -> None:
        body = self.read_json()
        room_ref = body.get("roomId")
        member_name = (body.get("memberName") or "").strip()
        if not LIMITER.hit(f"challenge:{client_ip(self)}", 40, 60):
            raise ApiError(429, "rate_limited", "尝试太频繁")
        room = resolve_room(room_ref)
        member = get_member(room["id"], member_name) if room else None

        # 无论成员是否存在都返回结构相同的响应，避免昵称枚举
        salt = b64url_encode(secrets.token_bytes(16))
        iterations = 200_000
        canonical_room = room["id"] if room else rand_token(16)
        if member:
            salt = member["salt"]
            iterations = member["iterations"]

        cid = rand_token(16)
        db().execute(
            "INSERT INTO challenges (id, member_id, room_id, member_name, expires_at, used)"
            " VALUES (?,?,?,?,?,0)",
            (cid, member["id"] if member else None, room["id"] if room else None,
             member_name, now_ms() + CHALLENGE_TTL * 1000),
        )
        self.send_json(200, {
            "roomId": canonical_room,
            "memberName": member_name,
            "salt": salt,
            "iterations": iterations,
            "challengeId": cid,
            "expiresIn": CHALLENGE_TTL,
        })

    def api_login(self) -> None:
        body = self.read_json()
        room_ref = body.get("roomId")
        member_name = (body.get("memberName") or "").strip()
        challenge_id = body.get("challengeId")
        proof = body.get("proof")
        ip = client_ip(self)

        if not LIMITER.hit(f"login-ip:{ip}", 30, 600):
            raise ApiError(429, "rate_limited", "尝试太频繁，请稍后再试")
        room = resolve_room(room_ref)
        member = get_member(room["id"], member_name) if room else None
        limiter_key = f"login:{room['id'] if room else room_ref}:{member_name}"
        if not LIMITER.hit(limiter_key, 8, 300):
            raise ApiError(429, "rate_limited", "密码错误次数过多，请 5 分钟后再试")

        generic = ApiError(401, "bad_credentials", "房间码、昵称或密码不正确")
        if room is None or member is None:
            time.sleep(0.15)
            audit(None, None, "login_failed", ip, "unknown_member")
            raise generic
        if not (isinstance(challenge_id, str) and valid_b64url(challenge_id, 16)):
            raise ApiError(400, "bad_challenge", "挑战无效")
        if not (isinstance(proof, str) and valid_hex(proof, 32)):
            raise ApiError(400, "bad_proof", "认证信息无效")

        ch = db().execute("SELECT * FROM challenges WHERE id = ?", (challenge_id,)).fetchone()
        if ch is None or ch["used"] or ch["expires_at"] < now_ms() or ch["member_id"] != member["id"]:
            time.sleep(0.15)
            audit(room["id"], member["id"], "login_failed", ip, "bad_challenge")
            raise generic

        expected = hmac_hex(
            member["auth_key"],
            f"dsh-chat-login-v1|{room['id']}|{member['name']}|{challenge_id}",
        )
        if not hmac.compare_digest(expected, proof.lower()):
            db().execute("UPDATE challenges SET used = 1 WHERE id = ?", (challenge_id,))
            time.sleep(0.15)
            audit(room["id"], member["id"], "login_failed", ip, "bad_proof")
            raise generic

        db().execute("UPDATE challenges SET used = 1 WHERE id = ?", (challenge_id,))
        token = create_session(member)
        set_session_cookie(self, token)
        audit(room["id"], member["id"], "login_ok", ip)
        LIMITER.clear(limiter_key)
        self.send_json(200, {
            "room": room_public(get_room(room["id"])),
            "member": member_public(member),
            "members": [member_public(m) for m in room_members(room["id"])],
            "wrapped": {"nonce": member["wrap_nonce"], "ct": member["wrap_ct"]},
            "salt": member["salt"],
            "iterations": member["iterations"],
            "lastSeq": get_room(room["id"])["last_seq"],
        })

    def api_logout(self) -> None:
        token = parse_cookies(self).get(COOKIE_NAME)
        if token:
            db().execute("DELETE FROM sessions WHERE token_hash = ?", (sha256_hex(token),))
        clear_session_cookie(self)
        self.send_json(200, {"ok": True})

    # ---- 房间 / 成员 ----

    def api_me(self, member) -> None:
        room = get_room(member["room_id"])
        if room is None:
            raise ApiError(404, "not_found", "房间不存在")
        self.send_json(200, {
            "room": room_public(room),
            "member": member_public(member),
            "members": [member_public(m) for m in room_members(room["id"])],
            "wrapped": {"nonce": member["wrap_nonce"], "ct": member["wrap_ct"]},
            "salt": member["salt"],
            "iterations": member["iterations"],
            "online": BUS.online(room["id"]),
        })

    def api_create_invite(self, member) -> None:
        body = self.read_json()
        invite_hash = body.get("hash")
        expires_at = body.get("expiresAt")
        if not (isinstance(invite_hash, str) and valid_hex(invite_hash, 32)):
            raise ApiError(400, "bad_invite", "邀请信息无效")
        if not (isinstance(expires_at, int) and now_ms() < expires_at <= now_ms() + 30 * 86400 * 1000):
            raise ApiError(400, "bad_invite", "有效期无效")
        room = get_room(member["room_id"])
        if len(room_members(room["id"])) >= 2:
            raise ApiError(409, "room_full", "房间已经有两个人了")
        db().execute(
            "UPDATE rooms SET invite_hash = ?, invite_expires_at = ?, invite_created_at = ? WHERE id = ?",
            (invite_hash.lower(), expires_at, now_ms(), room["id"]),
        )
        audit(room["id"], member["id"], "invite_created", client_ip(self))
        self.send_json(200, {"ok": True, "expiresAt": expires_at})

    def api_change_password(self, member) -> None:
        body = self.read_json()
        salt = body.get("salt")
        iterations = body.get("iterations")
        auth_key = body.get("authKey")
        wrapped = body.get("wrapped") or {}
        if not (isinstance(salt, str) and valid_b64url(salt, 16)):
            raise ApiError(400, "bad_salt", "盐值无效")
        if not (isinstance(iterations, int) and KDF_ITERATIONS_MIN <= iterations <= KDF_ITERATIONS_MAX):
            raise ApiError(400, "bad_iterations", "KDF 参数无效")
        if not (isinstance(auth_key, str) and valid_hex(auth_key, 32)):
            raise ApiError(400, "bad_key", "认证密钥无效")
        if not (isinstance(wrapped.get("nonce"), str) and valid_b64url(wrapped["nonce"], 12)
                and isinstance(wrapped.get("ct"), str) and valid_b64url(wrapped["ct"])):
            raise ApiError(400, "bad_key", "密钥包裹无效")

        conn = db()
        conn.execute(
            "UPDATE members SET salt = ?, iterations = ?, auth_key = ?, wrap_nonce = ?, wrap_ct = ?"
            " WHERE id = ?",
            (salt, iterations, auth_key.lower(), wrapped["nonce"], wrapped["ct"], member["id"]),
        )
        conn.execute(
            "DELETE FROM sessions WHERE member_id = ? AND token_hash != ?",
            (member["id"], sha256_hex(parse_cookies(self).get(COOKIE_NAME, ""))),
        )
        audit(member["room_id"], member["id"], "password_changed", client_ip(self))
        BUS.publish(member["room_id"], "security",
                    {"memberId": member["id"], "reason": "password_changed"}, exclude=member["id"])
        self.send_json(200, {"ok": True})

    # ---- 消息 ----

    def _serialize_message(self, row) -> dict:
        return {
            "id": row["id"],
            "seq": row["seq"],
            "senderId": row["sender_id"],
            "kind": row["kind"],
            "nonce": row["nonce"],
            "ct": b64url_encode(row["ct"]),
            "createdAt": row["created_at"],
            "clientId": row["client_id"],
        }

    def api_messages(self, member, query) -> None:
        room_id = member["room_id"]
        room = get_room(room_id)
        try:
            limit = max(1, min(int(query.get("limit", ["50"])[0]), MAX_MESSAGES_PAGE))
        except ValueError:
            limit = 50
        before = query.get("before", [None])[0]
        after = query.get("after", [None])[0]
        conn = db()

        if after is not None:
            try:
                after_seq = int(after)
            except ValueError:
                raise ApiError(400, "bad_query", "参数无效")
            rows = conn.execute(
                "SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
                (room_id, after_seq, limit),
            ).fetchall()
            has_more = len(rows) == limit
        else:
            before_seq = None
            if before is not None:
                try:
                    before_seq = int(before)
                except ValueError:
                    raise ApiError(400, "bad_query", "参数无效")
            if before_seq is None:
                before_seq = room["last_seq"] + 1
            rows = conn.execute(
                "SELECT * FROM messages WHERE room_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
                (room_id, before_seq, limit),
            ).fetchall()
            rows = list(reversed(rows))
            oldest = rows[0]["seq"] if rows else before_seq
            has_more = conn.execute(
                "SELECT 1 FROM messages WHERE room_id = ? AND seq < ? LIMIT 1",
                (room_id, oldest),
            ).fetchone() is not None

        member_row = db().execute("SELECT * FROM members WHERE id = ?", (member["id"],)).fetchone()
        self.send_json(200, {
            "messages": [self._serialize_message(r) for r in rows],
            "lastSeq": room["last_seq"],
            "readSeq": member_row["read_seq"],
            "hasMore": has_more,
        })

    def api_post_message(self, member) -> None:
        body = self.read_json()
        client_id = body.get("clientId")
        kind = body.get("kind")
        nonce = body.get("nonce")
        ct = body.get("ct")
        attachment_ids = body.get("attachmentIds") or []
        if not (isinstance(client_id, str) and valid_b64url(client_id, 16)):
            raise ApiError(400, "bad_message", "消息 ID 无效")
        if kind not in ("text", "image", "file"):
            raise ApiError(400, "bad_message", "消息类型无效")
        if not (isinstance(nonce, str) and valid_b64url(nonce, 12)):
            raise ApiError(400, "bad_message", "nonce 无效")
        if not (isinstance(ct, str) and len(ct) <= 700_000 and B64URL_RE.match(ct)):
            raise ApiError(400, "bad_message", "密文无效")
        if len(ct) > 700_000:
            raise ApiError(413, "too_large", "消息太大")
        try:
            b64url_decode(ct)
        except Exception:
            raise ApiError(400, "bad_message", "密文无效")
        if not isinstance(attachment_ids, list) or len(attachment_ids) > 10:
            raise ApiError(400, "bad_message", "附件列表无效")
        if not LIMITER.hit(f"msg:{member['id']}", 120, 60):
            raise ApiError(429, "rate_limited", "发得太快了")

        room_id = member["room_id"]
        conn = db()
        existing = conn.execute(
            "SELECT * FROM messages WHERE room_id = ? AND client_id = ?", (room_id, client_id)
        ).fetchone()
        if existing:
            self.send_json(200, {"message": self._serialize_message(existing), "duplicate": True})
            return

        if attachment_ids:
            for aid in attachment_ids:
                if not (isinstance(aid, str) and ATTACH_ID_RE.match(aid)):
                    raise ApiError(400, "bad_attachment", "附件 ID 无效")
                row = conn.execute(
                    "SELECT * FROM attachments WHERE id = ? AND room_id = ? AND uploader_id = ?",
                    (aid, room_id, member["id"]),
                ).fetchone()
                if row is None:
                    raise ApiError(404, "attachment_missing", "附件不存在或不属于你")

        now = now_ms()
        raw_ct = b64url_decode(ct)
        try:
            conn.execute("BEGIN IMMEDIATE")
            seq_row = conn.execute(
                "UPDATE rooms SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq",
                (room_id,),
            ).fetchone()
            seq = seq_row["last_seq"]
            cur = conn.execute(
                "INSERT INTO messages (room_id, seq, sender_id, kind, nonce, ct, client_id, created_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (room_id, seq, member["id"], kind, nonce, raw_ct, client_id, now),
            )
            message_id = cur.lastrowid
            for aid in attachment_ids:
                conn.execute(
                    "UPDATE attachments SET message_id = ? WHERE id = ?", (message_id, aid)
                )
            conn.execute("COMMIT")
        except sqlite3.IntegrityError:
            conn.execute("ROLLBACK")
            existing = conn.execute(
                "SELECT * FROM messages WHERE room_id = ? AND client_id = ?", (room_id, client_id)
            ).fetchone()
            if existing:
                self.send_json(200, {"message": self._serialize_message(existing), "duplicate": True})
                return
            raise ApiError(409, "conflict", "消息冲突，请重试")
        except Exception:
            conn.execute("ROLLBACK")
            raise

        msg = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        payload = self._serialize_message(msg)
        BUS.publish(room_id, "message", {"message": payload}, exclude=member["id"])
        self.send_json(201, {"message": payload})

    def api_read(self, member) -> None:
        body = self.read_json()
        seq = body.get("seq")
        if not isinstance(seq, int) or seq < 0:
            raise ApiError(400, "bad_seq", "参数无效")
        db().execute(
            "UPDATE members SET read_seq = MAX(read_seq, ?) WHERE id = ?", (seq, member["id"])
        )
        BUS.publish(member["room_id"], "read",
                    {"memberId": member["id"], "seq": seq}, exclude=member["id"])
        self.send_json(200, {"ok": True})

    def api_typing(self, member) -> None:
        self.read_json(16 * 1024)
        if not LIMITER.hit(f"typing:{member['id']}", 90, 60):
            raise ApiError(429, "rate_limited", "太频繁")
        BUS.publish(member["room_id"], "typing",
                    {"memberId": member["id"], "at": now_ms()}, exclude=member["id"])
        self.send_json(200, {"ok": True})

    # ---- SSE ----

    def api_events(self, member) -> None:
        room_id = member["room_id"]
        sid, q = BUS.subscribe(room_id, member["id"])
        self.send_response(200)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        room = get_room(room_id)

        def write(event: str, data: dict) -> None:
            chunk = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            self.wfile.write(chunk.encode("utf-8"))
            self.wfile.flush()

        try:
            write("hello", {
                "lastSeq": room["last_seq"],
                "online": BUS.online(room_id),
                "serverTime": now_ms(),
            })
            BUS.publish(room_id, "presence", {"online": BUS.online(room_id), "memberId": member["id"]},
                        exclude=member["id"])
            while not STOP.is_set():
                try:
                    event, data = q.get(timeout=15)
                    write(event, data)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            BUS.unsubscribe(room_id, sid)
            try:
                BUS.publish(room_id, "presence",
                            {"online": BUS.online(room_id), "memberId": member["id"]},
                            exclude=member["id"])
            except Exception:
                pass
            self.close_connection = True

    # ---- 附件 ----

    def api_upload_attachment(self, member, attachment_id: str) -> None:
        if not LIMITER.hit(f"upload:{member['id']}", 30, 60):
            raise ApiError(429, "rate_limited", "上传太频繁")
        nonce = self.headers.get("X-Nonce", "")
        if not (nonce and valid_b64url(nonce, 12)):
            raise ApiError(400, "bad_nonce", "附件 nonce 无效")
        raw = self.read_body(MAX_ATTACHMENT)
        if not raw:
            raise ApiError(400, "empty", "附件为空")
        conn = db()
        exists = conn.execute("SELECT 1 FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
        if exists:
            raise ApiError(409, "exists", "附件已存在")
        rel = f"{attachment_id[:2]}/{attachment_id}.bin"
        target = BLOB_DIR / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(raw)
        os.replace(tmp, target)
        conn.execute(
            "INSERT INTO attachments (id, room_id, uploader_id, message_id, size, nonce, path, created_at)"
            " VALUES (?,?,?,NULL,?,?,?,?)",
            (attachment_id, member["room_id"], member["id"], len(raw), nonce, rel, now_ms()),
        )
        self.send_json(201, {"id": attachment_id, "size": len(raw)})

    def api_download_attachment(self, member, attachment_id: str) -> None:
        row = db().execute(
            "SELECT * FROM attachments WHERE id = ? AND room_id = ?",
            (attachment_id, member["room_id"]),
        ).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "附件不存在")
        path = BLOB_DIR / row["path"]
        if not path.is_file():
            raise ApiError(404, "not_found", "附件文件丢失")
        data = path.read_bytes()
        self.send_response(200)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.send_header("X-Nonce", row["nonce"])
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---- 审计 ----

    def api_audit(self, member) -> None:
        rows = db().execute(
            "SELECT * FROM audit WHERE room_id = ? ORDER BY ts DESC LIMIT 100", (member["room_id"],)
        ).fetchall()
        self.send_json(200, {"events": [
            {
                "ts": r["ts"],
                "action": r["action"],
                "memberId": r["member_id"],
                "detail": r["detail"],
            } for r in rows
        ]})


# --------------------------------------------------------------------------
# 启动
# --------------------------------------------------------------------------

def lan_ips() -> list[str]:
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return ips


class ChatHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # 不用 HTTPServer 默认的 getfqdn：某些网络下反查 DNS 会卡几十秒甚至更久，
        # 表现就是进程起来了但端口一直不监听。
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


def main() -> int:
    global DATA_DIR, DB_PATH, BLOB_DIR
    parser = argparse.ArgumentParser(description="两人私密聊天服务")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认全部网卡）")
    parser.add_argument("--port", type=int, default=8787, help="端口（默认 8787）")
    parser.add_argument("--data-dir", default=None, help="数据目录（默认 private-chat/data）")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args()

    if args.data_dir:
        DATA_DIR = Path(args.data_dir).resolve()
        DB_PATH = DATA_DIR / "chat.db"
        BLOB_DIR = DATA_DIR / "blobs"

    init_db()

    server = ChatHTTPServer((args.host, args.port), Handler)
    actual_port = server.server_address[1]
    print(f"\n  私密双人聊天 v{VERSION}")
    print(f"  数据目录: {DATA_DIR}")
    print(f"  本机访问: http://127.0.0.1:{actual_port}")
    for ip in lan_ips():
        print(f"  局域网:   http://{ip}:{actual_port}   (手机连同一 Wi-Fi 打开)")
    print("  按 Ctrl+C 停止\n")
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{actual_port}")).start()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\n  收工。")
    finally:
        STOP.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
