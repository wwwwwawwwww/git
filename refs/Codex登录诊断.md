# Codex 登录失败诊断报告

时间：2026-10-24 20:2x　环境：Windows，DSH 0.2.1-rc.2，插件 dsh-codex-subscription 3.1.6

## 结论

**不是插件 bug，也不是账号问题，是本机网络到不了 chatgpt.com。**

插件的 ChatGPT 订阅登录（OAuth / 设备码）必须访问 `auth.openai.com` 和 `chatgpt.com`，
之后所有能力（生图、额度、搜索、模型列表）都走 `https://chatgpt.com/backend-api/...`。
当前这台机器：DNS 被污染 + 直连被断，且没有代理在跑，所以登录流程根本走不完。

## 证据

### 1. 凭据侧：从来没登录成功过

- `C:\Users\lc\.dsh\.credentials.yaml` 里只有：
  - `deepseek-account-platform/default`（DeepSeek token）
  - `DEEPSEEK_API_KEY`
  - **没有任何 codex / ChatGPT 记录**
- `C:\Users\lc\.dsh\state\codex-subscription\` 只有一个 `diagnostic-log.jsonl`，没有 auth 文件
- 日志里只有 `codex_image_generate failed → ChatGPT subscription is not signed in`，
  **没有一条 `area:"login"` 记录** → 登录请求没走到宿主这边就失败了（浏览器那步就断了）

### 2. DNS 被污染

| 域名 | 本机解析 | 说明 |
|---|---|---|
| chatgpt.com | 174.37.54.20 | 不是 Cloudflare 的 104.18 / 172.64 段 |
| api.openai.com | 173.252.88.67 | Facebook 的 IP 段，明显投毒 |

### 3. TCP / HTTPS 直连

| 目标 | 结果 |
|---|---|
| chatgpt.com:443 | TCP 超时 |
| api.openai.com:443 | 连接被拒绝 (10061) |
| auth.openai.com:443 | TCP 能连（Cloudflare 104.18.41.241），HTTPS 返回 **403 Forbidden** |

即使 auth 能通，403 说明出口 IP 也被 Cloudflare 拦（常见于机房/被标记 IP）。

### 4. 本机没有任何代理

- 系统代理：`ProxyEnable = 0`，`AutoConfigURL` 空
- WinHTTP：`Direct access (no proxy server)`
- 环境变量：没有 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
- 没有 Clash / v2ray / sing-box 进程，也没有安装痕迹（只有「雷神加速器」，游戏加速不代理浏览器和 Electron）
- 常见代理端口（7890/1080/10809/2080…）无监听

## 修复步骤

1. **开代理**：Clash Verge / v2rayN / sing-box 任一，开启「系统代理」或 TUN 模式
   （TUN 更稳，Electron 的 fetch 也能吃到）。
2. **让 DSH 吃到代理**（二选一）：
   - 系统代理开着，重启 DSH；
   - 或设用户环境变量后重启 DSH：
     ```powershell
     setx HTTPS_PROXY "http://127.0.0.1:7890"
     setx HTTP_PROXY  "http://127.0.0.1:7890"
     ```
     （端口按你实际客户端改；插件读 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY`）
3. **验证**：在 DSH「设置 → Codex 订阅 → 诊断」看连通性；
   或终端跑 `curl -I https://chatgpt.com` 应返回 200/3xx 而不是超时。
4. **再登录**：设置 → Codex 订阅 → 登录 ChatGPT。
5. 若登录成功但仍 403 / 被拦：换干净节点（机场 IP 被 Cloudflare 标记很常见），
   或换「设备码」方式再试。

> 只改 DNS / hosts 没用：OpenAI 对 IP 段也有封锁，DNS 只是第一道。

## 备选

不打算上代理的话，Codex 生图这条路走不通（插件所有能力都依赖 chatgpt.com/backend-api），
只能退而求其次：由本鱼用代码画 Q 版平涂形象（能看，但精细度不如参考图）。
