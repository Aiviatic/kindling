#!/usr/bin/env bash
# Kindling bootstrap — macOS/Linux. Served by the Landing Page as:
#   curl -fsSL https://kindling.aiviatic.com/install | bash
# Ensures the pinned Node + Git, then launches Kindling in the SAME shell (no new terminal).
#
# Pinned versions below MUST match engine/pins.ts + node-unix.ts (a unit test asserts this).
set -euo pipefail

KINDLING_NODE_VERSION="24.16.0"  # == pins.node
KINDLING_VERSION="0.2.6"         # == pins.kindling
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

# The shell profile our nvm loader should live in. zsh (the macOS default): ALWAYS .zshrc — every
# interactive zsh reads it (login or not — VS Code terminals, tmux, iTerm profiles), and creating
# it never shadows an existing .zprofile (zsh reads both). bash: prefer an EXISTING file so we
# never shadow one (creating .bash_profile would stop bash reading .profile).
shell_profile() {
  case "${SHELL:-}" in
    */zsh) printf '%s/.zshrc' "${ZDOTDIR:-$HOME}" ;;
    */bash)
      if [ -f "$HOME/.bashrc" ]; then printf '%s/.bashrc' "$HOME"
      elif [ -f "$HOME/.bash_profile" ]; then printf '%s/.bash_profile' "$HOME"
      elif [ -f "$HOME/.profile" ]; then printf '%s/.profile' "$HOME"
      elif [ "$(uname -s)" = "Darwin" ]; then printf '%s/.bash_profile' "$HOME"
      else printf '%s/.bashrc' "$HOME"; fi ;;
    # SHELL unset/unusual: on macOS the login shell is zsh (Catalina+), so target .zshrc — zsh
    # never reads ~/.profile, which would silently miss. Elsewhere ~/.profile is the POSIX home.
    *)
      if [ "$(uname -s)" = "Darwin" ]; then printf '%s/.zshrc' "${ZDOTDIR:-$HOME}"
      else printf '%s/.profile' "$HOME"; fi ;;
  esac
}

# --- Node (pinned, via nvm) ---------------------------------------------------
if node_ok "$NODE_FLOOR_MAJOR"; then
  say "Node is already installed, reusing it."
else
  say "Setting up Node, the engine your project runs on."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # nvm's installer only appends its loader to a shell profile that ALREADY exists — a brand-new
  # Mac has none (no ~/.zshrc until something creates it), so Node/npm would vanish from every
  # terminal opened after this one. Write the loader ourselves, creating the profile if needed.
  # Runs on EVERY install pass (not just the first) so a previously broken setup is repaired by
  # re-running the install line.
  PROFILE_FILE="$(shell_profile)"
  if ! touch "$PROFILE_FILE" 2>/dev/null; then
    say "Couldn't write to $PROFILE_FILE. Check the file's permissions, then run the line again."
    exit 1
  fi
  # Idempotency guard keys on OUR marker, not on any '/nvm.sh' mention — a stale/foreign nvm
  # loader (old tutorial, Homebrew nvm pointing elsewhere) must NOT suppress ours. If one exists,
  # ours is appended AFTER it, so ours wins for NVM_DIR/PATH; both loaders are [ -s ]-guarded, so
  # a duplicate is harmless.
  if ! grep -q 'Added by Kindling' "$PROFILE_FILE"; then
    if ! {
      printf '\n# Added by Kindling (kindling.aiviatic.com) — load nvm so Node/npm work in every terminal\n'
      printf 'export NVM_DIR="%s"\n' "$NVM_DIR"
      printf '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"  # This loads nvm\n'
      printf '[ -s "$NVM_DIR/bash_completion" ] && \\. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion\n'
    } >> "$PROFILE_FILE"; then
      say "Couldn't write to $PROFILE_FILE. Check the file's permissions, then run the line again."
      exit 1
    fi
  fi
  # Bare-home Linux: the loader went into .bashrc, but LOGIN shells (ssh, console) read
  # ~/.profile / ~/.bash_profile — with neither present, they'd never source .bashrc and node/npm
  # would be missing over ssh. Chain them the way Debian's /etc/skel does. (Darwin bash never
  # lands here: its fresh-file fallback is .bash_profile.)
  if [ "$PROFILE_FILE" = "$HOME/.bashrc" ] && [ ! -f "$HOME/.profile" ] && [ ! -f "$HOME/.bash_profile" ]; then
    if ! printf '# Added by Kindling — login shells read this file, not .bashrc; chain to it (as /etc/skel does)\nif [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\n' > "$HOME/.profile"; then
      say "Couldn't write to $HOME/.profile. Check the file's permissions, then run the line again."
      exit 1
    fi
  fi
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    if ! curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash; then
      say "Couldn't install nvm. Check your internet connection, then run the line again. It's safe to re-run."
      exit 1
    fi
  fi
  # Suspend BOTH -u and -e while sourcing: nvm.sh references unset vars, AND on a machine with no
  # prior node its auto-`use` step can return non-zero — under `set -e` that kills this script
  # SILENTLY, right before the install (verified against a blank $HOME). Restore both after.
  set +eu
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  set -eu
  if ! have_cmd nvm; then
    say "Couldn't load nvm after installing it. Run the line again — it's safe to re-run."
    exit 1
  fi
  # Alpine/musl: nodejs.org has no prebuilt musl binaries, so nvm may fall back to compiling from
  # source (slow; fails without a toolchain). Warn honestly up front instead of letting a
  # compiler error surface later as a mysterious "check your connection".
  if [ -f /etc/alpine-release ]; then
    say "Heads up: this looks like Alpine Linux. Node doesn't ship prebuilt for it, so this step may try to build from source — that can take a long time or fail. If it fails, use a mainstream distro (Ubuntu, Fedora) instead."
  fi
  if ! nvm install "$KINDLING_NODE_VERSION"; then
    say "Couldn't set up Node. Check your internet connection, then run the line again."
    exit 1
  fi
  NODE_PROVISIONED_THIS_RUN=1
  # fish users: nvm has no fish support, and the POSIX loader above never runs in fish — put the
  # pinned Node's bin dir on fish's PATH directly (best-effort; never fails the install).
  case "${SHELL:-}" in
    */fish)
      FISH_CONFIG="$HOME/.config/fish/config.fish"
      NODE_BIN_DIR="$NVM_DIR/versions/node/v$KINDLING_NODE_VERSION/bin"
      mkdir -p "$HOME/.config/fish" 2>/dev/null || true
      if ! grep -Fqs "$NODE_BIN_DIR" "$FISH_CONFIG"; then
        {
          printf '\n# Added by Kindling (kindling.aiviatic.com) — nvm has no fish support; add Node directly\n'
          printf 'if test -d "%s"\n    set -gx PATH "%s" $PATH\nend\n' "$NODE_BIN_DIR" "$NODE_BIN_DIR"
        } >> "$FISH_CONFIG" 2>/dev/null || say "Couldn't write $FISH_CONFIG — add $NODE_BIN_DIR to fish's PATH yourself."
      fi
      ;;
  esac
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

# Node was installed DURING this session, so the terminal this was pasted into doesn't have it on
# PATH yet (only NEW terminals read the profile we wrote). Say so — otherwise `npm`/`claude` look
# "not installed" in the very window the user is sitting in.
if [ "${NODE_PROVISIONED_THIS_RUN:-0}" = "1" ]; then
  say "One last thing: open a NEW terminal window before using commands like npm or claude — this window was opened before Node was installed, so it can't see them yet."
fi
