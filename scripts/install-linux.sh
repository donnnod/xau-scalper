#!/usr/bin/env bash
#
# One-command setup for running XAU Scalper on any Linux server.
#
#   ./scripts/install-linux.sh
#
# What it does, in order:
#   1. Installs Bun into ~/.bun if it is not already on PATH.
#   2. Installs the project dependencies with `bun install`.
#   3. Builds the UI into dist/ so the server has something to serve.
#   4. Creates .env.local from the template on first run (never overwrites).
#
# It touches nothing outside this repo and ~/.bun. Re-running is safe: each step
# is a no-op when it has already been done. Nothing needs root — see
# scripts/xau-scalper.service for running it as a boot service.
#
# After it finishes:
#   bun run start          # → http://127.0.0.1:4000
#
set -euo pipefail

# Resolve the repo root from this script's location, so it works no matter the
# working directory it is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }

# 1. Bun ----------------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  # A fresh shell may already have Bun installed but not yet on PATH.
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    say "Installing Bun (no root required)…"
    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is required to install Bun. Install curl and re-run." >&2
      echo "  Debian/Ubuntu: sudo apt-get install -y curl" >&2
      echo "  Fedora/RHEL:   sudo dnf install -y curl" >&2
      exit 1
    fi
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is still not on PATH. Add this to your shell profile and re-run:" >&2
  echo '  export PATH="$HOME/.bun/bin:$PATH"' >&2
  exit 1
fi
say "Using $(bun --version) at $(command -v bun)"

# 2. Dependencies -------------------------------------------------------------
say "Installing dependencies…"
bun install

# 3. Build the UI -------------------------------------------------------------
say "Building the UI into dist/…"
bun run build

# 4. Environment file ---------------------------------------------------------
if [ ! -f .env.local ]; then
  say "Creating .env.local from .env.example (edit it to taste)…"
  cp .env.example .env.local
else
  say ".env.local already exists — leaving it untouched."
fi

cat <<'DONE'

Done. Start the server with:

  bun run start                 # binds 127.0.0.1:4000 (this machine only)

To reach it from other machines on your LAN, set TEO_HOST in .env.local:

  TEO_HOST=0.0.0.0

then open http://<this-server-ip>:4000 from your phone or laptop.
There is NO authentication — only do this on a trusted network.

To run it in the background and start it on every boot, install the systemd
service (see scripts/xau-scalper.service for the two commands).
DONE
