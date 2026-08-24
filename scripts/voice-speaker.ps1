# dsh-webui voice worker (ASCII only: keep this file free of non-ASCII so it
# stays readable no matter which code page PowerShell 5.1 assumes).
#
# Two modes:
#   -ListVoices : print installed SAPI voices as one JSON array, then exit.
#   (default)   : persistent worker. Reads one JSON command per line from
#                 stdin (UTF-8) and answers one status line per command.
#
# Commands:
#   {"id":1,"cmd":"speak","text":"...","voice":"Microsoft Xiaoxiao Online","rate":0,"volume":100}
#   {"id":2,"cmd":"play","file":"C:\\path\\clip.mp3","volume":100}
#   {"id":3,"cmd":"quit"}
#
# Replies: "OK <id> <elapsedMs>" / "ERR <id> <message>" / "READY" / "BYE".
# Speak/play block, so the pipe itself is the playback queue: one utterance at
# a time, in arrival order. Interruption is done by killing this process.
param([switch]$ListVoices)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

if ($ListVoices) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $rows = @()
  foreach ($voice in $synth.GetInstalledVoices()) {
    if (-not $voice.Enabled) { continue }
    $info = $voice.VoiceInfo
    $rows += [ordered]@{
      id      = $info.Name
      name    = $info.Name
      culture = $info.Culture.Name
      gender  = $info.Gender.ToString()
      age     = $info.Age.ToString()
    }
  }
  $synth.Dispose()
  if ($rows.Count -eq 0) { Write-Output '[]' }
  else { Write-Output (ConvertTo-Json -InputObject $rows -Compress -Depth 4) }
  exit 0
}

Add-Type -AssemblyName PresentationCore
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToDefaultAudioDevice()
$player = New-Object System.Windows.Media.MediaPlayer
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
Write-Output 'READY'

while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = '0'
  try {
    $msg = $line | ConvertFrom-Json
    if ($msg.id) { $id = [string]$msg.id }
    if ($msg.cmd -eq 'quit') { break }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    if ($msg.cmd -eq 'speak') {
      if ($msg.voice) { try { $synth.SelectVoice([string]$msg.voice) } catch { } }
      if ($null -ne $msg.rate) { $synth.Rate = [int]$msg.rate }
      if ($null -ne $msg.volume) { $synth.Volume = [int]$msg.volume }
      $synth.Speak([string]$msg.text)
      Write-Output ("OK " + $id + " " + $watch.ElapsedMilliseconds)
      continue
    }
    if ($msg.cmd -eq 'play') {
      $player.Open((New-Object System.Uri([string]$msg.file)))
      $deadline = (Get-Date).AddSeconds(8)
      while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 40 }
      if ($null -ne $msg.volume) { $player.Volume = [double]([int]$msg.volume) / 100.0 }
      $player.Play()
      if ($player.NaturalDuration.HasTimeSpan) {
        $ms = [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds
        Start-Sleep -Milliseconds ($ms + 120)
      } else {
        Start-Sleep -Milliseconds 400
      }
      $player.Stop()
      $player.Close()
      Write-Output ("OK " + $id + " " + $watch.ElapsedMilliseconds)
      continue
    }
    Write-Output ("ERR " + $id + " unknown command")
  } catch {
    Write-Output ("ERR " + $id + " " + ($_.Exception.Message -replace '[\r\n]+', ' '))
  }
}
Write-Output 'BYE'
