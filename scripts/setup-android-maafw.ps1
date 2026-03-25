# MaaFramework Android .so 库集成脚本
# 用途：将 MaaFramework 的 Android aarch64 .so 文件复制到 jniLibs 目录
#
# 使用前：
# 1. 从 https://github.com/MaaXYZ/MaaFramework/releases 下载 MAA-android-aarch64-*.tar.gz
# 2. 解压到任意目录
# 3. 运行此脚本: .\scripts\setup-android-maafw.ps1 -MaaFwDir <解压目录>

param(
    [Parameter(Mandatory=$true)]
    [string]$MaaFwDir
)

$jniLibsDir = Join-Path $PSScriptRoot "..\src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"

if (-not (Test-Path $jniLibsDir)) {
    New-Item -ItemType Directory -Path $jniLibsDir -Force | Out-Null
}

$soFiles = @(
    "libMaaFramework.so",
    "libMaaToolkit.so",
    "libonnxruntime.so",
    "libfastdeploy_ppocr.so",
    "libMaaAgentBinary.so"
)

$copied = 0
foreach ($soFile in $soFiles) {
    $sourcePath = Join-Path $MaaFwDir $soFile
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $jniLibsDir -Force
        Write-Host "  Copied: $soFile" -ForegroundColor Green
        $copied++
    } else {
        # try lib/ subdirectory
        $sourcePath = Join-Path $MaaFwDir "lib" $soFile
        if (Test-Path $sourcePath) {
            Copy-Item -Path $sourcePath -Destination $jniLibsDir -Force
            Write-Host "  Copied: $soFile (from lib/)" -ForegroundColor Green
            $copied++
        } else {
            Write-Host "  Not found: $soFile (optional)" -ForegroundColor Yellow
        }
    }
}

# Also copy MaaAgentBinary directory if it exists
$agentDir = Join-Path $MaaFwDir "MaaAgentBinary"
if (Test-Path $agentDir) {
    $destAgentDir = Join-Path $PSScriptRoot "..\src-tauri\gen\android\app\src\main\assets\MaaAgentBinary"
    if (-not (Test-Path $destAgentDir)) {
        New-Item -ItemType Directory -Path $destAgentDir -Force | Out-Null
    }
    Copy-Item -Path "$agentDir\*" -Destination $destAgentDir -Recurse -Force
    Write-Host "  Copied: MaaAgentBinary directory" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! $copied .so files copied to $jniLibsDir" -ForegroundColor Cyan
