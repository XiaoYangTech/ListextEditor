# Local voice bridge for ListextEditor (Windows only; called from preload.js).
# macOS/Linux never use system TTS, so this script is Windows-only by design.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 files as ANSI
# unless they carry a UTF-8 BOM, so non-ASCII literals here would corrupt the syntax.
# Chinese user-facing messages are composed on the JavaScript side.
#
#   -Action List
#       Lists every local voice (classic SAPI5 + Windows 11 natural voices + OneCore).
#       Prints a JSON array: [{name, lang, gender, engine}]
#
#   -Action Say -Voice <name> -TextFile <utf8 file> -Rate <0.5..2.0> -Out <wav path>
#       Renders text to a WAV file. Prints {ok:true,path,engine,fallback} or {ok:false,error}.
#
# Adaptivity notes (voice sets and locales differ per user):
#   * Windows 11 natural voices (Microsoft Aria / Xiaoxiao / ...) live under
#     NaturalVoiceEnumerator and are only visible to System.Speech; Chromium's
#     speechSynthesis cannot see them at all.
#   * OneCore-only voices cannot be selected by classic SAPI5, so they use WinRT.
#   * Voice lookup runs in tiers (exact -> normalized -> substring), and inside each
#     tier classic SAPI5 is tried before OneCore, so "Microsoft Huihui - Chinese
#     (Simplified, PRC)" resolves to the OneCore voice instead of the similarly
#     named "Microsoft Huihui Desktop".
#   * An unknown voice falls back to the system default voice and reports
#     fallback=true (never silent, never a hard failure).

param(
  [Parameter(Mandatory = $true)][ValidateSet('List', 'Say')][string]$Action,
  [string]$Voice = '',
  [string]$TextFile = '',
  [double]$Rate = 1.0,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Json($obj) { ConvertTo-Json -InputObject $obj -Depth 4 -Compress }

# "Microsoft Huihui - Chinese (Simplified, PRC)" -> "Microsoft Huihui"
# WinRT exposes short display names while Chromium/registry use the long form.
function Get-CoreVoiceName([string]$n) {
  if ($n -match '^(.*?)\s+-\s+') { return $Matches[1].Trim() }
  return $n.Trim()
}

# PowerShell 5.1 does not project WinRT async objects, so awaiting needs reflection
# (the canonical AsTask<T> route). Returns the operation result.
function Await-AsyncOp($op, [Type]$resultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  if (-not $asTask) { throw 'AsTask reflection not available' }
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
  if (-not $task.Wait(120000)) { throw 'synthesis timed out' }
  return $task.Result
}

function Get-ClassicVoices {
  $list = @()
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    foreach ($v in $synth.GetInstalledVoices()) {
      if (-not $v.Enabled) { continue }
      $info = $v.VoiceInfo
      $list += [pscustomobject]@{
        name   = [string]$info.Name
        lang   = [string]$info.Culture.Name
        gender = [string]$info.Gender
        engine = 'sapi'
      }
    }
  } finally { $synth.Dispose() }
  return $list
}

function Get-OneCoreVoices {
  $list = @()
  try {
    [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
    foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
      $list += [pscustomobject]@{
        name   = [string]$v.DisplayName
        lang   = [string]$v.Language
        gender = [string]$v.Gender
        engine = 'onecore'
      }
    }
  } catch { }
  return $list
}

if ($Action -eq 'List') {
  $all = @()
  try { $all += Get-ClassicVoices } catch { }
  try { $all += Get-OneCoreVoices } catch { }
  $seen = @{}
  $uniq = @()
  foreach ($v in $all) {
    if ($v.name -and -not $seen.ContainsKey($v.name)) { $seen[$v.name] = $true; $uniq += $v }
  }
  ConvertTo-Json -InputObject @($uniq) -Depth 4 -Compress
  exit 0
}

# --------------------------------- Say -------------------------------------

if (-not $TextFile -or -not (Test-Path $TextFile)) { Write-Json @{ ok = $false; error = 'text file not found' }; exit 1 }
$text = [string](Get-Content -Raw -Encoding UTF8 $TextFile)
if ([string]::IsNullOrWhiteSpace($text)) { Write-Json @{ ok = $false; error = 'empty text' }; exit 1 }
if (-not $Out) { Write-Json @{ ok = $false; error = 'missing output path' }; exit 1 }
$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

# SAPI rate scale is roughly 1 + 0.2 * Rate (Rate=5 ~= 2x speed)
$rateInt = [int][Math]::Round(($Rate - 1.0) * 5, [MidpointRounding]::AwayFromZero)
if ($rateInt -gt 10) { $rateInt = 10 }
if ($rateInt -lt -10) { $rateInt = -10 }

$notes = @()

