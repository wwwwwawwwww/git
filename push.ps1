<#
    push.ps1 —— 一键推送到 GitHub

    用法：
        .\push.ps1                          # 默认走 SSH（.ssh\id_ed25519_github）
        .\push.ps1 -Https                   # 强制走 HTTPS + token
        .\push.ps1 -Token ghp_xxx           # HTTPS 模式：直接给 token
        .\push.ps1 -GitArgs 'origin','dev'  # 透传参数给 git push

    说明：
      · 现在默认用 SSH（ssh.github.com:443）。本机 github.com:443 的 HTTPS 被
        网络按 SNI 阻断，HTTPS 只在挂代理时才通，所以降级成备用路线。
      · 沙箱里 ~/.ssh 写不进去，私钥放在仓库的 .ssh\ 目录（已 gitignore）。
      · 沙箱里 cygwin 的 sh.exe / openssl.exe 起不了信号管道，所以 SSH 走
        .ssh\ssh-gh.cmd 包装器调用 Windows 自带 OpenSSH，并设 GIT_SSH_VARIANT=ssh
        （不设的话 git 会把 ssh 当 simple 变体，拒绝 ssh:// URL 里的端口）。
      · HTTPS 路线保留原来的兜底：token 不落盘、schannel 报错自动换 OpenSSL + 本地 CA。
#>
[CmdletBinding()]
param(
    [string]$Token = $env:GITHUB_TOKEN,
    [string]$RepoPath = '',
    [string[]]$GitArgs = @(),
    [switch]$Https
)

# PS 5.1 的 param 默认值里拿不到 $PSScriptRoot，这里补上
if (-not $RepoPath) { $RepoPath = $PSScriptRoot }
if (-not $RepoPath) { $RepoPath = Split-Path -Parent $MyInvocation.MyCommand.Path }

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 工具函数
function Get-CaBundle {
    # 找一个 OpenSSL 能读的 CA 文件：优先 .git 目录（纯本地、不被 git 跟踪）
    $dest = Join-Path $RepoPath '.git\ca-bundle.crt'
    if (Test-Path $dest) { return $dest }

    $gitExe = (Get-Command git).Source
    $root = Split-Path -Parent (Split-Path -Parent $gitExe)
    foreach ($rel in 'ucrt64\etc\ssl\certs\ca-bundle.crt',
                     'mingw64\etc\ssl\certs\ca-bundle.crt',
                     'etc\ssl\certs\ca-bundle.crt') {
        $src = Join-Path $root $rel
        if (Test-Path $src) {
            try {
                Copy-Item $src $dest -Force
                return $dest
            } catch {
                Write-Host "  (无法写入 $dest，改用原路径)" -ForegroundColor DarkYellow
                return $src
            }
        }
    }
    return $null
}

function Get-SshPushUrl {
    $origin = (& git remote get-url origin 2>$null)
    if ($origin -match 'github\.com[:/](?<slug>[^/]+/[^/]+?)(?:\.git)?/?$') {
        return "ssh://git@ssh.github.com:443/$($Matches.slug).git"
    }
    return $null
}

function Invoke-GitPushSsh([string]$Url, [string[]]$Refs) {
    # 包装器 + 变体声明都靠环境变量传，别用 core.sshCommand：
    # 那玩意带空格时 git 会丢给 cygwin sh 执行，沙箱里直接挂。
    $env:GIT_SSH = Join-Path $RepoPath '.ssh\ssh-gh.cmd'
    $env:GIT_SSH_VARIANT = 'ssh'
    $ErrorActionPreference = 'Continue'
    $out = & git push $Url @Refs 2>&1
    return [pscustomobject]@{
        Code   = $LASTEXITCODE
        Output = @($out | ForEach-Object { "$_" })
    }
}

function Invoke-GitPush([string]$CaFile) {
    # git 往 stderr 写东西时，$ErrorActionPreference='Stop' 会把它当异常抛出，
    # 这里临时放宽，靠 $LASTEXITCODE 判断成败
    $ErrorActionPreference = 'Continue'
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$Token"))
    $auth = "http.https://github.com/.extraheader=AUTHORIZATION: basic $basic"

    # 注意：必须显式写参数，不能把带空格的 -c 值塞进数组去 splat，
    # PS 5.1 会把 "AUTHORIZATION: basic xxx" 拆成两个参数。
    if ($CaFile) {
        $out = & git -c 'credential.helper=' `
                     -c 'http.sslBackend=openssl' `
                     -c "http.sslCAInfo=$CaFile" `
                     -c $auth `
                     push @GitArgs 2>&1
    } else {
        $out = & git -c 'credential.helper=' -c $auth push @GitArgs 2>&1
    }

    return [pscustomobject]@{
        Code   = $LASTEXITCODE
        Output = @($out | ForEach-Object { "$_" -replace 'github_pat_\S+', '<redacted>' })
    }
}

