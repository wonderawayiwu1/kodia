<#
.SYNOPSIS
    Builds the latest Kodia changes into C:\CodeEditors\VSCode-win32-x64 and
    produces an updated kodia-installer-x64.exe + kodia-update.json manifest
    so any running installed Kodia instance automatically shows "Restart to Update".

.PARAMETER SkipReact
    Skip `npm run buildreact` when no React UI files changed.

.PARAMETER PublishGitHub
    If `gh` CLI is installed and authenticated, creates a GitHub Release on
    wonderawayiwu1/kodia with kodia-installer-x64.exe attached so any laptop
    worldwide receives the in-app "Restart to Update" prompt.

.PARAMETER ReleaseTag
    Optional custom release tag (defaults to "<vscodeVersion>-<voidVersion>").
#>
param(
    [switch]$SkipReact,
    [switch]$PublishGitHub,
    [string]$ReleaseTag = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$PackagedDir = 'C:\CodeEditors\VSCode-win32-x64'
$PackagedAppDir = Join-Path $PackagedDir 'resources\app'
$PackagedOutDir = Join-Path $PackagedAppDir 'out'
$OutMinDir = Join-Path $RepoRoot 'out-vscode-min'
$InstallerDir = Join-Path $RepoRoot '.build\win32-x64\user-setup'
$InstallerPath = Join-Path $InstallerDir 'kodia-installer-x64.exe'
$ManifestPath = Join-Path $InstallerDir 'kodia-update.json'

Write-Host '==> [1/5] Preparing Kodia update build...' -ForegroundColor Cyan

if (-not $SkipReact) {
    Write-Host '==> [2/5] Building React UI bundles...' -ForegroundColor Cyan
    npm run buildreact
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host '==> [2/5] Skipping React UI build (-SkipReact)' -ForegroundColor Yellow
}

Write-Host '==> [3/5] Bundling minified Kodia main & workbench (out-vscode-min)...' -ForegroundColor Cyan
node --experimental-strip-types --max-old-space-size=8192 build/next/index.ts bundle --minify --nls --out out-vscode-min
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '==> [4/5] Syncing bundles and stamping build metadata into VSCode-win32-x64...' -ForegroundColor Cyan
$headCommit = (git rev-parse HEAD).Trim()
$isDirty = [bool]((git status --porcelain) -join '').Trim()
$buildNowUtc = [DateTimeOffset]::UtcNow
$buildIsoDate = $buildNowUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$buildTimestamp = $buildNowUtc.ToUnixTimeMilliseconds()

# When the working tree has uncommitted changes, derive a deterministic 40-char build revision
# from HEAD + compiled bundle contents so installed Kodia detects the update without needing a git commit,
# and stops prompting once that exact build is installed (matching product.json commit).
$gitCommit = $headCommit
if ($isDirty) {
    $revScript = @"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const h = crypto.createHash('sha1').update(process.argv[1]);
for (const rel of ['mainImpl.js', 'vs/workbench/workbench.desktop.main.js', 'vs/sessions/sessions.desktop.main.js', 'vs/platform/agentHost/node/agentHostMain.js']) {
    const fp = path.join(process.argv[2], rel);
    if (fs.existsSync(fp)) { h.update(rel).update(fs.readFileSync(fp)); }
}
process.stdout.write(h.digest('hex'));
"@
    $gitCommit = (node -e $revScript $headCommit $OutMinDir).Trim()
    Write-Host "    Uncommitted changes detected -> content-derived build revision: $($gitCommit.Substring(0, 10)) (HEAD $($headCommit.Substring(0, 7)))" -ForegroundColor Yellow
}

$syncScript = @"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const srcOut = process.argv[1];
const dstApp = process.argv[2];
const dstOut = path.join(dstApp, 'out');
const commit = process.argv[3];
const dateIso = process.argv[4];
const repoPkg = JSON.parse(fs.readFileSync(path.join(process.argv[5], 'package.json'), 'utf8'));
const repoProd = JSON.parse(fs.readFileSync(path.join(process.argv[5], 'product.json'), 'utf8'));

const toCopy = [
    'mainImpl.js',
    'mainImpl.js.map',
    'nls.messages.js',
    'nls.messages.json',
    'nls.keys.json',
    'nls.metadata.json',
    'vs/workbench/workbench.desktop.main.js',
    'vs/workbench/workbench.desktop.main.js.map',
    'vs/workbench/workbench.desktop.main.css',
    'vs/workbench/workbench.desktop.main.css.map',
    'vs/sessions/sessions.desktop.main.js',
    'vs/sessions/sessions.desktop.main.js.map',
    'vs/sessions/sessions.desktop.main.css',
    'vs/sessions/sessions.desktop.main.css.map',
    'vs/platform/agentHost/node/agentHostMain.js',
    'vs/platform/agentHost/node/agentHostMain.js.map',
];

for (const rel of toCopy) {
    const s = path.join(srcOut, rel);
    const d = path.join(dstOut, rel);
    if (fs.existsSync(s)) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
    }
}

