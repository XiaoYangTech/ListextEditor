# Local voice bridge for ListextEditor (Windows only; called from preload.js).
# macOS/Linux never use system TTS, so this script is Windows-only by design.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 files as ANSI
# unless they carry a UTF-8 BOM, so non-ASCII literals here would corrupt the syntax.
# Chinese user-facing messages are composed on the JavaScript side.
#
# Usage:
#   -Action List
#       Lists every local voice (classic SAPI5 + Windows 11 natural voices + OneCore).
#       Prints a JSON array: [{name, lang, gender, engine}]
#
#   -Action Say -Voice <name> -TextFile <utf8 file> -Rate <0.5..2.0> -Out <wav path>
#       Renders text to a WAV file. Prints {ok:true,path,engine,fallback} or {ok:false,error}.
#
#   -Action Serve
#       Resident mode for low latency: reading one JSON request per line from stdin and
#       writing one JSON response per line to stdout (requests are serialized by the caller).
#       Starting powershell.exe costs ~1.7s on a typical machine, so paying it once per app
#       run instead of once per utterance is the whole point of this mode.
#       Requests: {cmd:"list"} | {cmd:"say", voice, textFile, rate, out} | {cmd:"exit"}
#       Exits by itself on stdin EOF, so no orphan process survives the app.
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
  [Parameter(Mandatory = $true)][ValidateSet('List', 'Say', 'Serve')][string]$Action,
  [string]$Voice = '',
  [string]$TextFile = '',
  [double]$Rate = 1.0,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Json($obj) { ConvertTo-Json -InputObject $obj -Depth 5 -Compress }

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

function Get-VoiceList {
  $list = @()
  # classic SAPI5 (includes natural voices)
  try {
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
  } catch { }
  # OneCore (WinRT)
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
  $seen = @{}
  $uniq = @()
  foreach ($v in $list) {
    if ($v.name -and -not $seen.ContainsKey($v.name)) { $seen[$v.name] = $true; $uniq += $v }
  }
  return $uniq
}

