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
const POLL_MS = process.env.QUO_POLL_MS ? Number(process.env.QUO_POLL_MS) : 300;
// On the Desktop (not a hidden temp folder) so it can actually be opened
// and inspected while debugging -- one file, overwritten every capture, not
// something that accumulates.
const CAPTURE_PATH = path.join(os.homedir(), 'Desktop', 'quo-helper-capture.png');

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

function getImagePixelSize(imgPath) {
  return new Promise((resolve, reject) => {
    execFile('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', imgPath], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      const w = /pixelWidth:\s*(\d+)/.exec(stdout);
      const h = /pixelHeight:\s*(\d+)/.exec(stdout);
      if (!w || !h) {
        reject(new Error(`Could not parse sips output: ${stdout}`));
        return;
      }
      resolve({ width: Number(w[1]), height: Number(h[1]) });
    });
  });
}

// On a Retina display, screencapture -R (which takes the same point-based
// coordinates System Events uses for window position/size) produces an
// image at roughly 2x that many actual pixels. Tesseract's OCR bounding
// boxes are in those image pixels, not points -- so converting an OCR
// coordinate straight into a click point without correcting for this would
// click at roughly double the intended offset from the window's origin.
// scaleX/scaleY (image pixels per point) let callers convert back.
async function captureRegion(region) {
  await new Promise((resolve, reject) => {
    const arg = `${region.x},${region.y},${region.w},${region.h}`;
    execFile('screencapture', ['-R', arg, '-o', '-x', CAPTURE_PATH], (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve();
    });
  });
  const pixelSize = await getImagePixelSize(CAPTURE_PATH);
  return {
    scaleX: pixelSize.width / region.w,
    scaleY: pixelSize.height / region.h
  };
}

