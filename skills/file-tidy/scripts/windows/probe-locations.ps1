<#
.SYNOPSIS
  Print where Windows and common apps currently save files, as JSON. Reads only.
.DESCRIPTION
  Compare the output with app_settings in <Root>\_system\config.json to find drift.
  Covers Known Folders, Chromium browser download folders per profile, Steam libraries,
  WeChat / WeCom / QQ data folders when their registry values exist, and Xbox capture
  settings. Anything the script cannot read is reported as null, never guessed.
  With -Config, app_settings entries shaped {"app","expected","probe"} are compared with the
  value at the dotted probe path (e.g. known_folders.Screenshots) and listed under drift.
.EXAMPLE
  probe-locations.ps1
  probe-locations.ps1 -Config 'E:\Files\_system\config.json'
#>
param([string] $Config)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{}

$shell = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$known = [ordered]@{
  Desktop     = 'Desktop'
  Documents   = 'Personal'
  Downloads   = '{374DE290-123F-4565-9164-39C4925E467B}'
  Pictures    = 'My Pictures'
  Videos      = 'My Video'
  Music       = 'My Music'
  Screenshots = '{B7BEDE81-DF94-4682-A7D8-57A52620B86F}'
}
$out.known_folders = [ordered]@{}
foreach ($name in $known.Keys) {
  $value = $shell.($known[$name])
  $out.known_folders[$name] = if ($value) { [Environment]::ExpandEnvironmentVariables($value) } else { $null }
}
if (-not $out.known_folders.Screenshots -and $out.known_folders.Pictures) {
  $out.known_folders.Screenshots = Join-Path $out.known_folders.Pictures 'Screenshots'
}

$out.browsers = @()
$browsers = @{ chrome = "$env:LOCALAPPDATA\Google\Chrome\User Data"; edge = "$env:LOCALAPPDATA\Microsoft\Edge\User Data" }
foreach ($browser in $browsers.Keys) {
  $base = $browsers[$browser]
  if (-not (Test-Path $base)) { continue }
  Get-ChildItem $base -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'Preferences') } | ForEach-Object {
    $prefs = Get-Content -Raw -Encoding UTF8 (Join-Path $_.FullName 'Preferences') | ConvertFrom-Json
    $out.browsers += [ordered]@{
      browser  = $browser
      profile  = $_.Name
      download = $prefs.download.default_directory  # null means the Downloads Known Folder
      ask      = $prefs.download.prompt_for_download
    }
  }
}

$steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam').SteamPath
if ($steam) { $steam = $steam -replace '/', '\' }
$out.steam = [ordered]@{ install = $steam; libraries = @() }
if ($steam) {
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    $out.steam.libraries = @(Select-String -Path $vdf -Pattern '"path"\s+"(.+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\\\', '\' })
  }
}

$out.chat = [ordered]@{
  wechat_legacy = (Get-ItemProperty 'HKCU:\Software\Tencent\WeChat').FileSavePath
  wecom         = (Get-ItemProperty 'HKCU:\Software\Tencent\WXWork\Properties').DataLocationPath
}
$wx4 = "$env:APPDATA\Tencent\xwechat\config"
$out.chat.wechat4_config_dir = if (Test-Path $wx4) { $wx4 } else { $null }

$dvr = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR'
$out.xbox_captures = if ($dvr.AppCaptureEnabled -ne $null) { [ordered]@{ enabled = [bool]$dvr.AppCaptureEnabled; folder = (Join-Path $out.known_folders.Videos 'Captures') } } else { $null }

function Get-ProbeValue($node, [string] $path) {
  foreach ($part in $path.Split('.')) {
    if ($null -eq $node) { return $null }
    if ($node -is [System.Collections.IDictionary]) { $node = $node[$part] } else { $node = $node.$part }
  }
  return $node
}
function Get-Normal([string] $value) {
  if (-not $value) { return '' }
  return [Environment]::ExpandEnvironmentVariables($value).Replace('/', '\').TrimEnd('\')
}
if ($Config) {
  $ErrorActionPreference = 'Stop'
  $cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $Config | ConvertFrom-Json
  $out.drift = @()
  foreach ($entry in @($cfg.app_settings)) {
    if (-not $entry -or -not $entry.probe) { continue }
    $actual = Get-ProbeValue $out $entry.probe
    $status = if ($null -eq $actual) { 'unknown' }
              elseif ((Get-Normal $actual) -ieq (Get-Normal $entry.expected)) { 'ok' }
              else { 'drift' }
    $out.drift += [ordered]@{ app = $entry.app; probe = $entry.probe; expected = $entry.expected; actual = $actual; status = $status }
  }
}

$out | ConvertTo-Json -Depth 5
