# QQ <-> DSH bridge: listens to NapCat OneBot11 forward WS, feeds private messages
# from whitelisted friends to `dsh headless`, and sends the answer back.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File bridge.ps1
# Self-test: powershell -NoProfile -ExecutionPolicy Bypass -File bridge.ps1 -SelfTest "text"
param(
    [switch]$SelfTest,
    [string]$TestText = 'Self-test: this message was sent by bridge.ps1 directly.'
)
$ErrorActionPreference = 'Continue'

# ===== config =====
$BotSelf    = 3957497255
$Allow      = @(860799108)
$WsUri      = 'ws://127.0.0.1:3001'
$DshCli     = 'G:\AI及agent部署\dsh\resources\runtime\cli\bin\dsh.cmd'
$DshProfile = 'headless'
$WorkDir    = 'G:\大肥鱼工作区'
$LogFile    = 'C:\NapCat\bridge.log'
$MaxReply   = 2500

$CredFile = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Write-Log([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
    try { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 } catch {}
}

function Get-DeepSeekKey {
    try {
        $y = Get-Content -LiteralPath $CredFile -Encoding UTF8 -ErrorAction Stop
        $hit = $y | Where-Object { $_ -match 'DEEPSEEK_API_KEY\s*:\s*(\S+)' } | Select-Object -First 1
        if ($hit -match 'DEEPSEEK_API_KEY\s*:\s*(\S+)') { return $Matches[1].Trim() }
    } catch {}
    return $env:DEEPSEEK_API_KEY
}

function Send-Ob11([int64]$userId, [string]$text) {
    if ([string]::IsNullOrEmpty($text)) { return }
    $chunks = @()
    for ($i = 0; $i -lt $text.Length; $i += $MaxReply) {
        $chunks += $text.Substring($i, [Math]::Min($MaxReply, $text.Length - $i))
    }
    foreach ($c in $chunks) {
        $ws = [System.Net.WebSockets.ClientWebSocket]::new()
        $ct = [Threading.CancellationToken]::None
        try {
            $ws.ConnectAsync([Uri]$WsUri, $ct).GetAwaiter().GetResult() | Out-Null
            $body = @{
                action = 'send_private_msg'
                params = @{ user_id = "$userId"; message = @(@{ type = 'text'; data = @{ text = $c } }) }
                echo   = 'bridge-send'
            } | ConvertTo-Json -Compress -Depth 8
            $bytes = [Text.Encoding]::UTF8.GetBytes($body)
            $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult()
            $buf = New-Object byte[] 8192
            $deadline = (Get-Date).AddSeconds(15)
            while ((Get-Date) -lt $deadline) {
                $t = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct)
                if (-not $t.Wait(8000)) { break }
                $s = [Text.Encoding]::UTF8.GetString($buf, 0, $t.Result.Count)
                if ($s -match 'bridge-send') {
                    Write-Log ("sent -> {0} : {1}" -f $userId, $c.Substring(0, [Math]::Min(40, $c.Length)))
                    break
                }
            }
        } catch {
            Write-Log ("send FAIL {0} : {1}" -f $userId, $_.Exception.Message)
        } finally {
            try { $ws.Dispose() } catch {}
        }
    }
}

function Ask-Dsh([string]$task, [string]$sessionId) {
    $cliArgs = @('--profile', $DshProfile, '--json')
    if ($sessionId) { $cliArgs += @('--session-id', $sessionId) }
    $cliArgs += $task
    Push-Location $WorkDir
    try {
        $raw = & $DshCli @cliArgs 2>$null
    } finally {
        Pop-Location
    }
    $texts = @()
    $sid = $sessionId
    foreach ($line in $raw) {
        if (-not ($line -is [string])) { continue }
        $l = $line.Trim()
        if ($l.Length -eq 0 -or $l[0] -ne '{') { continue }
        try { $ev = $l | ConvertFrom-Json } catch { continue }
        switch ($ev.type) {
            'session' { if ($ev.sessionId) { $sid = $ev.sessionId } }
            'text'    { if ($ev.text) { $texts += $ev.text } }
            'error'   { $texts += ("[error] " + $ev.message) }
        }
    }
    return @{ text = ($texts -join '').Trim(); session = $sid }
}

function Handle-Message($ev) {
    $uid = [int64]$ev.user_id
    if ($uid -eq $BotSelf) { return }
    if ($Allow -notcontains $uid) { Write-Log ("ignore {0}" -f $uid); return }

    $text = ''
    if ($ev.message -is [string]) {
        $text = $ev.message
    } else {
        $parts = @()
        foreach ($seg in $ev.message) { if ($seg.type -eq 'text') { $parts += $seg.data.text } }
        $text = ($parts -join '')
    }
    $text = $text.Trim()
    if (-not $text) { Write-Log ("empty text from {0}" -f $uid); return }

    Write-Log ("recv <- {0} : {1}" -f $uid, $text)
    $sid = $script:Sessions[$uid]
    $r = Ask-Dsh -task $text -sessionId $sid
    if ($r.session) { $script:Sessions[$uid] = $r.session }
    $reply = $r.text
    if (-not $reply) { $reply = '...' }
    Send-Ob11 -userId $uid -text $reply
}

# ===== main =====
$script:Sessions = @{}
$key = Get-DeepSeekKey
if ($key) { $env:DEEPSEEK_API_KEY = $key }

if ($SelfTest) {
    Write-Log ("selftest: " + $TestText)
    $r = Ask-Dsh -task $TestText -sessionId $null
    Send-Ob11 -userId $Allow[0] -text ($r.text)
    exit 0
}

Write-Log ("bridge start (key={0}, allow={1})" -f [bool]$key, ($Allow -join ','))

while ($true) {
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ct = [Threading.CancellationToken]::None
    try {
        $ws.ConnectAsync([Uri]$WsUri, $ct).GetAwaiter().GetResult() | Out-Null
        Write-Log 'ws connected'
        $buf = New-Object byte[] 262144
        while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $sb = New-Object Text.StringBuilder
            $closed = $false
            do {
                $t = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct)
                $t.Wait()
                if ($t.Result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { $closed = $true; break }
                [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $t.Result.Count))
            } while (-not $t.Result.EndOfMessage)
            if ($closed) { break }
            $json = $sb.ToString()
            if (-not $json) { continue }
            try { $ev = $json | ConvertFrom-Json } catch { continue }
            if ($ev.post_type -eq 'message' -and $ev.message_type -eq 'private') {
                try { Handle-Message $ev } catch { Write-Log ("handle ERR: " + $_.Exception.Message) }
            }
        }
    } catch {
        Write-Log ("ws ERR: " + $_.Exception.Message)
    } finally {
        try { $ws.Dispose() } catch {}
    }
    Start-Sleep -Seconds 5
}
