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

function New-WorktreeBiomeConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string] $RepoRoot
  )

  $configPath = Join-Path $RepoRoot 'biome.json'
  $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  $config.files.includes = @(
    $config.files.includes | Where-Object { $_ -ne '!**/.worktrees' }
  )
  $config.files.includes += '!**/.biome-worktree-*.json'

  $worktreeConfigPath = Join-Path $RepoRoot (
    '.biome-worktree-{0}.json' -f [guid]::NewGuid().ToString()
  )
  $json = $config | ConvertTo-Json -Depth 100
  Set-Content -LiteralPath $worktreeConfigPath -Value $json -Encoding utf8

  return $worktreeConfigPath
}

Write-Host 'Running: git rev-parse --show-toplevel'
$repoRoot = Get-CheckedNativeOutput git @('rev-parse', '--show-toplevel')
Set-Location $repoRoot

Write-Host "Verifying current worktree root: $repoRoot"

if (-not (Test-Path -LiteralPath 'package.json')) {
  throw "No package.json found at resolved git root: $repoRoot"
}

$previousBiomeConfigPath = [Environment]::GetEnvironmentVariable(
  'BIOME_CONFIG_PATH',
  'Process'
)
$worktreeBiomeConfigPath = $null

try {
  if ($repoRoot -match '[\\/]\.worktrees[\\/]') {
    $worktreeBiomeConfigPath = New-WorktreeBiomeConfig $repoRoot
    $env:BIOME_CONFIG_PATH = $worktreeBiomeConfigPath
    Write-Host "Using worktree Biome config: $worktreeBiomeConfigPath"
  }

  Invoke-CheckedNative npm @('run', 'format')
  Write-Host 'Command: npm run format'
  Invoke-CheckedNative npm @('run', 'check')
  Write-Host 'Command: npm run check'
  Invoke-CheckedNative npm @('run', 'typecheck')
  Write-Host 'Command: npm run typecheck'
  Invoke-CheckedNative npm @('run', 'test')
  Write-Host 'Command: npm run test'
} finally {
  if ($null -ne $worktreeBiomeConfigPath) {
    Remove-Item -LiteralPath $worktreeBiomeConfigPath -Force -ErrorAction SilentlyContinue
  }

  if ($null -eq $previousBiomeConfigPath) {
    Remove-Item Env:\BIOME_CONFIG_PATH -ErrorAction SilentlyContinue
  } else {
    $env:BIOME_CONFIG_PATH = $previousBiomeConfigPath
  }
}
