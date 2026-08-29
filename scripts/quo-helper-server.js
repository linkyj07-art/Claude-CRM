#!/usr/bin/env node
// Local helper that lets the CRM (running in your browser) end the active
// call in Quo, even when Quo isn't the focused app. It works by briefly
// switching focus to Quo, sending Quo's own end-call hotkey via AppleScript,
// then switching focus back to whatever app you were using.
//
// macOS only. Start it with `npm run quo-helper` and leave it running in a
// terminal tab while you're making calls. The CRM's "End Quo Call" button
// POSTs to it at http://127.0.0.1:8787/end-call.
//
// One-time setup: System Settings -> Privacy & Security -> Accessibility ->
// enable whatever app runs this script (usually Terminal, iTerm, or your
// code editor's integrated terminal) so it's allowed to control the Mac via
// System Events.
//
// Note: this server has no authentication — anything running on your Mac
// (or, in principle, a malicious page in your browser that discovers the
// port) can hit /end-call. All it can do is send Quo's hangup shortcut, so
// the worst case is an unwanted hangup, not data exposure. Don't expose
// this port beyond 127.0.0.1.

const http = require('http');
const { execFile } = require('child_process');

const PORT = process.env.QUO_HELPER_PORT ? Number(process.env.QUO_HELPER_PORT) : 8787;
const QUO_APP_NAME = process.env.QUO_APP_NAME || 'Quo';
const QUO_HANGUP_KEY = process.env.QUO_HANGUP_KEY || 'h'; // Cmd+Shift+H by default

if (process.platform !== 'darwin') {
  console.error('quo-helper only works on macOS (it relies on AppleScript/System Events).');
  process.exit(1);
}

function endQuoCall() {
  return new Promise((resolve, reject) => {
    const args = [
      '-e', 'tell application "System Events" to set frontApp to name of first application process whose frontmost is true',
      '-e', `tell application "${QUO_APP_NAME}" to activate`,
      '-e', 'delay 0.35',
      '-e', `tell application "System Events" to keystroke "${QUO_HANGUP_KEY}" using {command down, shift down}`,
      '-e', 'delay 0.15',
      '-e', 'tell application frontApp to activate'
    ];
    execFile('osascript', args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
      } else {
        resolve();
      }
    });
  });
}

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome's Private Network Access preflight, since the CRM tab (a public
  // https:// origin) is calling into a loopback address.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
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
    endQuoCall()
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((err) => {
        console.error('Failed to end Quo call:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Quo end-call helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Will activate "${QUO_APP_NAME}" and send Cmd+Shift+${QUO_HANGUP_KEY.toUpperCase()} to end a call.`);
  console.log('Leave this running while you make calls. Ctrl+C to stop.');
});