// Tesseract's TSV output gives per-word bounding boxes (image-local
// coordinates), which is what lets us both find the caller's number AND
// locate exactly where to click "Accept"/"Reject" — plain text OCR alone
// would give us the words but not where they are on screen.
function ocrWords(imgPath) {
  return new Promise((resolve, reject) => {
    // --psm 11 (sparse text): tesseract's default page-segmentation mode
    // assumes a normal block of paragraph text, and real logs showed it
    // reliably reading the phone number but consistently failing to find
    // "Accept"/"Reject" even while the call was still actively ringing --
    // short, isolated button labels on a solid color background are exactly
    // the case sparse-text mode is meant for.
    execFile('tesseract', [imgPath, 'stdout', '--psm', '11', 'tsv'], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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

// Prefers the same OCR "block" as the "Incoming" text (Quo's popup usually
// renders as one contiguous block distinct from the rest of the UI), so a
// different number elsewhere on screen — an old call in the sidebar's
// history list, for instance — doesn't get mistaken for the one actually
// ringing. Falls back to words within a tight vertical band of "Incoming"
// (sorted top-to-bottom to preserve reading order) since block segmentation
// isn't guaranteed stable across tesseract page-segmentation modes.
function findIncomingCallPhone(words) {
  const incomingWord = words.find((w) => /incoming/i.test(w.text));
  if (!incomingWord) return null;

  const sameBlock = words.filter((w) => w.blockNum === incomingWord.blockNum);
  let match = sameBlock.map((w) => w.text).join(' ').match(PHONE_PATTERN);
  if (match) return match[0];

  const nearby = words
    .filter((w) => Math.abs(w.top - incomingWord.top) < 150)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  match = nearby.map((w) => w.text).join(' ').match(PHONE_PATTERN);
  return match ? match[0] : null;
}

// Real captures proved text-matching Accept/Reject can never work: white
// bold text on a solid red/green background gets detected as a text region
// by tesseract (right size, right place, real bounding box) but read as
// pure garbage ("'ee", "a") at ~35% confidence -- not a near-miss, nothing
// resembling the real word. Tried clicking based on the position of
// whatever tesseract detected in the band below "is calling you" next, but
// that detected region's extent varied between captures enough to click
// the wrong spot (confirmed live -- the click executed with no error, but
// didn't actually land on the button in Quo). So: use a FIXED offset from
// "is calling you" (read correctly at ~96% confidence in every real capture
// so far) instead, measured directly from a real capture confirmed via
// screenshot to show the popup with Reject/Accept -- not tesseract's
// per-capture guess at where the button row's text extends.
//
// The real OCR data actually showed TWO separate garbled text regions in
// that capture, one per button, with a real gap between them -- not one
// contiguous block. An earlier version treated it as one combined box split
// 25%/75%, which was reasonably close for Reject but notably off for Accept
// (the gap isn't centered, so an even split undershoots the right button).
// This uses each button's own measured region directly instead.
const REJECT_OFFSET = { x: -124, y: 130.5 };
const ACCEPT_OFFSET = { x: 202, y: 117 };

function findButtonRowCenter(words, side) {
  const callingWord = words.find((w) => /calling/i.test(w.text));
  if (!callingWord) return null;

  const offset = side === 'left' ? REJECT_OFFSET : ACCEPT_OFFSET;
  return { x: callingWord.left + offset.x, y: callingWord.top + offset.y };
}

async function clickInQuo(imgLocalPoint, region, scale) {
  const screenX = Math.round(region.x + imgLocalPoint.x / scale.scaleX);
  const screenY = Math.round(region.y + imgLocalPoint.y / scale.scaleY);
  console.log(
    `[action] clicking at screen (${screenX}, ${screenY}) -- window region x=${region.x} y=${region.y} w=${region.w} h=${region.h}, scale ${scale.scaleX.toFixed(2)}x${scale.scaleY.toFixed(2)}, OCR point (${imgLocalPoint.x.toFixed(0)}, ${imgLocalPoint.y.toFixed(0)})`
  );
  await runOsascript([`tell application "System Events" to click at {${screenX}, ${screenY}}`]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A single OCR pass can miss "is calling you" through no fault of the call
// still being up — a mistimed screenshot, a momentary redraw, etc. — so
// retry a couple of times before concluding it's actually gone, rather than
// failing on the first miss.
// A synthetic click via System Events needs Quo to actually be the
// frontmost app to register at all -- confirmed live: clicks were
// executing with no error, computing plausible coordinates, and doing
// nothing in Quo, with a "not allowed" cursor appearing at the moment of
// the click. This mirrors the same activate-before-acting pattern
// endQuoCall already uses successfully for End Call, restoring whatever
// was frontmost before (usually the browser) afterward either way.
let actionInFlight = false;

async function findAndClick(side, notFoundMessage) {
  if (actionInFlight) {
    throw new Error('Another Answer/Decline click is already in progress -- wait for it to finish before trying again.');
  }
  actionInFlight = true;
  try {
    const region = await getQuoWindowRegion();
    const frontApp = await runOsascript([
      'tell application "System Events" to get name of first application process whose frontmost is true'
    ]);
    console.log(`[action] activating "${QUO_APP_NAME}" (was: "${frontApp}")`);
    await runOsascript([`tell application "${QUO_APP_NAME}" to activate`, 'delay 0.35']);
    console.log(`[action] activated -- proceeding to locate and click`);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const scale = await captureRegion(region);
        const words = await ocrWords(CAPTURE_PATH);
        const center = findButtonRowCenter(words, side);
        if (center) {
          await clickInQuo(center, region, scale);
          return;
        }
        if (attempt < 2) await sleep(400);
      }
      throw new Error(notFoundMessage);
    } finally {
      await runOsascript([`tell application "${frontApp}" to activate`]).catch(() => {});
      console.log(`[action] restored focus to "${frontApp}"`);
    }
  } finally {
    actionInFlight = false;
  }
}

// Accept is the right-hand button, Reject the left-hand one, in Quo's
// popup layout -- see findButtonRowCenter for why this clicks by position
// instead of matching "Accept"/"Reject" text.
function answerCall() {
  return findAndClick('right', 'Could not find "is calling you" on screen right now — is a call actually ringing?');
}

function declineCall() {
  return findAndClick('left', 'Could not find "is calling you" on screen right now — is a call actually ringing?');
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

// Logs both outcomes now, not just failure -- with only failure logged
// before, a successful-but-clicked-the-wrong-spot outcome was
// indistinguishable in the log from the request never arriving at all.
function handleAction(res, name, action) {
  console.log(`[action] ${name} requested`);
  action()
    .then(() => {
      console.log(`[action] ${name} succeeded (clicked)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    })
    .catch((err) => {
      console.error(`[action] ${name} failed:`, err.message);
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
    handleAction(res, 'end-call', endQuoCall);
    return;
  }

  if (req.method === 'POST' && req.url === '/answer-call') {
    handleAction(res, 'answer-call', answerCall);
    return;
  }

  if (req.method === 'POST' && req.url === '/decline-call') {
    handleAction(res, 'decline-call', declineCall);
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
