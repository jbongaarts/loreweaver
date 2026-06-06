$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-CheckedNative {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,
    [Parameter(Mandatory = $true)]
    [string[]] $ArgumentList
  )

  Write-Host "Running: $FilePath $($ArgumentList -join ' ')"
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-CheckedNativeOutput {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,
    [Parameter(Mandatory = $true)]
    [string[]] $ArgumentList
  )

  $output = & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
  }

  return (($output | Out-String).Trim())
}

Write-Host 'Running: git rev-parse --show-toplevel'
$repoRoot = Get-CheckedNativeOutput git @('rev-parse', '--show-toplevel')
Set-Location $repoRoot

Write-Host "Verifying current worktree root: $repoRoot"

if (-not (Test-Path -LiteralPath 'package.json')) {
  throw "No package.json found at resolved git root: $repoRoot"
}

Invoke-CheckedNative npm @('run', 'format')
Write-Host 'Command: npm run format'
Invoke-CheckedNative npm @('run', 'check')
Write-Host 'Command: npm run check'
Invoke-CheckedNative npm @('run', 'typecheck')
Write-Host 'Command: npm run typecheck'
Invoke-CheckedNative npm @('run', 'test')
Write-Host 'Command: npm run test'