const prodPath = path.join(dstApp, 'product.json');
const prod = JSON.parse(fs.readFileSync(prodPath, 'utf8'));
prod.version = repoPkg.version || prod.version;
prod.voidVersion = repoProd.voidVersion || prod.voidVersion;
prod.commit = commit;
prod.date = dateIso;

if (prod.checksums && typeof prod.checksums === 'object') {
    for (const rel of Object.keys(prod.checksums)) {
        const fp = path.join(dstOut, rel);
        if (fs.existsSync(fp)) {
            prod.checksums[rel] = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('base64').replace(/=+$/, '');
        }
    }
}
const nlsMetaPath = path.join(dstOut, 'nls.metadata.json');
if (fs.existsSync(nlsMetaPath) && prod.commit) {
    prod.nlsMetadataHash = crypto.createHash('md5').update(fs.readFileSync(nlsMetaPath)).update(String(prod.commit)).digest('hex');
}
fs.writeFileSync(prodPath, JSON.stringify(prod, null, '\t'), 'utf8');
console.log('Stamped product.json:', prod.version + '-' + prod.voidVersion, prod.commit.slice(0, 7), prod.date);
"@

node -e $syncScript $OutMinDir $PackagedAppDir $gitCommit $buildIsoDate $RepoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '==> [5/5] Building Windows installer (kodia-installer-x64.exe)...' -ForegroundColor Cyan
npm run gulp vscode-win32-x64-user-setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$pkg = Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
$prod = Get-Content (Join-Path $RepoRoot 'product.json') -Raw | ConvertFrom-Json
$sha256 = (Get-FileHash -Path $InstallerPath -Algorithm SHA256).Hash

$manifest = [ordered]@{
    version        = $pkg.version
    voidVersion    = $prod.voidVersion
    commit         = $gitCommit
    date           = $buildIsoDate
    buildTimestamp = $buildTimestamp
    buildId        = "$($pkg.version)-$($prod.voidVersion)@$($gitCommit.Substring(0, [Math]::Min(10, $gitCommit.Length)))-$buildTimestamp"
    installerFile  = 'kodia-installer-x64.exe'
    sha256         = $sha256
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $ManifestPath -Encoding UTF8

Write-Host ''
Write-Host 'Kodia update build complete!' -ForegroundColor Green
Write-Host "  Installer : $InstallerPath"
Write-Host "  Manifest  : $ManifestPath"
Write-Host "  Version   : $($pkg.version)-$($prod.voidVersion) ($($gitCommit.Substring(0, 7)))"
Write-Host "  SHA-256   : $sha256"
Write-Host 'Any running installed Kodia on this PC will now automatically show "Restart to Update".' -ForegroundColor Green

if ($PublishGitHub) {
    $tag = if ($ReleaseTag) { $ReleaseTag } else { "$($pkg.version)-$($prod.voidVersion)" }
    Write-Host "==> Publishing GitHub Release $tag with kodia-installer-x64.exe..." -ForegroundColor Cyan
    gh release create $tag $InstallerPath --title "Kodia $tag" --notes "Kodia desktop release $tag (commit $($gitCommit.Substring(0, 7)))"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Published GitHub Release $tag! Installed Kodia instances on any laptop will auto-download and prompt Restart to Update." -ForegroundColor Green
}
