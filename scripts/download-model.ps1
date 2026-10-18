$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$models = Join-Path $root 'models'
New-Item -ItemType Directory -Force -Path $models | Out-Null
$model = Join-Path $models 'ggml-tiny.en.bin'
if (Test-Path -LiteralPath $model) { Write-Host "Model already exists: $model"; exit 0 }
$partial = "$model.partial"
& curl.exe -fL --max-time 300 -o $partial 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.en.bin'
if ($LASTEXITCODE -ne 0) { throw 'Model download failed; rerun this script to retry.' }
if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f') { throw 'Model checksum mismatch' }
Move-Item -LiteralPath $partial -Destination $model
Write-Host "Model ready: $model"
