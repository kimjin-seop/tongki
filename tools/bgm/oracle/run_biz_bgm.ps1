# BizHawk(EmuHawk) 로 tools/ext_emu/xcheck/bgm_oracle.lua 를 돌린다. 제한 시간 뒤에는 강제 종료.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File tools/bgm/oracle/run_biz_bgm.ps1 [-TimeoutSec 300] [-Wave]
#  -Wave : 소리도 함께 덤프(tools/ext_emu/work/bgm/biz_8c.wav, 부팅 프레임 0 부터 -WaveFrames 프레임)
param([int]$TimeoutSec = 300, [switch]$Wave, [int]$WaveFrames = 3600)
$proj = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$biz = Join-Path $proj "tools\ext_emu\bizhawk"
$exe = Join-Path $biz "EmuHawk.exe"
$rom = Join-Path $proj "rom\danpei.gen"
$lua = Join-Path $proj "tools\ext_emu\xcheck\bgm_oracle.lua"
$work = Join-Path $proj "tools\ext_emu\work\bgm"
New-Item -ItemType Directory -Force $work | Out-Null
$a = @("--lua=`"$lua`"")
if ($Wave) {
  $wav = Join-Path $work "biz_8c.wav"
  $a += @("--dump-type=wave", "--dump-name=`"$wav`"", "--dump-length=$WaveFrames", "--dump-close")
}
$a += "`"$rom`""
$p = Start-Process -FilePath $exe -ArgumentList $a -WorkingDirectory $biz -PassThru
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  Write-Output "TIMEOUT -> kill"
  Stop-Process -Id $p.Id -Force
} else { Write-Output ("exit " + $p.ExitCode) }
Get-Process EmuHawk -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force }
