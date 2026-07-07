<#
.SYNOPSIS
  Stage qpdf into src-tauri/resources/qpdf for CI / release builds (non-interactive).
#>
$ErrorActionPreference = 'Stop'

$QpdfVersion = if ($env:QPDF_VERSION) { $env:QPDF_VERSION } else { '12.3.2' }
$dest = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src-tauri\resources\qpdf'))
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$zipName = "qpdf-$QpdfVersion-msvc64.zip"
$url = "https://github.com/qpdf/qpdf/releases/download/v$QpdfVersion/$zipName"
$tmpZip = Join-Path $env:RUNNER_TEMP 'qpdf.zip'
$extract = Join-Path $env:RUNNER_TEMP 'qpdf-extract'

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $tmpZip
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $tmpZip -DestinationPath $extract -Force

$exe = Get-ChildItem -Path $extract -Recurse -Filter 'qpdf.exe' | Select-Object -First 1
if (-not $exe) { throw "qpdf.exe not found in $zipName" }

Copy-Item -Path $exe.FullName -Destination (Join-Path $dest 'qpdf.exe') -Force
Get-ChildItem -Path $exe.DirectoryName -Filter '*.dll' | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $dest -Force
}

Write-Host "Staged qpdf in: $dest"
