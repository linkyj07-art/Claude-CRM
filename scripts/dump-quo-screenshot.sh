#!/usr/bin/env bash
# Diagnostic only — not used by the running helper yet. Captures a screenshot
# of Quo's actual window (not your whole screen) and runs OCR on it, so we
# can see whether reading the incoming-call popup visually (instead of
# through accessibility APIs, which Quo mostly hides without VoiceOver) is
# accurate enough to build the real detection on.
#
# One-time setup: brew install tesseract
#
# Run this WHILE a call is ringing into Quo:
#   bash scripts/dump-quo-screenshot.sh

set -euo pipefail

if ! command -v tesseract >/dev/null 2>&1; then
  echo "tesseract isn't installed. Run this first, then try again:" >&2
  echo "  brew install tesseract" >&2
  exit 1
fi

OUT_DIR="$HOME/Desktop"
IMG_PATH="$OUT_DIR/quo-capture.png"
OCR_BASE="$OUT_DIR/quo-ocr"

WINDOW_ID=$(osascript -e 'tell application "System Events" to tell process "Quo" to id of window 1' 2>&1) || {
  echo "Couldn't get Quo's window id. Is Quo open? Error was:" >&2
  echo "$WINDOW_ID" >&2
  exit 1
}

screencapture -l "$WINDOW_ID" -o -x "$IMG_PATH"
echo "Screenshot saved to $IMG_PATH"

tesseract "$IMG_PATH" "$OCR_BASE" 2>/dev/null
echo "OCR text saved to $OCR_BASE.txt"
echo ""
echo "--- OCR TEXT ---"
cat "$OCR_BASE.txt"
