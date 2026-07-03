[CmdletBinding()]
param([switch]$NoStart)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Mode = if ($NoStart) { "Install" } else { "Launch" }
& (Join-Path $Root "sparkloom-windows.ps1") -Mode $Mode
