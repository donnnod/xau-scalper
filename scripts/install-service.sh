#!/usr/bin/env bash
#
# Install XAU Scalper as a systemd service so it runs in the background and
# starts on boot. Wraps scripts/xau-scalper.service, filling in the current
# user, this repo's path and the Bun binary.
#
#   ./scripts/install-service.sh              # per-user service (no root)
#   sudo ./scripts/install-service.sh --system  # system-wide service
#
# A per-user service is the simpler choice and needs no root, but it only runs
# while that user is "lingering" or logged in. To keep a per-user service alive
# across logouts/reboots on a headless box, enable lingering once:
#
#   sudo loginctl enable-linger "$USER"
#
# A --system service runs regardless of login but requires root to install.
#
# Re-running re-writes the unit and restarts the service, so it doubles as an
# "apply my changes" command.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="user"
if [ "${1:-}" = "--system" ]; then
  MODE="system"
fi

# Locate Bun the same way the shell would, falling back to the standard path.
BUN="$(command -v bun || true)"
if [ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
fi
if [ -z "$BUN" ]; then
  echo "Bun not found. Run ./scripts/install-linux.sh first." >&2
  exit 1
fi

if [ ! -d "$ROOT/dist" ]; then
  echo "dist/ is missing — run ./scripts/install-linux.sh (it builds the UI)." >&2
  exit 1
fi

render() {
  sed \
    -e "s|__USER__|$1|g" \
    -e "s|__WORKDIR__|$ROOT|g" \
    -e "s|__BUN__|$BUN|g" \
    "$SCRIPT_DIR/xau-scalper.service"
}

if [ "$MODE" = "system" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "--system needs root. Re-run with: sudo $0 --system" >&2
    exit 1
  fi
  # SUDO_USER is the human who invoked sudo; fall back to root if run directly.
  RUN_AS="${SUDO_USER:-root}"
  DEST="/etc/systemd/system/xau-scalper.service"
  render "$RUN_AS" >"$DEST"
  systemctl daemon-reload
  systemctl enable --now xau-scalper
  echo
  echo "Installed system service. Handy commands:"
  echo "  systemctl status xau-scalper"
  echo "  journalctl -u xau-scalper -f"
  echo "  systemctl restart xau-scalper"
else
  DEST="$HOME/.config/systemd/user/xau-scalper.service"
  mkdir -p "$(dirname "$DEST")"
  render "$USER" >"$DEST"
  systemctl --user daemon-reload
  systemctl --user enable --now xau-scalper
  echo
  echo "Installed user service. Handy commands:"
  echo "  systemctl --user status xau-scalper"
  echo "  journalctl --user -u xau-scalper -f"
  echo "  systemctl --user restart xau-scalper"
  echo
  echo "To keep it running when you are not logged in (headless server):"
  echo "  sudo loginctl enable-linger \"$USER\""
fi
