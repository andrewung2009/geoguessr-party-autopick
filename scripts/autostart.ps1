param(
  [ValidateSet('install', 'remove', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$TaskName = 'GeoGuessr Party Autopick'
$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'scripts\start-hidden.vbs'
$WScript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$User = "$env:USERDOMAIN\$env:USERNAME"

$Port = 8787
$EnvPath = Join-Path $Root '.env'
if (Test-Path -LiteralPath $EnvPath) {
  foreach ($line in Get-Content -LiteralPath $EnvPath) {
    if ($line -match '^\s*BRIDGE_PORT\s*=\s*(\d+)\s*$') {
      $Port = [int]$Matches[1]
      break
    }
  }
}
$HealthUrl = "http://127.0.0.1:$Port/health"
$Runner = Join-Path $Root 'scripts\run-bridge.cmd'

function Test-ProjectCommandLine([string]$CommandLine) {
  if (-not $CommandLine) { return $false }
  foreach ($target in @($Runner, $Launcher)) {
    if ($CommandLine.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return $true
    }
  }
  return $false
}

function Stop-BridgeProcesses {
  $processes = Get-CimInstance Win32_Process | Where-Object {
    Test-ProjectCommandLine $_.CommandLine
  }

  foreach ($process in $processes) {
    Start-Process `
      -FilePath "$env:SystemRoot\System32\taskkill.exe" `
      -ArgumentList @('/PID', $process.ProcessId, '/T', '/F') `
      -WindowStyle Hidden `
      -Wait `
      -ErrorAction SilentlyContinue | Out-Null
  }
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host "Auto-start is not installed."
    Write-Host "Run install-autostart.bat to create the scheduled task."
    return
  }

  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task:        $TaskName"
  Write-Host "State:       $($task.State)"
  Write-Host "Last run:    $($info.LastRunTime)"
  Write-Host "Last result: $($info.LastTaskResult)"
  Write-Host "Next run:    $($info.NextRunTime)"

  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    Write-Host "Bridge:      running on port $($health.port)"
    Write-Host "GeoGuessr:   $(if ($health.clientConnected) { 'connected' } else { 'not connected' })"
    Write-Host "Maps:        $($health.maps)"
    Write-Host "Remembered:  $(if ($health.rememberedMode) { $health.rememberedMode } else { 'none' })"
  } catch {
    Write-Host "Bridge:      not responding at $HealthUrl"
  }
}

function Install-Autostart {
  if (-not (Test-Path -LiteralPath $Launcher)) {
    throw "Missing launcher: $Launcher"
  }

  $action = New-ScheduledTaskAction `
    -Execute $WScript `
    -Argument "//B //Nologo `"$Launcher`"" `
    -WorkingDirectory $Root

  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User

  $principal = New-ScheduledTaskPrincipal `
    -UserId $User `
    -LogonType Interactive `
    -RunLevel Limited

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Stop-BridgeProcesses
    Start-Sleep -Seconds 1
  }

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2

  Write-Host "Auto-start installed."
  Write-Host "The bridge will start automatically when you log in."
  Write-Host "Log file: $(Join-Path $Root 'logs\bridge.log')"
  Write-Host ""
  Show-Status
}

function Remove-Autostart {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Stop-BridgeProcesses

  if (-not $task) {
    Write-Host "Auto-start is not installed."
    return
  }

  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Auto-start removed."
}

try {
  switch ($Action) {
    'install' { Install-Autostart }
    'remove' { Remove-Autostart }
    'status' { Show-Status }
  }
  exit 0
} catch {
  Write-Host "Auto-start $Action failed: $($_.Exception.Message)"
  Write-Host ""
  Write-Host "If Task Scheduler is blocked on this PC, you can use the Startup folder instead:"
  Write-Host "  Win+R -> shell:startup -> create a shortcut to start.bat"
  exit 1
}
