#!/usr/bin/env node
// Local helper that connects the CRM (running in your browser) to Quo,
// running on this same Mac. Two things:
//
// 1. END CALL — the CRM's "End Quo Call" button POSTs to /end-call, which
//    briefly focuses Quo, sends its hangup shortcut (Cmd+Shift+H by
//    default), then restores whatever app you were using.
//
// 2. INCOMING CALL DETECTION + ANSWER/DECLINE — Quo's call popup is built
//    on a web view that hides its content from accessibility tools unless
//    VoiceOver is running, which isn't workable for an always-on background
//    helper. So instead this periodically screenshots Quo's window (without
//    stealing focus — screenshotting doesn't require the app to be
//    frontmost) and runs OCR (via `tesseract`) on it, looking for the
//    "Incoming call" popup and the caller's number. When found, it's POSTed
//    to the CRM's /api/webhooks/incoming-call endpoint, same as the
//    Zapier-based path, so the CRM's matching/notification logic is
//    identical either way. Answer/Decline work the same way in reverse:
//    find the on-screen position of the "Accept"/"Reject" text via OCR and
//    click it directly (System Events can click arbitrary screen
//    coordinates without needing an accessible UI element).
//
//    Requires: `brew install tesseract` (one-time), and CRM_BASE_URL +
//    QUO_WEBHOOK_TOKEN set (see .env.example / README). Without those set,
//    only the End Call feature runs — incoming-call detection is skipped
//    with a note in the log, not a crash.
//
//    Known limitation: since this reads actual screen pixels, Quo's window
//    needs to be visible on screen (not minimized, not fully covered by
//    another window) for detection to work. It does NOT need to be the
//    focused/frontmost app.
//
// macOS only. Start it with `npm run quo-helper` and leave it running in a
// terminal tab while you're making calls.
//
// One-time setup: System Settings -> Privacy & Security -> Accessibility
// AND Screen Recording -> enable whatever app runs this script (usually
// Terminal, iTerm, or your code editor's integrated terminal).
//
// Note: /end-call and /answer-call /decline-call have no authentication —
// anything running on your Mac (or, in principle, a malicious page in your
// browser that discovers the port) can hit them. All they can do is
// interact with Quo's own call controls, so the worst case is an unwanted
// hangup/answer/decline, not data exposure. Don't expose this port beyond
// 127.0.0.1.

const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Timestamp every log line -- without this there's no way to actually
// measure how long detection/Answer/Decline take from the log alone, only
// guess at it.
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
console.log = (...args) => origLog(`[${new Date().toISOString()}]`, ...args);
console.error = (...args) => origError(`[${new Date().toISOString()}]`, ...args);

const PORT = process.env.QUO_HELPER_PORT ? Number(process.env.QUO_HELPER_PORT) : 8787;
const QUO_APP_NAME = process.env.QUO_APP_NAME || 'Quo';
const QUO_HANGUP_KEY = process.env.QUO_HANGUP_KEY || 'h'; // Cmd+Shift+H by default
const CRM_BASE_URL = process.env.CRM_BASE_URL || '';
const QUO_WEBHOOK_TOKEN = process.env.QUO_WEBHOOK_TOKEN || '';
const POLL_MS = process.env.QUO_POLL_MS ? Number(process.env.QUO_POLL_MS) : 1000;
const CAPTURE_PATH = path.join(os.tmpdir(), 'quo-helper-capture.png');

if (process.platform !== 'darwin') {
  console.error('quo-helper only works on macOS (it relies on AppleScript/System Events).');
  process.exit(1);
}

