[CmdletBinding()]
param(
  [ValidateSet("Launch", "Install", "Start", "Repair")]
  [string]$Mode = "Launch"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch {}

$StudioUrl = "https://ai.seapllo.com/studio"
$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallRoot = Join-Path $env:LOCALAPPDATA "SparkloomAgent"
$AppRoot = Join-Path $InstallRoot "app"
$LogRoot = Join-Path $InstallRoot "logs"
$PidFile = Join-Path $InstallRoot "agent.pid"
$ConfigRoot = Join-Path $env:USERPROFILE ".sparkloom"
$TokenFile = Join-Path $ConfigRoot "agent-token"

function Get-Expected-Version {
  $packageFile = Join-Path $AppRoot "package.json"
  try {
    $package = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
    return [string]$package.version
  } catch {
    return ""
  }
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Assert-Extracted {
  $required = @(
    (Join-Path $SourceRoot "src\index.mjs"),
    (Join-Path $SourceRoot "package.json")
  )
  foreach ($file in $required) {
    if (-not (Test-Path -LiteralPath $file)) {
      Write-Host ""
      Write-Host "Please extract the zip file first, then run Start Sparkloom.cmd from the extracted folder." -ForegroundColor Yellow
      Write-Host "Required files are missing. This usually happens when running inside the compressed-folder preview."
      exit 1
    }
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $current = $env:Path
  $extra = @()
  if ($env:APPDATA) { $extra += (Join-Path $env:APPDATA "npm") }
  if ($env:LOCALAPPDATA) {
    $extra += (Join-Path $env:LOCALAPPDATA "Programs\nodejs")
    $extra += (Join-Path $env:LOCALAPPDATA "pnpm")
    $extra += (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages")
  }
  if ($env:ProgramFiles) { $extra += (Join-Path $env:ProgramFiles "nodejs") }
  $env:Path = (@($current, $machine, $user) + $extra | Where-Object { $_ } | Select-Object -Unique) -join ";"
}

function Has-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-ToolPath {
  param([string]$Name)
  $paths = @()
  try {
    $paths = @(where.exe $Name 2>$null | Where-Object { $_ })
  } catch {}
  if ($Name -eq "python") {
    $paths = @($paths | Where-Object { $_ -notmatch "\\Microsoft\\WindowsApps\\" })
  }
  $preferred = @($paths | Where-Object { $_ -match "\.(exe|cmd|bat)$" } | Select-Object -First 1)
  if ($preferred.Count -gt 0) { return [string]$preferred[0] }
  if ($paths.Count -gt 0) { return [string]$paths[0] }

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return [string]$command.Source }
  return ""
}

function Quote-CmdArgument {
  param([string]$Value)
  if ($Value -match '[\s"&|<>^]') {
    return '"' + $Value.Replace('"', '""') + '"'
  }
  return $Value
}

function Invoke-ToolProbe {
  param(
    [string]$Name,
    [string[]]$Args = @("--version"),
    [int]$TimeoutSec = 8
  )
  $toolPath = Resolve-ToolPath -Name $Name
  if (-not $toolPath) {
    return [pscustomobject]@{ Found = $false; Ok = $false; Output = "$Name not found"; Path = "" }
  }

  $process = $null
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($toolPath -match "\.(cmd|bat)$") {
      $comspec = if ($env:ComSpec) { $env:ComSpec } else { "cmd.exe" }
      $line = (Quote-CmdArgument $toolPath) + " " + (($Args | ForEach-Object { Quote-CmdArgument $_ }) -join " ")
      $psi.FileName = $comspec
      $psi.Arguments = "/d /c " + $line
    } elseif ($toolPath -match "\.ps1$") {
      $psi.FileName = "powershell.exe"
      $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Quote-CmdArgument $toolPath) + " " + (($Args | ForEach-Object { Quote-CmdArgument $_ }) -join " ")
    } else {
      $psi.FileName = $toolPath
      $psi.Arguments = (($Args | ForEach-Object { Quote-CmdArgument $_ }) -join " ")
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    if (-not $process.WaitForExit($TimeoutSec * 1000)) {
      try { $process.Kill() } catch {}
      return [pscustomobject]@{ Found = $true; Ok = $false; Output = "$Name probe timed out"; Path = $toolPath }
    }
    $output = $process.StandardOutput.ReadToEnd() + "`n" + $process.StandardError.ReadToEnd()
    $hasVersionOutput = [bool](($output -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
    $exitOk = $process.ExitCode -eq 0 -or $hasVersionOutput
    return [pscustomobject]@{ Found = $true; Ok = $exitOk; Output = $output; Path = $toolPath }
  } catch {
    return [pscustomobject]@{ Found = $true; Ok = $false; Output = $_.Exception.Message; Path = $toolPath }
  }
}

function Test-CommandWorks {
  param(
    [string]$Name,
    [string[]]$Args = @("--version"),
    [int]$TimeoutSec = 8
  )
  $probe = Invoke-ToolProbe -Name $Name -Args $Args -TimeoutSec $TimeoutSec
  return [bool]$probe.Ok
}

function Get-CommandVersionLine {
  param(
    [string]$Name,
    [string[]]$Args = @("--version"),
    [int]$TimeoutSec = 8
  )
  $probe = Invoke-ToolProbe -Name $Name -Args $Args -TimeoutSec $TimeoutSec
  $line = ($probe.Output -split "`r?`n") | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1
  if (-not $line) { return "" }
  return $line.Trim()
}

function Install-WithWinget {
  param(
    [string]$CommandName,
    [string]$PackageId,
    [string]$DisplayName
  )

  Write-Host "[check] $DisplayName"
  $toolPath = Resolve-ToolPath -Name $CommandName
  if ($toolPath) {
    Write-Host "[ok] $DisplayName found: $toolPath"
    return
  }

  if (-not (Has-Command "winget")) {
    throw "$DisplayName is missing and WinGet is not available. Please contact support."
  }

  Write-Host "[install] Installing $DisplayName"
  winget install --id $PackageId -e --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "$DisplayName install failed with exit code $LASTEXITCODE"
  }
  Refresh-Path

  if (-not (Resolve-ToolPath -Name $CommandName)) {
    throw "$DisplayName was installed but is not visible in this window yet. Restart Windows, then open Sparkloom Studio from the desktop shortcut."
  }
}

function Ensure-Directories {
  New-Item -ItemType Directory -Force -Path $InstallRoot, $AppRoot, $LogRoot, $ConfigRoot | Out-Null
  Protect-ConfigDirectory
}

function Protect-ConfigDirectory {
  try {
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    icacls $ConfigRoot /inheritance:r /grant:r "*${currentUser}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
  } catch {
    Write-Warning "Could not harden Sparkloom config directory permissions. Continuing with the current user profile defaults."
  }
}

function Copy-App-To-Stable-Directory {
  $source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
  $target = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
  if ($source -ieq $target) { return }

  Write-Step "Preparing local app folder"
  $staging = Join-Path $InstallRoot "app-staging"
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  foreach ($item in @("src", "skills")) {
    Copy-Item -LiteralPath (Join-Path $SourceRoot $item) -Destination $staging -Recurse -Force
  }
  foreach ($item in @("package.json", "package-lock.json", "README.md", "sparkloom-windows.ps1", "install-windows.ps1", "start-windows.ps1")) {
    $file = Join-Path $SourceRoot $item
    if (Test-Path -LiteralPath $file) {
      Copy-Item -LiteralPath $file -Destination (Join-Path $staging $item) -Force
    }
  }

  foreach ($required in @("package.json", "src\index.mjs", "skills")) {
    if (-not (Test-Path -LiteralPath (Join-Path $staging $required))) {
      throw "Sparkloom package is incomplete: missing $required"
    }
  }

  if (Test-Agent-Online) {
    Stop-Existing-Agent
  }
  Remove-Item -LiteralPath $AppRoot -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $staging -Destination $AppRoot -Force
}

function Ensure-Dependencies {
  Write-Step "Checking local tools"
  Refresh-Path
  Install-WithWinget -CommandName "node" -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js"
  Install-WithWinget -CommandName "git" -PackageId "Git.Git" -DisplayName "Git"
  Write-Host "[check] Python (optional)"
  if (Test-CommandWorks -Name "python" -TimeoutSec 12) {
    Write-Host "[ok] Python is ready"
  } else {
    Write-Host "[skip] Python did not respond quickly. Continuing because Sparkloom Studio can run without Python."
  }

  Refresh-Path
  Write-Host "[check] npm"
  $npmPath = Resolve-ToolPath -Name "npm"
  if (-not $npmPath) {
    throw "npm is not ready. Restart Windows, then open Sparkloom Studio from the desktop shortcut."
  }
  Write-Host "[ok] npm found: $npmPath"

  Write-Host "[install] Sparkloom Agent SDK"
  Push-Location -LiteralPath $AppRoot
  try {
    npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "Sparkloom Agent dependency install failed with exit code $LASTEXITCODE"
    }
    node -e "import('@anthropic-ai/claude-agent-sdk').then((sdk)=>{ if (typeof sdk.query !== 'function') throw new Error('query export missing'); console.log('[ok] Claude Agent SDK ready') }).catch((error)=>{ console.error(error && error.message ? error.message : error); process.exit(1) })"
    if ($LASTEXITCODE -ne 0) {
      throw "Claude Agent SDK is not ready. Reopen Sparkloom Studio installer to repair dependencies."
    }
  } finally {
    Pop-Location
  }

  Write-Host "[ok] Local tools are ready"
}

function Ensure-Agent-Token {
  New-Item -ItemType Directory -Force -Path $ConfigRoot | Out-Null
  if (Test-Path -LiteralPath $TokenFile) {
    $existing = (Get-Content -LiteralPath $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($existing.Length -ge 32) { return $existing }
  }

  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  Set-Content -LiteralPath $TokenFile -Value $token -Encoding ASCII
  Protect-ConfigDirectory
  return $token
}

function Get-Agent-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:39271/health" -TimeoutSec 2
    if ($response.StatusCode -ne 200) { return $null }
    $health = $response.Content | ConvertFrom-Json
    if ($health.service -ne "sparkloom-agent") { return $null }
    if ([int]$health.protocolVersion -ne 1) { return $null }
    return $health
  } catch {
    return $null
  }
}

function Test-Agent-Online {
  return $null -ne (Get-Agent-Health)
}

function Test-Agent-Authorized {
  param([string]$Token)
  if (-not $Token) { return $false }
  try {
    $headers = @{ "x-sparkloom-agent-token" = $Token }
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:39271/claude/status" -Headers $headers -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    return [string]$cim.CommandLine
  } catch {
    return ""
  }
}

function Stop-Existing-Agent {
  Write-Step "Restarting Sparkloom"
  if (Test-Path -LiteralPath $PidFile) {
    $pidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
    $pidValue = 0
    if ([int]::TryParse($pidText, [ref]$pidValue)) {
      try {
        $process = Get-Process -Id $pidValue -ErrorAction Stop
        $commandLine = Get-ProcessCommandLine -ProcessId $pidValue
        if ($process.ProcessName -match "node|nodejs" -and ($commandLine -match "SparkloomAgent" -or $commandLine -match "src\\index\.mjs")) {
          Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        }
      } catch {}
    }
  }

  Start-Sleep -Milliseconds 500
  $portConflict = ""
  try {
    $connections = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 39271 -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      try {
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
        $commandLine = Get-ProcessCommandLine -ProcessId $connection.OwningProcess
        if ($process.ProcessName -match "node|nodejs" -and ($commandLine -match "SparkloomAgent" -or $commandLine -match "src\\index\.mjs")) {
          Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
        } else {
          $portConflict = "Port 39271 is already used by another local process. Close it, then open Sparkloom Studio again."
        }
      } catch {
        # The listener may have exited between Get-NetTCPConnection and Get-Process.
      }
    }
  } catch {}
  if ($portConflict) { throw $portConflict }

  for ($i = 0; $i -lt 12; $i += 1) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Agent-Online)) { return }
  }

  if (Test-Agent-Online) {
    throw "An older Sparkloom Agent is still running. Restart Windows, then open Sparkloom Studio from the desktop shortcut."
  }
}