# enumerate both engines once (each may be unavailable on some systems)
$classicSynth = $null
$classicInstalled = @()
try {
  Add-Type -AssemblyName System.Speech
  $classicSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $classicSynth.GetInstalledVoices()) { if ($v.Enabled) { $classicInstalled += $v } }
} catch { $notes += ('System.Speech unavailable: ' + $_.Exception.Message) }

$oneCoreAll = @()
try {
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $oneCoreAll = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)
} catch { }

# tiered lookup across both engines; returns @{engine;item} or $null
function Find-Voice([string]$name) {
  if (-not $name) { return $null }
  $want = Get-CoreVoiceName $name
  foreach ($tier in @('exact', 'normalized', 'substring')) {
    foreach ($v in $classicInstalled) {
      $n = [string]$v.VoiceInfo.Name
      if ($tier -eq 'exact' -and $n -ieq $name) { return @{ engine = 'sapi'; item = $v } }
      if ($tier -eq 'normalized' -and (Get-CoreVoiceName $n) -ieq $want) { return @{ engine = 'sapi'; item = $v } }
      if ($tier -eq 'substring' -and $n -like "*$want*") { return @{ engine = 'sapi'; item = $v } }
    }
    foreach ($v in $oneCoreAll) {
      $n = [string]$v.DisplayName
      if ($tier -eq 'exact' -and $n -ieq $name) { return @{ engine = 'onecore'; item = $v } }
      if ($tier -eq 'normalized' -and (Get-CoreVoiceName $n) -ieq $want) { return @{ engine = 'onecore'; item = $v } }
      if ($tier -eq 'substring' -and $n -like "*$want*") { return @{ engine = 'onecore'; item = $v } }
    }
  }
  return $null
}

$match = Find-Voice $Voice
$done = $false

# 1) system default voice (no voice requested)
if (-not $Voice -and $classicSynth) {
  try {
    $classicSynth.Rate = $rateInt
    $classicSynth.SetOutputToWaveFile($Out)
    $classicSynth.Speak($text)
    Write-Json @{ ok = $true; path = $Out; engine = 'sapi'; fallback = $false }
    $done = $true
  } catch { $notes += ('default voice failed: ' + $_.Exception.Message) }
}

# 2) resolved voice that classic SAPI5 can render (includes natural voices)
if (-not $done -and $match -and $match.engine -eq 'sapi' -and $classicSynth) {
  try {
    $classicSynth.SelectVoice($match.item.VoiceInfo.Name)
    $classicSynth.Rate = $rateInt
    $classicSynth.SetOutputToWaveFile($Out)
    $classicSynth.Speak($text)
    Write-Json @{ ok = $true; path = $Out; engine = 'sapi'; fallback = $false }
    $done = $true
  } catch { $notes += ('SAPI synthesis failed: ' + $_.Exception.Message) }
}

# 3) resolved voice only OneCore can render (WinRT, SSML controls rate)
if (-not $done -and $match -and $match.engine -eq 'onecore') {
  try {
    [void][Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
    $synth.Voice = $match.item
    $pct = [int][Math]::Round(($Rate - 1.0) * 100)
    $sign = if ($pct -ge 0) { '+' } else { '' }
    $lang = [string]$match.item.Language
    if (-not $lang) { $lang = [System.Globalization.CultureInfo]::CurrentUICulture.Name }
    if (-not $lang) { $lang = 'en-US' }
    $escaped = [System.Security.SecurityElement]::Escape($text)
    $ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + $lang + '"><prosody rate="' + $sign + $pct + '%">' + $escaped + '</prosody></speak>'
    $op = $null
    try { $op = $synth.SynthesizeSsmlToStreamAsync($ssml) } catch { $op = $synth.SynthesizeTextToStreamAsync($text) }
    $stream = Await-AsyncOp $op ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $read = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $fs = [System.IO.File]::Create($Out)
    try { $read.CopyTo($fs) } finally { $fs.Dispose(); $read.Dispose() }
    Write-Json @{ ok = $true; path = $Out; engine = 'onecore'; fallback = $false }
    $done = $true
  } catch { $notes += ('OneCore synthesis failed: ' + $_.Exception.Message) }
}

# 4) voice unknown on this machine: use the system default and report it
if (-not $done -and $Voice) {
  $notes += "voice not found on this machine: $Voice"
  try {
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
      $synth.Rate = $rateInt
      $synth.SetOutputToWaveFile($Out)
      $synth.Speak($text)
      Write-Json @{ ok = $true; path = $Out; engine = 'sapi-default'; fallback = $true; requested = $Voice; notes = ($notes -join '; ') }
      $done = $true
    } finally { $synth.Dispose() }
  } catch { $notes += ('default voice failed: ' + $_.Exception.Message) }
}

if (-not $done) {
  Write-Json @{ ok = $false; error = ($notes -join '; ') }
  exit 1
}
exit 0
