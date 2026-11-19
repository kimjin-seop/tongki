# BizHawk(EmuHawk) 로 tools/ext_emu/xcheck/bgm_oracle_song.lua 를 돌린다(곡 지정판). 제한 시간 뒤에는 강제 종료.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File tools/bgm/oracle/run_biz_song.ps1 -Song 83 -Frames 21900 [-TimeoutSec 600] [-NoWave]
#  출력: tools/ext_emu/work/bgm/z80_XX.bin(프레임마다 Z80 RAM $1C00~$1EFF), biz_XX.wav(부팅 프레임 0 부터), biz_log_XX.txt
#  -Config <파일> : EmuHawk 설정 파일을 따로 지정(예: 저역 통과 필터를 끈 사본). 기본 config.ini 는 건드리지 않는다
#  -WavSuffix <글자> : 소리 파일 이름 뒤에 붙임(biz_XX<글자>.wav)
param([Parameter(Mandatory = $true)][string]$Song, [Parameter(Mandatory = $true)][int]$Frames, [int]$TimeoutSec = 600, [switch]$NoWave, [string]$Config = "", [string]$WavSuffix = "")
$proj = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$biz = Join-Path $proj "tools\ext_emu\bizhawk"
$exe = Join-Path $biz "EmuHawk.exe"
$rom = Join-Path $proj "rom\danpei.gen"
$lua = Join-Path $proj "tools\ext_emu\xcheck\bgm_oracle_song.lua"
$work = Join-Path $proj "tools\ext_emu\work\bgm"
New-Item -ItemType Directory -Force $work | Out-Null
$tag = $Song.ToLower()
Set-Content -Path (Join-Path $work "song_params.txt") -Value "$tag $Frames" -Encoding ASCII
$a = @("--lua=`"$lua`"")
if ($Config -ne "") { $a += "--config=`"$Config`"" }
if (-not $NoWave) {
  $wav = Join-Path $work "biz_$tag$WavSuffix.wav"
  $wf = $Frames + 520
  $a += @("--dump-type=wave", "--dump-name=`"$wav`"", "--dump-length=$wf", "--dump-close")
}
$a += "`"$rom`""
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exe -ArgumentList $a -WorkingDirectory $biz -PassThru
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  Write-Output "TIMEOUT -> kill"
  Stop-Process -Id $p.Id -Force
} else { Write-Output ("exit " + $p.ExitCode) }
# 이 폴더의 EmuHawk 만 정리한다(다른 곳에서 띄운 EmuHawk 는 건드리지 않는다)
Get-Process EmuHawk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object { Stop-Process -Id $_.Id -Force }
Write-Output ("elapsed_sec " + [int]$sw.Elapsed.TotalSeconds)
