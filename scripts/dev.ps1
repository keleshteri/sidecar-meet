param([ValidateSet('desktop', 'api', 'test', 'build', 'check')][string]$Task = 'desktop')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
# Visual Studio installs CMake without necessarily putting it on PATH.
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $install = & $vswhere -latest -prerelease -products '*' -property installationPath
        if ($install) {
            $cmakeDir = Join-Path $install 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin'
            if (Test-Path -LiteralPath (Join-Path $cmakeDir 'cmake.exe')) { $env:PATH = "$cmakeDir;$env:PATH" }
        }
    }
}
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { throw 'Install CMake or the Visual Studio C++ CMake tools component before building Whisper.' }
if (-not $env:LIBCLANG_PATH -and (Test-Path -LiteralPath '.tools/libclang/libclang-18.1.1.data/platlib/clang/native/libclang.dll')) {
    $env:LIBCLANG_PATH = (Resolve-Path '.tools/libclang/libclang-18.1.1.data/platlib/clang/native').Path
}
switch ($Task) {
    desktop { cargo run -p sidecar-desktop }
    api { cargo run -p sidecar-api }
    test { cargo test --workspace }
    build { cargo build --workspace }
    check { cargo clippy --workspace --all-targets -- -D warnings }
}
exit $LASTEXITCODE
