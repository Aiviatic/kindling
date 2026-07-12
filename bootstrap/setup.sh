#!/usr/bin/env bash
# Kindling bootstrap — macOS/Linux. Served by the Landing Page as:
#   curl -fsSL https://kindling.aiviatic.com/install | bash
# Ensures the pinned Node + Git, then launches Kindling in the SAME shell (no new terminal).
#
# Pinned versions below MUST match engine/pins.ts + node-unix.ts (a unit test asserts this).
set -euo pipefail

KINDLING_NODE_VERSION="24.16.0"  # == pins.node
KINDLING_VERSION="0.2.4"         # == pins.kindling
NVM_VERSION="v0.40.3"            # == NVM_VERSION (engine/provision/node-unix.ts)
NODE_FLOOR_MAJOR=20

# Self-contained helpers — this file is delivered via `curl … | bash`, where there is NO file on
# disk (BASH_SOURCE is empty), so we cannot source a shared helper file. Keep these inline.
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }
node_ok() {
  have_cmd node || return 1
  local major
  major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
  [ -n "$major" ] && [ "$major" -ge "$1" ]
}

say "🔥 Getting your computer ready. This usually takes about 5 minutes."

# --- Node (pinned, via nvm) ---------------------------------------------------
if node_ok "$NODE_FLOOR_MAJOR"; then
  say "Node is already installed, reusing it."
else
  say "Setting up Node, the engine your project runs on."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    if ! curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash; then
      say "Couldn't install nvm. Check your internet connection, then run the line again. It's safe to re-run."
      exit 1
    fi
  fi
  set +u                 # nvm.sh references unset vars; `set -u` would abort while sourcing it
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  set -u
  if ! nvm install "$KINDLING_NODE_VERSION"; then
    say "Couldn't set up Node. Check your internet connection, then run the line again."
    exit 1
  fi
fi

# --- Git is provisioned by the ENGINE (in the browser), not here -------------
# On macOS/Linux, Git/Xcode-CLT provisioning runs inside kindling so the browser shows the
# never-frozen progress (the ~5-min macOS dialog with reassurance). The bootstrap only needs
# Node to launch kindling — Git isn't required to start. (Provisioning-reconciliation Option C.)

# --- Launch Kindling (same shell — node is on PATH via nvm or already present) -
say "Starting Kindling…"
if ! npx -y "@aiviatic/kindling@$KINDLING_VERSION"; then
  say "Kindling couldn't start. Check that you're connected to the internet, then run the line again. It's safe to re-run."
  exit 1
fi