# tiered lookup across both engines; returns @{engine;item} or $null
function Find-Voice([string]$name, $classicInstalled, $oneCoreAll) {
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

# A SAPI voice only renders text of its own language: out-of-language text produces an
# empty WAV (a 46-byte RIFF header) with no exception at all. Detect that here and return
# the voice language so the caller can explain the mismatch to the user.
function Get-SayResult([string]$engine, [string]$outFile, [string]$voiceName, [string]$lang, $notes) {
  $size = 0
  try { $size = (Get-Item -LiteralPath $outFile).Length } catch { }
  if ($size -lt 1024) {
    return @{ ok = $false; error = 'empty audio output'; engine = $engine; voice = $voiceName; lang = $lang; bytes = $size; notes = (@($notes) -join '; ') }
  }
  return @{ ok = $true; path = $outFile; engine = $engine; fallback = $false; voice = $voiceName; lang = $lang; bytes = $size }
}

function Invoke-Say([string]$wantVoice, [string]$textFile, [double]$rate, [string]$outFile) {
  if (-not $textFile -or -not (Test-Path $textFile)) { return @{ ok = $false; error = 'text file not found' } }
  $text = [string](Get-Content -Raw -Encoding UTF8 $textFile)
  if ([string]::IsNullOrWhiteSpace($text)) { return @{ ok = $false; error = 'empty text' } }
  if (-not $outFile) { return @{ ok = $false; error = 'missing output path' } }
  $outDir = Split-Path -Parent $outFile
  if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

  # SAPI rate scale is roughly 1 + 0.2 * Rate (Rate=5 ~= 2x speed)
  $rateInt = [int][Math]::Round(($rate - 1.0) * 5, [MidpointRounding]::AwayFromZero)
  if ($rateInt -gt 10) { $rateInt = 10 }
  if ($rateInt -lt -10) { $rateInt = -10 }

  $notes = @()
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

  $match = Find-Voice $wantVoice $classicInstalled $oneCoreAll

  # 1) no voice requested -> system default
  if (-not $wantVoice -and $classicSynth) {
    try {
      $classicSynth.Rate = $rateInt
      $classicSynth.SetOutputToWaveFile($outFile)
      $classicSynth.Speak($text)
      $defLang = ''
      try { $defLang = [string]$classicSynth.Voice.Culture.Name } catch { }
      return (Get-SayResult 'sapi' $outFile '' $defLang $notes)
    } catch { $notes += ('default voice failed: ' + $_.Exception.Message) }
  }

  # 2) classic SAPI5 (includes natural voices)
  if ($match -and $match.engine -eq 'sapi' -and $classicSynth) {
    try {
      $classicSynth.SelectVoice($match.item.VoiceInfo.Name)
      $classicSynth.Rate = $rateInt
      $classicSynth.SetOutputToWaveFile($outFile)
      $classicSynth.Speak($text)
      return (Get-SayResult 'sapi' $outFile ([string]$match.item.VoiceInfo.Name) ([string]$match.item.VoiceInfo.Culture.Name) $notes)
    } catch { $notes += ('SAPI synthesis failed: ' + $_.Exception.Message) }
  }

  # 3) OneCore via WinRT (voices classic SAPI5 cannot select), SSML controls rate
  if ($match -and $match.engine -eq 'onecore') {
    try {
      [void][Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
      $synth.Voice = $match.item
      $pct = [int][Math]::Round(($rate - 1.0) * 100)
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
      $fs = [System.IO.File]::Create($outFile)
      try { $read.CopyTo($fs) } finally { $fs.Dispose(); $read.Dispose() }
      return (Get-SayResult 'onecore' $outFile ([string]$match.item.DisplayName) $lang $notes)
    } catch { $notes += ('OneCore synthesis failed: ' + $_.Exception.Message) }
  }

  # 4) voice unknown on this machine: use the system default and report it
  if ($wantVoice) {
    $notes += "voice not found on this machine: $wantVoice"
    try {
      $fallbackSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
      try {
        $fallbackSynth.Rate = $rateInt
        $fallbackSynth.SetOutputToWaveFile($outFile)
        $fallbackSynth.Speak($text)
        $fbLang = ''
        try { $fbLang = [string]$fallbackSynth.Voice.Culture.Name } catch { }
        $fb = Get-SayResult 'sapi-default' $outFile $wantVoice $fbLang $notes
        $fb.fallback = $true
        $fb.requested = $wantVoice
        return $fb
      } finally { $fallbackSynth.Dispose() }
    } catch { $notes += ('default voice failed: ' + $_.Exception.Message) }
  }

  return @{ ok = $false; error = ($notes -join '; ') }
}

if ($Action -eq 'List') {
  Write-Json @(Get-VoiceList)
  exit 0
}

if ($Action -eq 'Say') {
  Write-Json (Invoke-Say $Voice $TextFile $Rate $Out)
  exit 0
}

# ------------------------------ Serve (resident) ----------------------------
if ($Action -eq 'Serve') {
  $null = Get-VoiceList   # warm up: Add-Type + engines loaded once
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }                      # parent exited -> EOF -> quit
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $req = $null
    try { $req = $line | ConvertFrom-Json } catch { continue }
    $res = $null
    try {
      switch ([string]$req.cmd) {
        'list' { $res = @{ ok = $true; voices = @(Get-VoiceList) } }
        'say' { $res = Invoke-Say ([string]$req.voice) ([string]$req.textFile) ([double]$req.rate) ([string]$req.out) }
        'exit' { $res = @{ ok = $true } }
        default { $res = @{ ok = $false; error = 'unknown cmd' } }
      }
    } catch {
      $res = @{ ok = $false; error = ('request failed: ' + $_.Exception.Message) }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $res -Depth 5 -Compress))
    [Console]::Out.Flush()
    if ([string]$req.cmd -eq 'exit') { break }
  }
  exit 0
}
