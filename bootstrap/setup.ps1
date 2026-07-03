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
$KindlingVersion     = '0.1.0'    # == pins.kindling
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
if (Test-NodeOk $NodeFloorMajor) {
  Say "Node is already installed - reusing it."
} else {
  Say "Setting up Node - the engine your project runs on."
  # Portable Node download/extract — SPIKE (see engine/provision/node-windows.ts); resolved at
  # rehearsal. It will set: $NodeExe = "<extract-dir>\node-v$KindlingNodeVersion-win-x64\node.exe"
  throw "Automatic Node setup for Windows isn't available yet. Please install Node.js 20 or newer from https://nodejs.org, then run this again."
}

# --- Git (portable) -----------------------------------------------------------
if (Test-Cmd 'git') {
  Say "Git is already installed - reusing it."
} else {
  Say "Setting up Git - it keeps the history of your project."
  # PortableGit download/extract — deferred (needs pinned version + release URL); resolved at rehearsal.
}

# --- Launch Kindling (clean-runtime: absolute node when portable, else npx on PATH) -----------
Say "Starting Kindling..."
if ($null -eq $NodeExe) {
  & npx -y "@aiviatic/kindling@$KindlingVersion"
} else {
  # Invoke npx's CLI through the exact provisioned node binary — no reliance on PATH.
  $NpxCli = Join-Path (Split-Path $NodeExe) 'node_modules\npm\bin\npx-cli.js'
  & $NodeExe $NpxCli -y "@aiviatic/kindling@$KindlingVersion"
}
# A native exe (npx) does NOT raise a terminating error on failure even with
# ErrorActionPreference='Stop' — it only sets $LASTEXITCODE. So check that explicitly.
if ($LASTEXITCODE -ne 0) {
  Say "Kindling couldn't start. Check that you're connected to the internet, then run it again. It's safe to re-run."
  exit 1
}
