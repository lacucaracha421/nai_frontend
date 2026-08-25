$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$outDir = Join-Path $repoRoot ".agent-output"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logPath = Join-Path $outDir "run.log"

try {
    Start-Transcript -Path $logPath -Force | Out-Null
} catch {
    Write-Warning "Could not start transcript: $($_.Exception.Message)"
}

function Invoke-AgentStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host "::group::$Name"
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Write-Host "::endgroup::"
    }
}

try {
    Write-Host "Repository: $repoRoot"
    Write-Host "Branch: $env:GITHUB_REF_NAME"
    Write-Host "Commit: $env:GITHUB_SHA"

    Invoke-AgentStep "Git status" {
        git status --short
    }

    Invoke-AgentStep "Tool versions" {
        node --version
        npm --version
        cargo --version
        rustc --version
    }

    Invoke-AgentStep "Install Node dependencies" {
        if (Test-Path "package-lock.json") {
            npm ci
        }
        else {
            npm install
        }
    }

    Invoke-AgentStep "Frontend build" {
        npm run build
    }

    Invoke-AgentStep "Rust tests" {
        cargo test --manifest-path "src-tauri/Cargo.toml"
    }

    Write-Host "CHAT_AGENT_RESULT=success"
}
catch {
    Write-Error $_
    Write-Host "CHAT_AGENT_RESULT=failure"
    exit 1
}
finally {
    try {
        Stop-Transcript | Out-Null
    } catch {}
}
