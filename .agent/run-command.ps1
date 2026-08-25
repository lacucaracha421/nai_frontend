param(
  [string]$RequestPath = ".agent\request.json",
  [string]$OutputDir = ".agent\out"
)

$ErrorActionPreference = "Stop"
$cmdExitToken = "__CHAT_COMMAND_EXIT_FILE__"

function Write-ResultFile {
  param([hashtable]$Data)
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $Data | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $OutputDir "result.json")
}

if (-not (Test-Path $RequestPath)) {
  throw "Request file not found: $RequestPath"
}

$request = Get-Content -Raw -Path $RequestPath | ConvertFrom-Json
$id = [string]$request.id
if ([string]::IsNullOrWhiteSpace($id)) {
  throw "request.id is required"
}

$enabled = $true
if ($null -ne $request.enabled) {
  $enabled = [bool]$request.enabled
}

$shell = [string]$request.shell
if ([string]::IsNullOrWhiteSpace($shell)) {
  $shell = "powershell"
}
$shell = $shell.ToLowerInvariant()
if ($shell -notin @("powershell", "cmd")) {
  throw "request.shell must be 'powershell' or 'cmd'"
}

$timeoutSeconds = 300
if ($null -ne $request.timeout_seconds) {
  $timeoutSeconds = [int]$request.timeout_seconds
}
if ($timeoutSeconds -lt 1) { $timeoutSeconds = 1 }
if ($timeoutSeconds -gt 1800) { $timeoutSeconds = 1800 }

$force = $false
if ($null -ne $request.force) {
  $force = [bool]$request.force
}

$workspace = $env:GITHUB_WORKSPACE
if ([string]::IsNullOrWhiteSpace($workspace)) {
  $workspace = (Get-Location).Path
}

$cwd = [string]$request.cwd
if ([string]::IsNullOrWhiteSpace($cwd)) {
  $cwd = $workspace
} elseif (-not [System.IO.Path]::IsPathRooted($cwd)) {
  $cwd = Join-Path $workspace $cwd
}
$cwd = [System.IO.Path]::GetFullPath($cwd)
if (-not (Test-Path -LiteralPath $cwd -PathType Container)) {
  throw "Working directory does not exist: $cwd"
}

$scriptText = [string]$request.script
$usingCommands = $false
if ([string]::IsNullOrWhiteSpace($scriptText) -and $null -ne $request.commands) {
  $usingCommands = $true
  $lines = New-Object System.Collections.Generic.List[string]
  if ($shell -eq "powershell") {
    $lines.Add('$ErrorActionPreference = "Stop"')
    foreach ($command in $request.commands) {
      $lines.Add('$global:LASTEXITCODE = 0')
      $lines.Add([string]$command)
      $lines.Add('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
    }
  } else {
    $lines.Add('@echo on')
    $lines.Add('setlocal EnableExtensions EnableDelayedExpansion')
    foreach ($command in $request.commands) {
      $lines.Add([string]$command)
      $lines.Add(('if errorlevel 1 (set "_chat_rc=!errorlevel!" & >"' + $cmdExitToken + '" echo !_chat_rc! & exit /b !_chat_rc!)'))
    }
    $lines.Add(('>"' + $cmdExitToken + '" echo 0'))
  }
  $scriptText = $lines -join [Environment]::NewLine
}
if ([string]::IsNullOrWhiteSpace($scriptText)) {
  throw "request.script or request.commands is required"
}

$repoKey = ($env:GITHUB_REPOSITORY -replace '[^A-Za-z0-9_.-]', '_')
if ([string]::IsNullOrWhiteSpace($repoKey)) { $repoKey = "local" }
$safeId = ($id -replace '[^A-Za-z0-9_.-]', '_')
$stateDir = Join-Path $env:USERPROFILE ".chat-agent\state\$repoKey"
$markerPath = Join-Path $stateDir "$safeId.done"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Get-ChildItem -LiteralPath $OutputDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$stdoutPath = Join-Path $OutputDir "stdout.txt"
$stderrPath = Join-Path $OutputDir "stderr.txt"

if (-not $enabled) {
  Write-Host "[chat-command] request '$id' is disabled"
  Write-ResultFile @{
    id = $id
    status = "disabled"
    shell = $shell
    cwd = $cwd
    exit_code = 0
    timed_out = $false
    runner = $env:RUNNER_NAME
    github_sha = $env:GITHUB_SHA
  }
  exit 0
}

if ((Test-Path $markerPath) -and -not $force) {
  Write-Host "[chat-command] request '$id' was already executed; skipping duplicate"
  Write-ResultFile @{
    id = $id
    status = "duplicate"
    shell = $shell
    cwd = $cwd
    exit_code = 0
    timed_out = $false
    marker = $markerPath
    runner = $env:RUNNER_NAME
    github_sha = $env:GITHUB_SHA
  }
  exit 0
}

$tempBase = Join-Path $env:RUNNER_TEMP ("chat-command-" + [Guid]::NewGuid().ToString("N"))
$cmdExitPath = "$tempBase.exitcode"
$started = Get-Date

if ($shell -eq "powershell") {
  $tempScript = "$tempBase.ps1"
  if ($usingCommands) {
    $scriptText | Set-Content -Encoding UTF8 -Path $tempScript
  } else {
    @(
      '$ErrorActionPreference = "Stop"'
      $scriptText
    ) | Set-Content -Encoding UTF8 -Path $tempScript
  }
  $filePath = "$PSHOME\powershell.exe"
  $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tempScript)
} else {
  $tempScript = "$tempBase.cmd"
  if ($usingCommands) {
    $scriptText = $scriptText.Replace($cmdExitToken, $cmdExitPath)
    $scriptText | Set-Content -Encoding ASCII -Path $tempScript
  } else {
    @(
      '@echo on'
      $scriptText
    ) | Set-Content -Encoding ASCII -Path $tempScript
  }
  $filePath = $env:ComSpec
  if ([string]::IsNullOrWhiteSpace($filePath)) { $filePath = "cmd.exe" }
  $argumentList = @("/D", "/E:ON", "/V:ON", "/C", ('"' + $tempScript + '"'))
}

