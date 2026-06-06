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

Write-Host 'Agent preflight: fetching current origin/main only.'
Write-Host 'This intentionally does not run Biome, tests, build, or package checks.'
# Lightweight pre-worktree command: git fetch origin main
Invoke-CheckedNative git @('fetch', 'origin', 'main')

$fetchedBase = Get-CheckedNativeOutput git @('rev-parse', 'FETCH_HEAD')
$originMain = Get-CheckedNativeOutput git @('rev-parse', 'origin/main')

Write-Host "Fetched FETCH_HEAD: $fetchedBase"
Write-Host "Current origin/main: $originMain"
