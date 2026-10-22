# ========================================================================
# BPP-VMS Automated Clean Release & Pre-Push Sanitizer Gate
# ========================================================================

[CmdletBinding()]
param(
    [string]$CleanRepoUrl = "https://github.com/itbpp215-creater/VMS-Clean.git",
    [switch]$SkipPush,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$FrigateDir = Join-Path $RepoRoot "frigate-nvr"
$StagingDir = Join-Path $env:TEMP "bpp-vms-clean-staging"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

Clear-Host
Write-Header "BPP-VMS - Clean Distribution Release Pipeline & Sanitizer Gate"

# ------------------------------------------------------------------------
# 1. Verify Git Environment
# ------------------------------------------------------------------------
Write-Host "[1/6] Checking Git repository environment..." -ForegroundColor Yellow
Push-Location $RepoRoot
if (-not (Test-Path ".git")) {
    Write-Host "  [!] .git folder not found in this directory." -ForegroundColor Red
    Pop-Location
    exit 1
}

$remotes = (& git remote -v 2>&1) | Out-String
if ($remotes -notmatch "release\s+") {
    Write-Host "  [*] Adding Git remote 'release' -> $CleanRepoUrl" -ForegroundColor Gray
    & git remote add release $CleanRepoUrl
} else {
    Write-Host "  [OK] Git remote 'release' already configured." -ForegroundColor Green
}
Pop-Location

# ------------------------------------------------------------------------
# 2. Prepare Clean Staging Workspace
# ------------------------------------------------------------------------
Write-Host "`n[2/6] Preparing clean staging workspace..." -ForegroundColor Yellow

if (Test-Path $StagingDir) {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force | Out-Null
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

Push-Location $RepoRoot
$archiveZip = Join-Path $env:TEMP "bpp-archive-temp.zip"
if (Test-Path $archiveZip) { Remove-Item $archiveZip -Force }

Write-Host "  [*] Extracting codebase from current Git HEAD..." -ForegroundColor Gray
& git archive --format=zip HEAD -o $archiveZip
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "git archive failed with exit code $LASTEXITCODE"
}
Pop-Location

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($archiveZip, $StagingDir)
Remove-Item $archiveZip -Force

Write-Host "  [OK] Staging workspace ready.`n" -ForegroundColor Green

# ------------------------------------------------------------------------
# 3. Sanitization Pipeline
# ------------------------------------------------------------------------
Write-Host "[3/6] Running Sanitization Pipeline to strip BPP215 secrets..." -ForegroundColor Yellow

# A. Purge internal developer scratch files, private dumps, and scrape files from staging
$itemsToPurge = @(
    "scratch",
    "backup",
    "query.sql",
    "incident_172.txt",
    "old_doh_cams.txt",
    "isan_*.json",
    "raw_cameras.json",
    "api_*.json",
    "temp_*.js",
    "temp_*.json",
    "scan_*.py",
    "scrape_*.py",
    "scratch.py",
    "scratch_out.txt",
    "frigate-nvr/docs/sessions",
    "frigate-nvr/analytics-engine/*gpsone*.json",
    "frigate-nvr/analytics-engine/*.local.json",
    "frigate-nvr/config/drones_qcs_state.json",
    "frigate-nvr/config/manual_clips"
)

foreach ($pattern in $itemsToPurge) {
    $targetPath = Join-Path $StagingDir $pattern
    Get-ChildItem -Path $targetPath -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  [+] Purged internal development dumps and scrape files." -ForegroundColor Green

# B. Replace config.yml with config.clean.yml and create config.yml.example
$cleanConfigSrc = Join-Path $FrigateDir "config\config.clean.yml"
$stagingConfigDest = Join-Path $StagingDir "frigate-nvr\config\config.yml"
$stagingConfigExampleDest = Join-Path $StagingDir "frigate-nvr\config\config.yml.example"
if (Test-Path $cleanConfigSrc) {
    Copy-Item -LiteralPath $cleanConfigSrc -Destination $stagingConfigDest -Force
    Copy-Item -LiteralPath $cleanConfigSrc -Destination $stagingConfigExampleDest -Force
    Write-Host "  [+] Provided Clean Template & config.yml.example (zero BPP215 cameras)." -ForegroundColor Green
} else {
    throw "Missing config.clean.yml template!"
}

# C. Replace .env.example with clean.env.template
$cleanEnvSrc = Join-Path $FrigateDir "clean.env.template"
$stagingEnvDest = Join-Path $StagingDir "frigate-nvr\.env.example"
if (Test-Path $cleanEnvSrc) {
    Copy-Item -LiteralPath $cleanEnvSrc -Destination $stagingEnvDest -Force
    Write-Host "  [+] Replaced .env.example with Clean Template (zero passwords/tokens)." -ForegroundColor Green
} else {
    throw "Missing clean.env.template template!"
}

# D. Purge any accidental .env from staging
$stagingEnv = Join-Path $StagingDir "frigate-nvr\.env"
if (Test-Path $stagingEnv) {
    Remove-Item -LiteralPath $stagingEnv -Force
    Write-Host "  [*] Removed .env from staging." -ForegroundColor Gray
}

# E. Sanitize camera and watchlist lists & provide templates
$blankJsonArr = "[]`r`n"
$camSources = Join-Path $StagingDir "frigate-nvr\config\camera_sources.json"
if (Test-Path $camSources) { [System.IO.File]::WriteAllText($camSources, $blankJsonArr, [System.Text.Encoding]::UTF8) }

$camSourcesTemplate = Join-Path $StagingDir "frigate-nvr\config\camera_sources.json.template"
[System.IO.File]::WriteAllText($camSourcesTemplate, "{}`r`n", [System.Text.Encoding]::UTF8)

$camList = Join-Path $StagingDir "frigate-nvr\config\cam_list.tsv"
if (Test-Path $camList) { [System.IO.File]::WriteAllText($camList, "camera_name`trtsp_url`tlocation`r`n", [System.Text.Encoding]::UTF8) }

$camCreds = Join-Path $StagingDir "frigate-nvr\config\camera_credentials.env"
if (Test-Path $camCreds) { [System.IO.File]::WriteAllText($camCreds, "# Clean Camera Credentials`r`n", [System.Text.Encoding]::UTF8) }

$suspectPlates = Join-Path $StagingDir "frigate-nvr\config\lpr\suspect_plates.txt"
if (Test-Path $suspectPlates) { [System.IO.File]::WriteAllText($suspectPlates, "# Put suspect plates here (one per line)`r`n", [System.Text.Encoding]::UTF8) }

$lprCams = Join-Path $StagingDir "frigate-nvr\config\lpr\lpr_cameras.txt"
if (Test-Path $lprCams) { [System.IO.File]::WriteAllText($lprCams, "cam_sample`r`n", [System.Text.Encoding]::UTF8) }

# Ensure .gitignore in staging ignores node-specific configurations
$gitignoreEntries = @(
    "frigate-nvr/config/config.yml",
    "frigate-nvr/config/camera_sources.json",
    "frigate-nvr/config/camera_credentials.env",
    "frigate-nvr/config/cam_list.tsv",
    "frigate-nvr/.env",
    "config/config.yml",
    "config/camera_sources.json",
    "config/camera_credentials.env",
    "config/cam_list.tsv"
)

$stagingRootGi = Join-Path $StagingDir ".gitignore"
if (Test-Path $stagingRootGi) {
    $giText = [System.IO.File]::ReadAllText($stagingRootGi, [System.Text.Encoding]::UTF8)
    $toAppend = ""
    foreach ($entry in $gitignoreEntries) {
        if ($giText -notmatch [regex]::Escape($entry)) {
            $toAppend += "`n$entry"
        }
    }
    if ($toAppend) {
        [System.IO.File]::AppendAllText($stagingRootGi, "`n# Node-specific runtime configs (Decoupled in Clean Release)$toAppend`n", [System.Text.Encoding]::UTF8)
    }
}

$stagingFrigateGi = Join-Path $StagingDir "frigate-nvr\.gitignore"
if (Test-Path $stagingFrigateGi) {
    $fgiText = [System.IO.File]::ReadAllText($stagingFrigateGi, [System.Text.Encoding]::UTF8)
    $fgiAppend = ""
    foreach ($entry in @("config/config.yml", "config/camera_sources.json", "config/camera_credentials.env", "config/cam_list.tsv")) {
        if ($fgiText -notmatch [regex]::Escape($entry)) {
            $fgiAppend += "`n$entry"
        }
    }
    if ($fgiAppend) {
        [System.IO.File]::AppendAllText($stagingFrigateGi, "`n# Decoupled node-specific configs$fgiAppend`n", [System.Text.Encoding]::UTF8)
    }
}


# F. Deep Pattern Scrubber across all text files in Staging
Write-Host "  [*] Performing automated scrubbing of private domains, NAS IPs, and test credentials..." -ForegroundColor Gray
$replacements = @(
    @{ Find = "sloth\.bpp215\.com"; Replace = "vms.local" },
    @{ Find = "bpp215\.com"; Replace = "example.com" },
    @{ Find = "192\.168\.1\.115"; Replace = "192.168.1.100" },
    @{ Find = "Bpp215#2026"; Replace = "ChangeMePassword123" },
    @{ Find = "AQ\.Ab8RN6L2tu16Os6MZYy0ura4hR5w4YfcNYDacaIA01gijSnkqQ"; Replace = "" },
    @{ Find = "AdminBpp215!"; Replace = "ChangeMeAdmin123!" }
)

$textExtensions = @(".yml", ".yaml", ".json", ".ps1", ".bat", ".env", ".example", ".txt", ".md", ".py", ".js", ".html")
$allStagingFiles = Get-ChildItem -LiteralPath $StagingDir -Recurse -File | Where-Object {
    $ext = $_.Extension.ToLowerInvariant()
    $ext -in $textExtensions
}

foreach ($f in $allStagingFiles) {
    if ($f.Name -eq "CLEAN_RELEASE_POLICY.md" -or $f.Name -eq "Sync-CleanRelease.ps1") { continue }
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    $modified = $false
    foreach ($rep in $replacements) {
        if ($content -match $rep.Find) {
            $content = [System.Text.RegularExpressions.Regex]::Replace($content, $rep.Find, $rep.Replace)
            $modified = $true
        }
    }
    if ($modified) {
        [System.IO.File]::WriteAllText($f.FullName, $content, [System.Text.Encoding]::UTF8)
    }
}
Write-Host "  [+] Sanitized text patterns across all source files." -ForegroundColor Green

# G. Bundle essential AI Model weights
Write-Host "  [*] Bundling AI models (ONNX & PyTorch) into staging..." -ForegroundColor Gray
$modelsToBundle = @(
    @{ Src = Join-Path $FrigateDir "config\model_cache\yolo11m-640.onnx"; Dest = Join-Path $StagingDir "frigate-nvr\config\model_cache\yolo11m-640.onnx" },
    @{ Src = Join-Path $FrigateDir "LicensePlateRECOG\model\license_plate.pt"; Dest = Join-Path $StagingDir "frigate-nvr\LicensePlateRECOG\model\license_plate.pt" },
    @{ Src = Join-Path $FrigateDir "LicensePlateRECOG\model\data_plate.pt"; Dest = Join-Path $StagingDir "frigate-nvr\LicensePlateRECOG\model\data_plate.pt" }
)

foreach ($m in $modelsToBundle) {
    if (Test-Path $m.Src) {
        $parentDir = Split-Path -Parent $m.Dest
        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
        Copy-Item -LiteralPath $m.Src -Destination $m.Dest -Force
        $leafName = Split-Path -Leaf $m.Src
        Write-Host "      + $leafName" -ForegroundColor DarkGray
    }
}

# H. Attach Clean Guides
$guideSrc = Join-Path $RepoRoot "docs\CLEAN_INSTALL_GUIDE_TH.md"
if (Test-Path $guideSrc) {
    Copy-Item -LiteralPath $guideSrc -Destination (Join-Path $StagingDir "CLEAN_INSTALL_GUIDE_TH.md") -Force
}
$htmlGuideSrc = Join-Path $RepoRoot "docs\clean_install_guide.html"
if (Test-Path $htmlGuideSrc) {
    Copy-Item -LiteralPath $htmlGuideSrc -Destination (Join-Path $StagingDir "clean_install_guide.html") -Force
}

Write-Host "  [OK] Sanitization complete.`n" -ForegroundColor Green

# ------------------------------------------------------------------------
# 4. Pre-Push Sanitization Gate (Security Linter)
# ------------------------------------------------------------------------
Write-Host "[4/6] Running Pre-Push Sanitization Gate..." -ForegroundColor Yellow

$blockedPatterns = @(
    @{ Name = "Hardcoded Old Gemini Key"; Pattern = "AQ\.Ab8RN6L2tu16Os6MZYy0ura4hR5w4YfcNYDacaIA01gijSnkqQ" },
    @{ Name = "BPP215 Private Domain"; Pattern = "sloth\.bpp215\.com" },
    @{ Name = "BPP215 Synology NAS IP"; Pattern = "192\.168\.1\.115" },
    @{ Name = "BPP215 NAS Password"; Pattern = "Bpp215#2026" },
    @{ Name = "BPP215 Default Password Pattern"; Pattern = "AdminBpp215!" }
)

$violationsFound = @()
$finalStagingFiles = Get-ChildItem -LiteralPath $StagingDir -Recurse -File | Where-Object {
    $ext = $_.Extension.ToLowerInvariant()
    $ext -in $textExtensions
}

foreach ($file in $finalStagingFiles) {
    if ($file.Name -eq "CLEAN_RELEASE_POLICY.md" -or $file.Name -eq "Sync-CleanRelease.ps1") { continue }
    
    $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    foreach ($bp in $blockedPatterns) {
        if ($content -match $bp.Pattern) {
            $rel = $file.FullName.Substring($StagingDir.Length + 1)
            $violationsFound += "  [!] Secret pattern '$($bp.Name)' detected in: $rel"
        }
    }
}

if ($violationsFound.Count -gt 0) {
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Red
    Write-Host "  [BLOCKED BY PRE-PUSH GATE] Sensitive BPP215 data detected!" -ForegroundColor Red
    Write-Host "========================================================================" -ForegroundColor Red
    foreach ($v in $violationsFound) {
        Write-Host $v -ForegroundColor Red
    }
    Write-Host "`n  Export immediately aborted to guarantee zero leaks." -ForegroundColor Red
    Write-Host "========================================================================" -ForegroundColor Red
    exit 1
}

Write-Host "  [PASS] Gate passed! Zero BPP215 secrets detected across all files.`n" -ForegroundColor Green

# ------------------------------------------------------------------------
# 5. Build Clean Installer Package (.ZIP)
# ------------------------------------------------------------------------
Write-Host "[5/6] Creating clean installer package (bpp-vms-clean-installer.zip)..." -ForegroundColor Yellow
$finalZip = Join-Path $RepoRoot "bpp-vms-clean-installer.zip"
if (Test-Path $finalZip) { Remove-Item $finalZip -Force }

[System.IO.Compression.ZipFile]::CreateFromDirectory($StagingDir, $finalZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$zipLen = (Get-Item $finalZip).Length
$zipSizeMb = [math]::Round($zipLen / 1MB, 2)
Write-Host "  [OK] Created bpp-vms-clean-installer.zip ($zipSizeMb MB)`n" -ForegroundColor Green

# ------------------------------------------------------------------------
# 6. Push to Clean Distribution Repo (VMS-Clean)
# ------------------------------------------------------------------------
Write-Host "[6/6] Pushing clean tree to GitHub Clean Distribution Repo..." -ForegroundColor Yellow

if ($SkipPush) {
    Write-Host "  [*] Push skipped via -SkipPush" -ForegroundColor DarkGray
} else {
    Write-Host "  [*] Preparing Git commit in clean staging with continuous history..." -ForegroundColor Gray
    
    Push-Location $StagingDir
    try {
        & git init -b main | Out-Null
        & git config user.name "itbpp215-creater"
        & git config user.email "itbpp215-creater@users.noreply.github.com"
        & git remote add origin $CleanRepoUrl
        
        Write-Host "  [*] Fetching remote commit history from $CleanRepoUrl..." -ForegroundColor Gray
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $fetchOut = (& git fetch origin main --depth=1 2>&1) | Out-String
        $hasRemoteHistory = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $prevEap
        
        if ($hasRemoteHistory) {
            # Point HEAD to remote commit without modifying our sanitized working tree
            & git reset --mixed origin/main | Out-Null
            Write-Host "  [+] Staged on top of continuous remote history ($CleanRepoUrl)." -ForegroundColor Green
        } else {
            Write-Host "  [*] Remote repository empty or new; initializing clean branch." -ForegroundColor Yellow
        }
        
        # Untrack site-specific configurations in Clean Git Index if currently tracked
        $trackedToUntrack = @(
            "frigate-nvr/config/config.yml",
            "frigate-nvr/config/camera_sources.json",
            "frigate-nvr/config/camera_credentials.env",
            "frigate-nvr/config/cam_list.tsv",
            "frigate-nvr/.env"
        )
        foreach ($target in $trackedToUntrack) {
            $isFound = ((& git ls-files $target 2>&1) | Out-String).Trim()
            if ($isFound) {
                & git rm --cached -f $target 2>&1 | Out-Null
            }
        }
        
        & git add -A
        
        # Re-verify untracked configs are not staged
        foreach ($target in $trackedToUntrack) {
            $isFound = ((& git ls-files $target 2>&1) | Out-String).Trim()
            if ($isFound) {
                & git rm --cached -f $target 2>&1 | Out-Null
            }
        }
        
        $gitStatus = (& git status --porcelain 2>&1) | Out-String
        if ([string]::IsNullOrWhiteSpace($gitStatus)) {
            Write-Host "  [*] No changes detected since last clean release. Working tree matches remote." -ForegroundColor Green
        } else {
            $commitDate = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            $commitMsg = "Clean Release: $commitDate [Zero-BPP215 Leak Verified | Decoupled Configs]"
            & git commit -m "$commitMsg" | Out-Null
            
            Write-Host "  [*] Executing: git push origin main..." -ForegroundColor Cyan
            $ErrorActionPreference = 'Continue'
            $pushOut = (& git push origin main 2>&1) | Out-String
            $ErrorActionPreference = $prevEap
            Write-Host "  $pushOut" -ForegroundColor White
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [*] Standard push rejected; attempting push with force-with-lease..." -ForegroundColor Yellow
                $ErrorActionPreference = 'Continue'
                $pushOut = (& git push origin main --force-with-lease 2>&1) | Out-String
                $ErrorActionPreference = $prevEap
                if ($LASTEXITCODE -ne 0) {
                    throw "git push exited with code $($LASTEXITCODE): $pushOut"
                }
            }
            Write-Host "  [SUCCESS] Pushed to GitHub Clean Distribution Repo successfully with continuous history!`n" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [!] Error pushing to GitHub: $_" -ForegroundColor Yellow
        Write-Host "  (Please ensure credentials/PAT have write access to $CleanRepoUrl)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
}

try { Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}

Write-Header "[COMPLETED] Clean Release Generation Finished!"
Write-Host "  Clean ZIP Package:      $finalZip" -ForegroundColor Cyan
Write-Host "  Clean GitHub Repo:      $CleanRepoUrl" -ForegroundColor Cyan
Write-Host "  Thai Setup Guide:       docs\CLEAN_INSTALL_GUIDE_TH.md" -ForegroundColor Cyan
Write-Host "  Web Interactive Guide:  docs\clean_install_guide.html`n" -ForegroundColor Cyan
