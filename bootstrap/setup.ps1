# Kindling bootstrap — Windows. FETCHED + run by kindling.cmd (self-fetching one-file entry):
#   powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://kindling.aiviatic.com/setup.ps1 | iex"
# Ensures the pinned Node + Git (portable), then launches Kindling.
#
# SELF-CONTAINED for the `irm | iex` delivery path: there is NO file on disk (no $PSScriptRoot), so
# the helpers are INLINED below rather than dot-sourced — mirroring setup.sh's inline helpers for
# `curl | bash`. Pinned versions below MUST match engine/pins.ts (a unit test asserts this).
# NOTE: portable Node/Git provisioning is the Windows SPIKE — validated on real Windows at the
# dress rehearsal (mirrors engine/provision/node-windows.ts).
$ErrorActionPreference = 'Stop'

$KindlingNodeVersion = '24.16.0'  # == pins.node
$KindlingVersion     = '0.2.3'    # == pins.kindling
$NodeFloorMajor      = 20

# --- Inline helpers (were bootstrap/lib/common.ps1; inlined for the file-less delivery) ----------
function Say([string]$msg) { Write-Host "`n$msg" -ForegroundColor White }
function Test-Cmd([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}
# True if a Node on PATH meets the major-version floor.
function Test-NodeOk([int]$floorMajor) {
  if (-not (Test-Cmd 'node')) { return $false }
  try {
    $v = (& node -v) -replace '^v', ''
    $major = [int]($v -split '\.')[0]
    return $major -ge $floorMajor
  } catch { return $false }
}

Say "Getting your computer ready. This usually takes about 5 minutes."

# Plain-language guidance for the Windows security prompts (FR-7) - expected / safe / reversible.
Say "Heads up: Windows may show a couple of security prompts. They're expected and safe:"
Say " - SmartScreen ('Windows protected your PC'): click 'More info', then 'Run anyway'. Nothing is changed on your PC."
Say " - This window already runs with -ExecutionPolicy Bypass for THIS process only; it does not change any system setting and is fully reversible."

# --- Node (pinned, portable) --------------------------------------------------
# $NodeExe stays $null when a system Node is reused (launch via PATH); the portable-install path
# sets it to the absolute node.exe so the launch never depends on PATH (clean-runtime rule, AR6).
$NodeExe = $null
$arch     = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$distName = "node-v$KindlingNodeVersion-win-$arch"
$nodeRoot = Join-Path $env:LOCALAPPDATA 'kindling\node'
$portableNode = Join-Path $nodeRoot "$distName\node.exe"
if (Test-NodeOk $NodeFloorMajor) {
  Say "Node is already installed - reusing it."
} elseif (Test-Path $portableNode) {
  # Portable Node from a previous run is already extracted here - reuse it, don't re-download the
  # 30 MB. (The portable dir is never persisted to PATH, so Test-NodeOk alone can't see it.)
  Say "Node is already installed - reusing it."
  $NodeExe = $portableNode
} else {
  Say "Setting up Node - the engine your project runs on. This downloads about 30 MB, one time."
  # Portable Node: download the pinned Windows zip from nodejs.org, VERIFY its SHA-256 against Node's
  # published SHASUMS256.txt before touching it, extract, and point the launch at the absolute
  # node.exe (clean-runtime rule AR6 — never rely on a mutated PATH). Mirrors node-windows.ts.
  $ProgressPreference = 'SilentlyContinue'  # a visible progress bar makes Invoke-WebRequest ~10x slower
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zipPath  = Join-Path $nodeRoot "$distName.zip"
  $baseUrl  = "https://nodejs.org/dist/v$KindlingNodeVersion"
  New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null
  try {
    Invoke-WebRequest -Uri "$baseUrl/$distName.zip" -OutFile $zipPath -UseBasicParsing
    $shaLine  = ((Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content -split "`n" |
                 Where-Object { $_ -match [regex]::Escape("$distName.zip") } | Select-Object -First 1)
    $expected = ($shaLine -split '\s+')[0].ToLower()
    $actual   = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
    if (-not $expected -or $actual -ne $expected) {
      throw "downloaded Node failed its integrity check (expected '$expected', got '$actual')"
    }
    Expand-Archive -Path $zipPath -DestinationPath $nodeRoot -Force
  } catch {
    throw "Couldn't set up Node ($($_.Exception.Message)). Check your internet connection, then run this again - it's safe to re-run."
  }
  $NodeExe = Join-Path $nodeRoot "$distName\node.exe"
  if (-not (Test-Path $NodeExe)) { throw "Node was downloaded but node.exe wasn't found at $NodeExe." }
  Say "Node is ready."
}

# --- Git (pinned, portable MinGit) -------------------------------------------
# $GitCmdDir stays $null when a system Git is reused (already on PATH); the portable path sets it to
# MinGit's cmd\ dir, prepended to PATH at launch so the engine can `git init` the new project.
$GitCmdDir = $null
$gitRoot = Join-Path $env:LOCALAPPDATA 'kindling\git'
$portableGitCmd = Join-Path $gitRoot 'cmd'
if (Test-Cmd 'git') {
  Say "Git is already installed - reusing it."
} elseif (Test-Path (Join-Path $portableGitCmd 'git.exe')) {
  # Portable MinGit from a previous run is already extracted here - reuse it, don't re-download.
  Say "Git is already installed - reusing it."
  $GitCmdDir = $portableGitCmd
} else {
  Say "Setting up Git - it keeps the history of your project. This downloads about 35 MB, one time."
  # Portable MinGit (the ZIP build made for bundling): download the pinned release, VERIFY its SHA-256
  # before touching it, extract, and expose cmd\ on PATH. Mirrors the Node block. Pinned version +
  # hash below MUST be bumped together (git-for-windows publishes the digest on each release asset).
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $gitVersion = '2.55.0.2'
  $gitZip  = Join-Path $env:LOCALAPPDATA 'kindling\mingit.zip'
  $gitUrl  = "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.2/MinGit-$gitVersion-64-bit.zip"
  $gitSha  = 'e3ea2944cea4b3fabcd69c7c1669ef69b1b66c05ac7806d81224d0abad2dec31'
  New-Item -ItemType Directory -Force -Path $gitRoot | Out-Null
  try {
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitZip -UseBasicParsing
    $actual = (Get-FileHash -Path $gitZip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $gitSha) {
      throw "downloaded Git failed its integrity check (expected '$gitSha', got '$actual')"
    }
    Expand-Archive -Path $gitZip -DestinationPath $gitRoot -Force
  } catch {
    throw "Couldn't set up Git ($($_.Exception.Message)). Check your internet connection, then run this again - it's safe to re-run."
  }
  $GitCmdDir = $portableGitCmd
  if (-not (Test-Path (Join-Path $GitCmdDir 'git.exe'))) { throw "Git was downloaded but git.exe wasn't found at $GitCmdDir." }
  Say "Git is ready."
}

# --- Persist the portable runtime on the USER PATH ---------------------------
# So the tools actually WORK in a normal terminal afterward (not just during this run): node/npm/npx
# live in the Node dir, git in MinGit's cmd\, and any globally-installed agent CLI (claude/codex)
# gets its shim written INTO the Node dir (npm's global prefix) - so putting the Node dir on PATH
# covers those too. Only the PORTABLE paths need this; a reused system Node/Git is already on PATH.
# User-scope (no admin), idempotent, prepended so the pinned runtime wins. Future terminals pick it up.
function Add-UserPath([string]$dir) {
  if (-not $dir -or -not (Test-Path $dir)) { return }
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @(($cur -split ';') | Where-Object { $_ -ne '' })
  if ($parts -notcontains $dir) {
    [Environment]::SetEnvironmentVariable('Path', ((@($dir) + $parts) -join ';'), 'User')
  }
}
if ($NodeExe) { Add-UserPath (Split-Path $NodeExe) }
if ($GitCmdDir) { Add-UserPath $GitCmdDir }

# --- Launch Kindling (clean-runtime: absolute node when portable, else npx on PATH) -----------
Say "Starting Kindling..."
# Launch from a NEUTRAL directory, never the folder the download was run from. npx runs the
# package's `kindling` bin BY NAME, and Windows searches the CURRENT directory first — so if the
# downloaded `kindling.cmd` sits in the cwd, `kindling` resolves to IT instead of npx's shim and
# re-runs the whole bootstrap forever (dress-rehearsal Windows loop, 2026-07-03). LOCALAPPDATA\kindling
# holds only the portable Node, never a `kindling.cmd`.
$launchDir = Join-Path $env:LOCALAPPDATA 'kindling'
New-Item -ItemType Directory -Force -Path $launchDir | Out-Null
Set-Location -LiteralPath $launchDir
# Portable Git on PATH (the engine spawns `git` by name to scaffold the project's history). Applies
# to both launch branches; the provisioned Node dir is added inside the portable-Node branch below.
if ($GitCmdDir) { $env:Path = "$GitCmdDir;$env:Path" }
if ($null -eq $NodeExe) {
  & npx -y "@aiviatic/kindling@$KindlingVersion"
} else {
  # Put the provisioned Node dir on PATH so bare `node`/`npm`/`npx` resolve by NAME. Launching via the
  # absolute node binary isn't enough: npx and the launched package (plus the child processes the
  # engine spawns for provisioning) call `node` by name and inherit this PATH — without it they fail
  # with "'node' is not recognized" and Kindling never starts. (Dress-rehearsal finding, 2026-07-03.)
  $env:Path = "$(Split-Path $NodeExe);$env:Path"
  # Invoke npx's CLI through the exact provisioned node binary — no reliance on PATH for the launch itself.
  $NpxCli = Join-Path (Split-Path $NodeExe) 'node_modules\npm\bin\npx-cli.js'
  & $NodeExe $NpxCli -y "@aiviatic/kindling@$KindlingVersion"
}
# A native exe (npx) does NOT raise a terminating error on failure even with
# ErrorActionPreference='Stop' — it only sets $LASTEXITCODE. So check that explicitly.
if ($LASTEXITCODE -ne 0) {
  Say "Kindling couldn't start. Check that you're connected to the internet, then run it again. It's safe to re-run."
  exit 1
}