Write-Host "[chat-command] id=$id"
Write-Host "[chat-command] shell=$shell"
Write-Host "[chat-command] cwd=$cwd"
Write-Host "[chat-command] timeout=${timeoutSeconds}s"
Write-Host "[chat-command] starting..."

$process = Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $cwd -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$finishedInTime = $process.WaitForExit($timeoutSeconds * 1000)
$timedOut = -not $finishedInTime

if ($timedOut) {
  Write-Host "[chat-command] timeout reached; terminating process tree"
  & taskkill.exe /PID $process.Id /T /F | Out-Host
  try { $process.WaitForExit() } catch {}
  $exitCode = 124
} else {
  $process.WaitForExit()
  $process.Refresh()
  try {
    $exitCode = [int]$process.ExitCode
  } catch {
    Write-Host "[chat-command] could not read child exit code; treating as failure"
    $exitCode = 1
  }
  if ($shell -eq "cmd" -and $usingCommands -and (Test-Path $cmdExitPath)) {
    try {
      $exitCode = [int]((Get-Content -Raw -Path $cmdExitPath).Trim())
      Write-Host "[chat-command] CMD sidecar exit_code=$exitCode"
    } catch {
      Write-Host "[chat-command] invalid CMD sidecar exit code; treating as failure"
      $exitCode = 1
    }
  }
  if ($null -eq $exitCode) { $exitCode = 1 }
}

$finished = Get-Date
$durationSeconds = [Math]::Round(($finished - $started).TotalSeconds, 3)

Write-Host "[chat-command] stdout (last 400 lines)"
if (Test-Path $stdoutPath) {
  Get-Content -Path $stdoutPath | Select-Object -Last 400 | ForEach-Object { Write-Host $_ }
}
Write-Host "[chat-command] stderr (last 400 lines)"
if (Test-Path $stderrPath) {
  Get-Content -Path $stderrPath | Select-Object -Last 400 | ForEach-Object { Write-Host $_ }
}

$status = if ($timedOut) { "timeout" } elseif ($exitCode -eq 0) { "success" } else { "failure" }
Write-ResultFile @{
  id = $id
  status = $status
  shell = $shell
  cwd = $cwd
  exit_code = $exitCode
  timed_out = $timedOut
  timeout_seconds = $timeoutSeconds
  started_at = $started.ToUniversalTime().ToString("o")
  finished_at = $finished.ToUniversalTime().ToString("o")
  duration_seconds = $durationSeconds
  stdout_file = "stdout.txt"
  stderr_file = "stderr.txt"
  runner = $env:RUNNER_NAME
  github_sha = $env:GITHUB_SHA
}

@{
  id = $id
  status = $status
  exit_code = $exitCode
  finished_at = $finished.ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Encoding UTF8 -Path $markerPath

Remove-Item -Force -ErrorAction SilentlyContinue $tempScript, $cmdExitPath
Write-Host "[chat-command] completed status=$status exit_code=$exitCode duration=${durationSeconds}s"
exit ([int]$exitCode)