function Start-Agent {
  param([string]$Token)
  $health = Get-Agent-Health
  if ($health) {
    $expectedVersion = Get-Expected-Version
    $runningVersion = [string]$health.version
    if ($expectedVersion -and $runningVersion -and $runningVersion -eq $expectedVersion -and (Test-Agent-Authorized -Token $Token)) {
      Write-Host "[ok] Sparkloom is already running"
      return
    }
    Write-Host "[update] Sparkloom Agent $runningVersion -> $expectedVersion"
    Stop-Existing-Agent
  }

  Write-Step "Starting Sparkloom"
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js is not ready. Restart Windows and try again." }

  $script = Join-Path $AppRoot "src\index.mjs"
  if (-not (Test-Path -LiteralPath $script)) { throw "Local Sparkloom files are missing. Download Sparkloom again." }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outLog = Join-Path $LogRoot "agent-$timestamp.out.log"
  $errLog = Join-Path $LogRoot "agent-$timestamp.err.log"
  $scriptArg = '"' + $script.Replace('"', '\"') + '"'
  $process = Start-Process -FilePath $node.Source -ArgumentList $scriptArg -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  Set-Content -LiteralPath $PidFile -Value ([string]$process.Id) -Encoding ASCII

  for ($i = 0; $i -lt 20; $i += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-Agent-Online) {
      Write-Host "[ok] Sparkloom started"
      return
    }
  }

  throw "Sparkloom failed to start. Logs: $LogRoot"
}

