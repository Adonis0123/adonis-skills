<#
.SYNOPSIS
  Find Desktop and Start menu shortcuts that point into a folder, and optionally retarget them.
.EXAMPLE
  shortcuts.ps1 -From 'D:\games'                      # list only
  shortcuts.ps1 -From 'D:\games' -To 'G:\games\standalone' -Apply
  shortcuts.ps1 -From 'D:\games' -Roots 'C:\temp\links'   # search other folders instead
  shortcuts.ps1 -FromBase64 <utf8-base64> -ToBase64 <utf8-base64> -Apply   # non-ASCII paths from WSL
.DESCRIPTION
  Matching is case-insensitive on the path prefix. Without -Apply nothing changes.
  With -Apply only shortcuts whose new target exists are rewritten; the rest are listed as missing.
  -FromBase64/-ToBase64 take the path as UTF-8 base64 so non-ASCII paths survive any caller codepage,
  e.g. from WSL: -FromBase64 "$(printf '%s' 'G:\games\QQ...' | base64 -w0)".
  Paths are compared after Unicode NFC normalization; rewritten fields keep their original form
  after the prefix. A shortcut whose original prefix does not normalize to the same length is
  left alone and listed with status nfc-mismatch.
#>
param(
  [string] $From,
  [string] $To,
  [string] $FromBase64,
  [string] $ToBase64,
  [switch] $Apply,
  [string[]] $Roots
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function ConvertFrom-Utf8Base64([string] $Value) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value)) }
function Get-Nfc([string] $Value) { if ($Value) { $Value.Normalize([Text.NormalizationForm]::FormC) } else { $Value } }
if ($FromBase64) { $From = ConvertFrom-Utf8Base64 $FromBase64 }
if ($ToBase64) { $To = ConvertFrom-Utf8Base64 $ToBase64 }
if (-not $From) { throw 'Pass -From or -FromBase64.' }
if ($From.Contains('?') -or ($To -and $To.Contains('?'))) { throw "Path contains '?', a sign the caller's codepage dropped characters; pass -FromBase64/-ToBase64 instead." }
if ($Roots | Where-Object { $_ -and $_.Contains('?') }) { throw "-Roots contains '?', a sign the caller's codepage dropped characters; pass ASCII paths or run from PowerShell." }
$From = Get-Nfc $From
$To = Get-Nfc $To
$fromPrefix = $From.TrimEnd('\') + '\'
$fromBase = $From.TrimEnd('\')
# The part of $Value after the -From prefix, taken from the original string; $null when the
# original prefix is not the same length as its NFC form (then a cut would land mid-character).
function Get-Tail([string] $Value) {
  $n = $fromBase.Length
  if (-not $Value -or $Value.Length -lt $n) { return $null }
  if (-not [string]::Equals((Get-Nfc $Value.Substring(0, $n)), $fromBase, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  $tail = $Value.Substring($n)
  if ($tail -and -not $tail.StartsWith('\')) { return $null }
  return $tail
}
if ($Roots) { $searchRoots = @($Roots | Where-Object { Test-Path -LiteralPath $_ }) } else { $searchRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu')
) | Where-Object { $_ -and (Test-Path $_) } }
$wsh = New-Object -ComObject WScript.Shell
$result = @()
foreach ($root in $searchRoots) {
  Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    $lnk = $wsh.CreateShortcut($_.FullName)
    $fields = @('TargetPath', 'WorkingDirectory', 'IconLocation')
    $hit = $fields | Where-Object { ((Get-Nfc $lnk.$_) + '\').StartsWith($fromPrefix, [StringComparison]::OrdinalIgnoreCase) }
    if (-not $hit) { return }
    $row = [ordered]@{ shortcut = $_.FullName; target = $lnk.TargetPath; status = 'listed' }
    $toBase = if ($To) { $To.TrimEnd('\') } else { $null }
    $targetHit = ((Get-Nfc $lnk.TargetPath) + '\').StartsWith($fromPrefix, [StringComparison]::OrdinalIgnoreCase)
    if ($toBase -and -not $targetHit) { $row.status = 'target-outside-from' }  # only working dir or icon match; left alone
    elseif ($toBase) {
      $updates = [ordered]@{}
      $mismatch = $false
      foreach ($field in $hit) {
        $tail = Get-Tail $lnk.$field
        if ($null -eq $tail) { $mismatch = $true } else { $updates[$field] = $toBase + $tail }
      }
      if ($mismatch) { $row.status = 'nfc-mismatch' }
      else {
        $newTarget = $updates['TargetPath']
        $row.new_target = $newTarget
        if (-not (Test-Path -LiteralPath $newTarget)) { $row.status = 'missing-new-target' }
        elseif ($Apply) {
          foreach ($field in $updates.Keys) { $lnk.$field = $updates[$field] }
          $lnk.Save()
          $row.status = 'retargeted'
        }
      }
    }
    $result += [pscustomobject]$row
  }
}
ConvertTo-Json -InputObject @($result) -Depth 3