# ---------------------------------------------------------------- 主流程
Set-Location $RepoPath

if (-not (Test-Path (Join-Path $RepoPath '.git'))) {
    Write-Host "这里不是 git 仓库: $RepoPath" -ForegroundColor Red
    exit 1
}

$sshKey    = Join-Path $RepoPath '.ssh\id_ed25519_github'
$sshWrap   = Join-Path $RepoPath '.ssh\ssh-gh.cmd'
$useSsh    = (-not $Https) -and (Test-Path $sshKey) -and (Test-Path $sshWrap)

if ($useSsh) {
    $url = Get-SshPushUrl
    if (-not $url) {
        Write-Host '读不出 origin 是哪个 GitHub 仓库，改走 HTTPS。' -ForegroundColor Yellow
        $useSsh = $false
    }
}

if ($useSsh) {
    $branch = (& git rev-parse --abbrev-ref HEAD)
    $refs   = if ($GitArgs.Count -gt 0) { $GitArgs } else { @("$branch`:$branch") }

    Write-Host "正在通过 SSH 推送 -> $url" -ForegroundColor Cyan
    $r = Invoke-GitPushSsh $url $refs
    $r.Output | ForEach-Object { Write-Host $_ }
    if ($r.Code -eq 0) {
        Write-Host '推送成功（SSH）' -ForegroundColor Green
    } else {
        Write-Host "SSH 推送失败 (exit $($r.Code))" -ForegroundColor Red
        Write-Host '提示: 确认 .ssh\id_ed25519_github 已挂到 GitHub 账号，' -ForegroundColor Yellow
        Write-Host '      并且 ssh.github.com:443 没被网络拦。' -ForegroundColor Yellow
    }
    exit $r.Code
}

# ---------------- HTTPS 备用路线 ----------------
# DNS 预检：hosts 又被写回去的话，直接说清楚，别让它报个看不懂的错
try {
    $ips = [Net.Dns]::GetHostAddresses('github.com') |
           Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
           ForEach-Object { $_.IPAddressToString }
} catch {
    $ips = @()
}
if (($ips -contains '127.0.0.1') -or (-not $ips)) {
    Write-Host "警告: github.com 解析结果异常 ($($ips -join ','))" -ForegroundColor Yellow
    Write-Host "      多半是 hosts 里又出现了 127.0.0.1 github.com 这类记录。" -ForegroundColor Yellow
}

if (-not $Token) {
    $sec = Read-Host -AsSecureString '请粘贴 GitHub Token（输入不回显）'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
        $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
if (-not $Token) {
    Write-Host '没有 token，无法推送。' -ForegroundColor Red
    exit 1
}

$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

Write-Host '正在推送...' -ForegroundColor Cyan
$r = Invoke-GitPush

if (($r.Code -ne 0) -and (($r.Output -join "`n") -match 'schannel|SEC_E|SSL|certificate')) {
    Write-Host '系统 TLS 不可用，改用 OpenSSL 后端重试...' -ForegroundColor Yellow
    $ca = Get-CaBundle
    if ($ca) {
        $r = Invoke-GitPush $ca
    } else {
        Write-Host '找不到可用的 CA 文件，跳过重试。' -ForegroundColor Red
    }
}

$r.Output | ForEach-Object { Write-Host $_ }

if ($r.Code -eq 0) {
    Write-Host '推送成功' -ForegroundColor Green
} else {
    Write-Host "推送失败 (exit $($r.Code))" -ForegroundColor Red
    $joined = $r.Output -join "`n"
    if ($joined -match 'Invalid username or token|Authentication failed|could not read Username') {
        Write-Host '提示: token 无效或权限不足。Fine-grained token 需要' -ForegroundColor Yellow
        Write-Host '      仓库访问权限 + Permissions → Contents: Read and write。' -ForegroundColor Yellow
    }
}
exit $r.Code
