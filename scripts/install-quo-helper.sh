#!/usr/bin/env bash
# One-shot setup for the Quo end-call helper. Run this on the Mac that
# actually runs Quo (not inside any remote/cloud session — it has to touch
# real hardware: Homebrew, launchd, System Settings).
#
#   bash scripts/install-quo-helper.sh            # install + start in foreground
#   bash scripts/install-quo-helper.sh --autostart # also start automatically at login
#
# What this script CAN automate: installing Node if missing, and (with
# --autostart) registering a launchd agent so the helper starts at login and
# restarts if it crashes.
#
# What it CANNOT automate, on purpose: macOS refuses to let any script grant
# Accessibility permission to itself or anything else — that's a deliberate
# security boundary (otherwise malware could silently grant itself control
# of your Mac). You have to click that toggle yourself, once. This script
# opens the right System Settings pane for you to make that one click easy.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This helper only works on macOS (it uses AppleScript/System Events)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTOSTART=0
[[ "${1:-}" == "--autostart" ]] && AUTOSTART=1

echo "== Quo end-call helper installer =="
echo "Repo: $REPO_ROOT"
echo

# --- 1. Node.js -------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node via Homebrew..."
    brew install node
  else
    echo "Homebrew isn't installed either. Install one of these, then re-run this script:"
    echo "  - Homebrew: https://brew.sh"
    echo "  - Node.js directly: https://nodejs.org"
    exit 1
  fi
else
  echo "Node.js found: $(node -v)"
fi

NODE_BIN="$(command -v node)"
OSASCRIPT_BIN="$(command -v osascript)"

# --- 2. Accessibility permission --------------------------------------
echo
echo "Opening System Settings -> Privacy & Security -> Accessibility."
echo "This is the one step Claude genuinely cannot do for you: macOS blocks"
echo "any script (mine included) from granting Accessibility access to"
echo "itself or anything else — that's intentional, so malware can't do the"
echo "same thing silently."
echo
echo "In the window that opens, click the '+' button and add whichever of"
echo "these ends up listed there (macOS decides which one, depending on how"
echo "the helper is launched):"
echo "  - Terminal.app          (if you run the helper from a Terminal tab)"
echo "  - node    at: $NODE_BIN"
echo "  - osascript at: $OSASCRIPT_BIN"
echo "Toggle it ON. If nothing is listed yet, just run the helper once first"
echo "(see below) — macOS will prompt you, or add it to this list itself."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" || true
read -r -p "Press Enter once you've added and enabled it (or to continue anyway)... " _

# --- 3. Start the helper ------------------------------------------------
if [[ "$AUTOSTART" -eq 1 ]]; then
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST_PATH="$PLIST_DIR/com.crm.quo-helper.plist"
  mkdir -p "$PLIST_DIR"
  LOG_DIR="$REPO_ROOT/data"
  mkdir -p "$LOG_DIR"

  # launchd agents run in a clean environment — they do NOT read
  # ~/.zshrc or any shell profile, so CRM_BASE_URL/QUO_WEBHOOK_TOKEN (needed
  # for incoming-call detection) have to be baked directly into the plist
  # instead. Pick them up from however this script itself was invoked, e.g.:
  #   CRM_BASE_URL="https://your-crm.example.com" QUO_WEBHOOK_TOKEN="..." \
  #     bash scripts/install-quo-helper.sh --autostart
  # Catches the easy mistake of copy-pasting the example command without
  # replacing the <placeholder> text — those angle brackets are also XML
  # special characters, so left in place they'd silently corrupt the plist
  # (a real failure mode this guards against, not a hypothetical one).
  if [[ "${CRM_BASE_URL:-}" == *"<"* || "${CRM_BASE_URL:-}" == *">"* || "${QUO_WEBHOOK_TOKEN:-}" == *"<"* || "${QUO_WEBHOOK_TOKEN:-}" == *">"* ]]; then
    echo "CRM_BASE_URL or QUO_WEBHOOK_TOKEN still contains < or > — looks like" >&2
    echo "placeholder text (e.g. <your-actual-crm-domain>) wasn't replaced with" >&2
    echo "a real value. Re-run with your actual URL/token, no angle brackets." >&2
    exit 1
  fi

  ENV_VARS_XML=""
  if [[ -n "${CRM_BASE_URL:-}" || -n "${QUO_WEBHOOK_TOKEN:-}" ]]; then
    ENV_VARS_XML="  <key>EnvironmentVariables</key>
  <dict>
    <key>CRM_BASE_URL</key>
    <string>${CRM_BASE_URL:-}</string>
    <key>QUO_WEBHOOK_TOKEN</key>
    <string>${QUO_WEBHOOK_TOKEN:-}</string>
  </dict>
"
    echo "Baking CRM_BASE_URL/QUO_WEBHOOK_TOKEN into the launchd agent for incoming-call detection."
  else
    echo "CRM_BASE_URL/QUO_WEBHOOK_TOKEN not set — incoming-call detection will be off (End Call still works)."
    echo "Re-run with both set, e.g.: CRM_BASE_URL=... QUO_WEBHOOK_TOKEN=... bash scripts/install-quo-helper.sh --autostart"
  fi

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.crm.quo-helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_ROOT/scripts/quo-helper-server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
${ENV_VARS_XML}  <key>StandardOutPath</key>
  <string>$LOG_DIR/quo-helper.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/quo-helper.log</string>
</dict>
</plist>
EOF

  # launchctl load/unload is the legacy interface — it's flaky on modern
  # macOS (Ventura+), sometimes failing with a bare "Input/output error" and
  # no useful detail. bootstrap/bootout is the current, more reliable
  # replacement, addressed to this user's own GUI launchd domain.
  LAUNCHD_DOMAIN="gui/$(id -u)"
  launchctl bootout "$LAUNCHD_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "$LAUNCHD_DOMAIN" "$PLIST_PATH"
  launchctl enable "$LAUNCHD_DOMAIN/com.crm.quo-helper" >/dev/null 2>&1 || true
  echo
  echo "Installed launchd agent at $PLIST_PATH"
  echo "The helper now starts automatically at login and restarts if it ever crashes."
  echo "Logs: $LOG_DIR/quo-helper.log"
  echo
  sleep 1
  if curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo "✅ Helper is running: http://127.0.0.1:8787"
  else
    echo "⚠️  Helper didn't respond yet. Check the log above, and make sure"
    echo "   Accessibility permission is granted to the RIGHT process — since"
    echo "   it's now launched by launchd instead of Terminal, that's usually"
    echo "   'node' ($NODE_BIN) or 'osascript', not Terminal.app."
  fi
  echo
  echo "To stop autostart later:"
  echo "  launchctl bootout $LAUNCHD_DOMAIN $PLIST_PATH && rm $PLIST_PATH"
else
  echo
  echo "Starting the helper in the foreground. Leave this window open while"
  echo "you make calls. Press Ctrl+C to stop it."
  echo "(Re-run this script with --autostart if you'd rather it start itself"
  echo "at login instead of you running this manually each time.)"
  echo
  exec "$NODE_BIN" "$REPO_ROOT/scripts/quo-helper-server.js"
fi