function runOsascript(lines) {
  return new Promise((resolve, reject) => {
    const args = lines.flatMap((line) => ['-e', line]);
    execFile('osascript', args, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
}

function endQuoCall() {
  return runOsascript([
    'tell application "System Events" to set frontApp to name of first application process whose frontmost is true',
    `tell application "${QUO_APP_NAME}" to activate`,
    'delay 0.35',
    `tell application "System Events" to keystroke "${QUO_HANGUP_KEY}" using {command down, shift down}`,
    'delay 0.15',
    'tell application frontApp to activate'
  ]);
}

// Reading position/size (unlike clicking or sending keystrokes) doesn't
// require Quo to be frontmost, so polling for this never steals focus.
async function getQuoWindowRegion() {
  const out = await runOsascript([
    'tell application "System Events"',
    `tell process "${QUO_APP_NAME}"`,
    'set {px, py} to position of window 1',
    'set {sw, sh} to size of window 1',
    'end tell',
    'end tell',
    'return (px as string) & "," & (py as string) & "," & (sw as string) & "," & (sh as string)'
  ]);
  const parts = out.split(',').map((n) => parseInt(n.trim(), 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Unexpected window region output: ${out}`);
  }
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function captureRegion(region) {
  return new Promise((resolve, reject) => {
    const arg = `${region.x},${region.y},${region.w},${region.h}`;
    execFile('screencapture', ['-R', arg, '-o', '-x', CAPTURE_PATH], (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve(CAPTURE_PATH);
    });
  });
}

// Tesseract's TSV output gives per-word bounding boxes (image-local
// coordinates), which is what lets us both find the caller's number AND
// locate exactly where to click "Accept"/"Reject" — plain text OCR alone
// would give us the words but not where they are on screen.
function ocrWords(imgPath) {
  return new Promise((resolve, reject) => {
    execFile('tesseract', [imgPath, 'stdout', 'tsv'], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      const lines = stdout.split('\n').slice(1); // drop header row
      const words = [];
      for (const line of lines) {
        const cols = line.split('\t');
        if (cols.length < 12) continue;
        const [level, , blockNum, , , , left, top, width, height, , text] = cols;
        if (level !== '5') continue; // level 5 = word
        const trimmed = text.trim();
        if (!trimmed) continue;
        words.push({
          text: trimmed,
          blockNum,
          left: Number(left),
          top: Number(top),
          width: Number(width),
          height: Number(height)
        });
      }
      resolve(words);
    });
  });
}

const PHONE_PATTERN = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

// Restricts the phone-number search to the same OCR "block" as the
// "Incoming" text (Quo's popup renders as one contiguous block distinct
// from the rest of the UI) so a different number elsewhere on screen — an
// old call in the sidebar's history list, for instance — never gets
// mistaken for the one actually ringing.
function findIncomingCallPhone(words) {
  const incomingWord = words.find((w) => /incoming/i.test(w.text));
  if (!incomingWord) return null;

  const sameBlock = words.filter((w) => w.blockNum === incomingWord.blockNum);
  const joined = sameBlock.map((w) => w.text).join(' ');
  const match = joined.match(PHONE_PATTERN);
  return match ? match[0] : null;
}

// Real captures showed buttons often end up in a DIFFERENT tesseract
// "block" than the "Incoming call" text -- block_num is tesseract's own
// visual layout guess, not the popup's actual DOM structure, and it
// frequently segments a row of buttons separately from the text above them.
// So: prefer the same block, but fall back to the closest vertical match to
// "Incoming" (buttons are always a bit below it, never far) instead of
// failing outright, and only fall back further to a bare global match as a
// last resort.
function findButtonCenter(words, labelPattern) {
  const incomingWord = words.find((w) => /incoming/i.test(w.text));
  const allMatches = words.filter((w) => labelPattern.test(w.text));
  if (allMatches.length === 0) return null;

  let target;
  if (incomingWord) {
    target =
      allMatches.find((w) => w.blockNum === incomingWord.blockNum) ||
      allMatches.reduce((closest, w) => {
        const dist = Math.abs(w.top - incomingWord.top);
        const closestDist = closest ? Math.abs(closest.top - incomingWord.top) : Infinity;
        return dist < closestDist ? w : closest;
      }, null);
  } else {
    target = allMatches[0];
  }

  if (!target) return null;
  return { x: target.left + target.width / 2, y: target.top + target.height / 2 };
}

async function clickInQuo(imgLocalPoint, region) {
  const screenX = Math.round(region.x + imgLocalPoint.x);
  const screenY = Math.round(region.y + imgLocalPoint.y);
  await runOsascript([`tell application "System Events" to click at {${screenX}, ${screenY}}`]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A single OCR pass can miss the button through no fault of the call still
// being up — a mistimed screenshot, a momentary redraw, etc. — so retry a
// couple of times before concluding it's actually gone, rather than failing
// on the first miss.
async function findAndClick(labelPattern, notFoundMessage) {
  const region = await getQuoWindowRegion();
  for (let attempt = 0; attempt < 3; attempt++) {
    await captureRegion(region);
    const words = await ocrWords(CAPTURE_PATH);
    const center = findButtonCenter(words, labelPattern);
    if (center) {
      await clickInQuo(center, region);
      return;
    }
    if (attempt < 2) await sleep(400);
  }
  throw new Error(notFoundMessage);
}

// Substring match, not exact ("Accept" not "^Accept$") -- OCR on small
// button text is noisy enough that requiring a perfectly clean word match
// made this fail even while the button was genuinely still on screen.
// Still scoped to the same OCR block as "Incoming call" by findButtonCenter,
// so this can't accidentally match unrelated text elsewhere on screen.
function answerCall() {
  return findAndClick(/Accept/i, 'Could not find an "Accept" button on screen right now — is a call actually ringing?');
}

function declineCall() {
  return findAndClick(/Reject/i, 'Could not find a "Reject" button on screen right now — is a call actually ringing?');
}

// --- Incoming-call polling -------------------------------------------
// currentRingingPhone debounces repeated POSTs while the same call is still
// ringing (this runs every POLL_MS while the popup is up) and resets once
// no incoming-call popup is detected for MISSES_BEFORE_RESET consecutive
// ticks, so the NEXT call — even from the same number — notifies again.
// Requiring more than one miss (rather than resetting on the very first)
// absorbs a single flaky OCR read mid-call — confirmed via real logs to
// happen — without waiting for the call to still actually be ringing.
let currentRingingPhone = null;
let consecutiveMisses = 0;
const MISSES_BEFORE_RESET = 2;
let pollBusy = false;

function notifyIncomingCall(phone) {
  const url = `${CRM_BASE_URL.replace(/\/$/, '')}/api/webhooks/incoming-call?token=${encodeURIComponent(QUO_WEBHOOK_TOKEN)}`;
  const body = JSON.stringify({ phone });
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    .then((res) => {
      if (!res.ok) console.error(`[incoming-call] CRM webhook responded ${res.status}`);
    })
    .catch((err) => console.error('[incoming-call] Could not reach the CRM webhook:', err.message));
}

async function pollOnce() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const region = await getQuoWindowRegion();
    await captureRegion(region);
    const words = await ocrWords(CAPTURE_PATH);
    const phone = findIncomingCallPhone(words);
    // Compare digits only, not the raw OCR string — formatting can come out
    // slightly differently between polls (spacing, etc.) even for the exact
    // same still-ringing call, which would otherwise look like a new call.
    const normalized = phone ? phone.replace(/\D/g, '') : null;

    if (normalized) {
      consecutiveMisses = 0;
      if (normalized !== currentRingingPhone) {
        currentRingingPhone = normalized;
        console.log(`[incoming-call] Detected: ${phone}`);
        await notifyIncomingCall(phone);
      }
    } else {
      consecutiveMisses += 1;
      if (consecutiveMisses >= MISSES_BEFORE_RESET) {
        currentRingingPhone = null;
      }
    }
  } catch {
    // Quo minimized, window covered, OCR hiccup, etc. — deliberately NOT
    // resetting currentRingingPhone here: a single bad tick during an
    // otherwise still-ringing call would otherwise make the next good tick
    // look like a "new" call and re-notify for the same one.
  } finally {
    pollBusy = false;
  }
}

function checkTesseractInstalled() {
  return new Promise((resolve) => {
    execFile('tesseract', ['--version'], (error) => resolve(!error));
  });
}

async function startPollingIfConfigured() {
  if (!CRM_BASE_URL || !QUO_WEBHOOK_TOKEN) {
    console.log('[incoming-call] CRM_BASE_URL / QUO_WEBHOOK_TOKEN not set — incoming-call detection is off. End Call still works.');
    return;
  }
  const hasTesseract = await checkTesseractInstalled();
  if (!hasTesseract) {
    console.log('[incoming-call] tesseract not installed (run `brew install tesseract`) — incoming-call detection is off. End Call still works.');
    return;
  }
  console.log(`[incoming-call] Watching Quo for incoming calls every ${POLL_MS}ms.`);
  setInterval(pollOnce, POLL_MS);
}

// --- HTTP server --------------------------------------------------------
function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome's Private Network Access preflight, since the CRM tab (a public
  // https:// origin) is calling into a loopback address.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function handleAction(res, action) {
  action()
    .then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    })
    .catch((err) => {
      console.error('Action failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
}

const server = http.createServer((req, res) => {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/end-call') {
    handleAction(res, endQuoCall);
    return;
  }

  if (req.method === 'POST' && req.url === '/answer-call') {
    handleAction(res, answerCall);
    return;
  }

  if (req.method === 'POST' && req.url === '/decline-call') {
    handleAction(res, declineCall);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Quo helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Will activate "${QUO_APP_NAME}" and send Cmd+Shift+${QUO_HANGUP_KEY.toUpperCase()} to end a call.`);
  console.log('Leave this running while you make calls. Ctrl+C to stop.');
  startPollingIfConfigured();
});
