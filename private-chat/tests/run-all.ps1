param()

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    $node = 'C:\Users\lc\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path $node)) {
    Write-Host "没找到 Node。请安装 Node 18+，或修改本脚本里的路径。" -ForegroundColor Yellow
    exit 1
}

$tests = @('tests/test_crypto.mjs', 'tests/e2e.mjs', 'tests/dom.mjs', 'tests/dom-flows.mjs')
$failed = @()
foreach ($test in $tests) {
    Write-Host ""
    Write-Host "=== $test ===" -ForegroundColor Cyan
    & $node $test
    if ($LASTEXITCODE -ne 0) { $failed += $test }
}

Write-Host ""
if ($failed.Count -eq 0) {
    Write-Host "全部测试通过。" -ForegroundColor Green
} else {
    Write-Host ("失败的测试: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
