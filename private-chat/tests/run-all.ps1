param()

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
        $node = 'C:\Users\lc\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    }
    if (-not (Test-Path $node)) {
        Write-Host "Node not found. Install Node 18+ or edit the path in this script." -ForegroundColor Yellow
        exit 1
    }

    $tests = @('tests/test_crypto.mjs', 'tests/e2e.mjs', 'tests/dom.mjs', 'tests/dom-flows.mjs')
    $failed = New-Object System.Collections.ArrayList
    foreach ($test in $tests) {
        Write-Host ""
        Write-Host "=== $test ===" -ForegroundColor Cyan
        & $node $test
        $code = $LASTEXITCODE
        Write-Host "exit=$code"
        if ($code -ne 0) { [void]$failed.Add($test) }
    }

    Write-Host ""
    if ($failed.Count -eq 0) {
        Write-Host "All tests passed." -ForegroundColor Green
    } else {
        Write-Host ("Failed: " + ($failed -join ', ')) -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}
