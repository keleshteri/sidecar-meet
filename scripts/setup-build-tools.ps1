$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $root '.tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
# libclang's Windows wheel contains the native DLL; no Python runtime is needed.
$archive = Join-Path $tools 'libclang.zip'
& curl.exe -fL --max-time 120 -o $archive 'https://files.pythonhosted.org/packages/0b/2d/3f480b1e1d31eb3d6de5e3ef641954e5c67430d5ac93b7fa7e07589576c7/libclang-18.1.1-py2.py3-none-win_amd64.whl'
if ($LASTEXITCODE -ne 0) { throw 'libclang download failed' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne '4dd2d3b82fab35e2bf9ca717d7b63ac990a3519c7e312f19fa8e86dcc712f7fb') { throw 'libclang checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $tools 'libclang') -Force
Write-Host 'Local libclang installed. scripts/dev.ps1 will discover it.'
