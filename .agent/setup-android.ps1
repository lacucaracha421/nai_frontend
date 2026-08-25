$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Find-FirstExistingPath {
    param([string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }
    return $null
}

$javaHome = Find-FirstExistingPath @(
    $env:JAVA_HOME,
    "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot",
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Java\jdk-17"
)
if (-not $javaHome -or -not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
    throw "JDK 17 was not found."
}

$sdkHome = Find-FirstExistingPath @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    "C:\Android\sdk",
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
)
if (-not $sdkHome) {
    $sdkHome = "C:\Android\sdk"
    New-Item -ItemType Directory -Force -Path $sdkHome | Out-Null
}

$ndkVersion = "30.0.15729638"
$ndkHome = Join-Path $sdkHome "ndk\$ndkVersion"

function Find-SdkManager {
    param([string]$SdkHome)
    $candidates = @(
        (Join-Path $SdkHome "cmdline-tools\latest\bin\sdkmanager.bat"),
        (Join-Path $SdkHome "cmdline-tools\bin\sdkmanager.bat"),
        (Join-Path $SdkHome "tools\bin\sdkmanager.bat")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    $found = Get-ChildItem -Path $SdkHome -Filter "sdkmanager.bat" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

$sdkManager = Find-SdkManager $sdkHome
if (-not $sdkManager) {
    $zipCandidates = @(
        "C:\Android\cmdline-tools.zip",
        (Join-Path (Split-Path $sdkHome -Parent) "cmdline-tools.zip")
    )
    $zipPath = Find-FirstExistingPath $zipCandidates
    if (-not $zipPath) {
        throw "Android sdkmanager was not found and cmdline-tools.zip is unavailable."
    }

    Write-Host "[android-setup] Installing command-line tools from $zipPath"
    $extractRoot = Join-Path $env:TEMP "chat-agent-android-cmdline-tools"
    Remove-Item -Recurse -Force $extractRoot -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

    $extractedManager = Get-ChildItem -Path $extractRoot -Filter "sdkmanager.bat" -File -Recurse | Select-Object -First 1
    if (-not $extractedManager) {
        throw "sdkmanager.bat was not found inside $zipPath"
    }

    $sourceRoot = Split-Path (Split-Path $extractedManager.FullName -Parent) -Parent
    $latestRoot = Join-Path $sdkHome "cmdline-tools\latest"
    Remove-Item -Recurse -Force $latestRoot -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $latestRoot | Out-Null
    Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $latestRoot -Recurse -Force

    $sdkManager = Join-Path $latestRoot "bin\sdkmanager.bat"
    if (-not (Test-Path $sdkManager)) {
        throw "Failed to install Android command-line tools."
    }
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkHome
$env:ANDROID_SDK_ROOT = $sdkHome
$env:PATH = "$javaHome\bin;$sdkHome\platform-tools;$env:PATH"

if (-not (Test-Path $ndkHome)) {
    Write-Host "[android-setup] Accepting Android SDK licenses"
    (1..40 | ForEach-Object { "y" }) | & $sdkManager "--sdk_root=$sdkHome" --licenses
    if ($LASTEXITCODE -ne 0) {
        throw "sdkmanager --licenses failed with exit code $LASTEXITCODE"
    }

    Write-Host "[android-setup] Installing Android SDK packages and NDK $ndkVersion"
    & $sdkManager "--sdk_root=$sdkHome" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;$ndkVersion"
    if ($LASTEXITCODE -ne 0) {
        throw "Android SDK package installation failed with exit code $LASTEXITCODE"
    }
}
else {
    Write-Host "[android-setup] NDK $ndkVersion already installed"
}

if (-not (Test-Path $ndkHome)) {
    throw "NDK installation did not produce $ndkHome"
}

Write-Host "[android-setup] Ensuring Rust Android targets"
& rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
if ($LASTEXITCODE -ne 0) {
    throw "rustup target add failed with exit code $LASTEXITCODE"
}

$env:NDK_HOME = $ndkHome
$env:ANDROID_NDK_HOME = $ndkHome

Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_HOME=$sdkHome"
Write-Host "NDK_HOME=$ndkHome"
& (Join-Path $javaHome "bin\java.exe") -version

if ($env:GITHUB_ENV) {
    Add-Content -Path $env:GITHUB_ENV -Value "JAVA_HOME=$javaHome"
    Add-Content -Path $env:GITHUB_ENV -Value "ANDROID_HOME=$sdkHome"
    Add-Content -Path $env:GITHUB_ENV -Value "ANDROID_SDK_ROOT=$sdkHome"
    Add-Content -Path $env:GITHUB_ENV -Value "NDK_HOME=$ndkHome"
    Add-Content -Path $env:GITHUB_ENV -Value "ANDROID_NDK_HOME=$ndkHome"
}
if ($env:GITHUB_PATH) {
    Add-Content -Path $env:GITHUB_PATH -Value (Join-Path $javaHome "bin")
    Add-Content -Path $env:GITHUB_PATH -Value (Join-Path $sdkHome "platform-tools")
}