function New-Launcher-Cmd {
  $launcher = Join-Path $AppRoot "Sparkloom Studio.cmd"
  $content = @"
@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sparkloom-windows.ps1" -Mode Launch
if errorlevel 1 pause
"@
  Set-Content -LiteralPath $launcher -Value $content -Encoding ASCII
  return $launcher
}

function Create-Desktop-Shortcut {
  Write-Step "Creating desktop shortcut"
  $launcher = New-Launcher-Cmd
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Sparkloom Studio.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $AppRoot
  $shortcut.Description = "Open Sparkloom Studio"
  $shortcut.Save()
  Write-Host "[ok] Desktop shortcut created: Sparkloom Studio"
}

function Open-Studio {
  param([string]$Token)
  $encoded = [Uri]::EscapeDataString($Token)
  Start-Process "$StudioUrl#sparkloomAgentToken=$encoded"
}

function Run-Launch {
  Assert-Extracted
  Ensure-Directories
  Copy-App-To-Stable-Directory

  $source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
  $target = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
  if ($source -ine $target) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppRoot "sparkloom-windows.ps1") -Mode Launch
    exit $LASTEXITCODE
  }

  Ensure-Dependencies
  $token = Ensure-Agent-Token
  Create-Desktop-Shortcut
  Start-Agent -Token $token
  Open-Studio -Token $token
  Write-Step "Done"
  Write-Host "Sparkloom Studio has been opened. Next time, use the Sparkloom Studio desktop shortcut."
}

function Run-Start {
  Refresh-Path
  Ensure-Directories
  $token = Ensure-Agent-Token
  Start-Agent -Token $token
  Open-Studio -Token $token
}

if ($Mode -eq "Start") {
  Run-Start
} elseif ($Mode -eq "Install" -or $Mode -eq "Repair") {
  Assert-Extracted
  Ensure-Directories
  Copy-App-To-Stable-Directory
  Ensure-Dependencies
  Ensure-Agent-Token | Out-Null
  Create-Desktop-Shortcut
  Write-Step "Install complete"
} else {
  Run-Launch
}
