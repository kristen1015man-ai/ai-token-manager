$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $Root "sparkloom-windows.ps1") -Mode Start
