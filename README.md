# FEX CRM — Lead to Lifetime Value

A single-agent CRM for final-expense (and similar) insurance sales: one
permanent customer ID carries the lead all the way from first dial through
notes, quotes, appointments, applications, policy, commission, and lifetime
value. Built with Next.js (App Router) + TypeScript + SQLite, so it runs
entirely on your own machine with no external services required.

## Quick start

```bash
npm install
npm run seed     # creates data/crm.sqlite3 with realistic demo data
npm run dev      # http://localhost:3000
```

For a production-style run: `npm run build && npm start`.

Re-running `npm run seed` at any time wipes the database and rebuilds it
with fresh demo data — useful when you want to start clean. Your real data
lives in `data/crm.sqlite3`; back that file up like you would any other
database.

## Going live (Railway)

This app is a normal Node/Next.js server plus a SQLite file, so it needs a
host that keeps a real process running with a persistent disk — not a
serverless platform like plain Vercel (see the note at the bottom if you
want that route instead). [Railway](https://railway.app) is the easiest fit
and has a free trial.

1. **Get the code onto Railway.** Easiest path with no GitHub needed:
   ```bash
   npm install -g @railway/cli
   railway login          # opens a browser to sign in / sign up
   cd crm-insurance
   railway init            # creates a new Railway project
   railway up               # uploads this folder and deploys it
   ```
   (Prefer GitHub? Push this folder to a new repo, then in the Railway
   dashboard choose **New Project → Deploy from GitHub repo** instead of
   `railway init`/`railway up`.)

2. **Add a persistent volume**, so the database survives redeploys — in
   the Railway dashboard: your service → **Volumes → New Volume**, mount
   path `/data`. Then add a variable **DATA_DIR = /data** (service →
   **Variables**).

3. **Set a login.** This CRM has no other auth, and it stores real
   names/phone/DOB and (masked-by-default) SSN/bank info — add these two
   variables before sharing the URL with anyone:
   - `BASIC_AUTH_USER` — pick a username
   - `BASIC_AUTH_PASSWORD` — pick a strong password
   Every page will then prompt for these before loading anything.

4. **Seed or don't.** By default the volume starts empty (no `data/`
   folder exists yet). If you want the demo data to poke around with
   first, run `railway run npm run seed` once — otherwise skip it and the
   CRM just starts with zero leads, ready for your real ones.
   ⚠️ `npm run seed` **wipes and rebuilds the database** — never run it
   again once you have real leads in there.

5. **Get your URL.** Service → **Settings → Networking → Generate
   Domain** gives you a `*.up.railway.app` URL immediately; you can attach
   your own domain from the same screen.

From then on, `railway up` (or just pushing to GitHub, if you went that
route) redeploys your changes — the volume-backed database is untouched
across deploys.

**Prefer Vercel or another serverless host instead?** That's a bigger
change: serverless functions don't keep a writable disk between requests,
so `better-sqlite3` won't work as-is. You'd swap the database layer in
`lib/db.ts` for a hosted Postgres (Neon, Supabase, or Vercel Postgres all
have a free tier) and rewrite the queries in `lib/*.ts` and the API routes
to use it instead of `better-sqlite3`. Worth doing if you specifically want
Vercel's platform — just a larger lift than the Railway/Fly.io path above.

## What's in here

- **Dashboard (`/`)** — money (today/week/month/pending/chargebacks/net),
  activity, conversion rates, and lead economics, with a period switcher.
- **Power Dial (`/dial`)** — queues fresh → working → 45-90 day → 90+ day
  leads (youngest first within each tier) and drops you straight into the
  first one's workspace, with a "skip / next" control to move through the
  queue. Once you tap Call on a lead, you can't skip to the next one until
  you log that call's outcome.
- **Leads (`/leads`)** — searchable/filterable list, quick "+ Add Lead".
- **Lead Workspace (`/leads/[id]`)** — the core screen: lead info, live
  local time for the lead's state vs. your Mountain time, call-attempt
  buttons that log to a permanent call history, the exact structured Notes
  template (every save is a new version — nothing is ever overwritten), a
  bank routing-number lookup with manual override, a health-keyword based
  Suggested Carrier Order with one-click Agent Login links, and Quote /
  Appointment / Sold / Dispute / Archive actions. Once sold, the same
  record becomes the policy/commission workspace — nothing is duplicated
  into a second "client" record.
- **Policies (`/policies`)** and **Commissions (`/commissions`)** — flat,
  sortable views across every sale.
- **Analytics (`/analytics`)** — sales funnel with stage conversion %,
  cost-per-stage, ROI by lead vendor / lead age / state / ad+platform+vendor
  combination, and top client lifetime value.
- **⚡ Quick Access** (top-right, every page) — FEX quoter link, carrier
  agent-login list with eApp/claims/phone shortcuts, and resource links.
- **Manage Quick Links (`/quick-links`)** — edit carriers & their logins,
  the health-keyword underwriting rules that drive carrier suggestions, and
  the quoter/resource links — all from the browser, no code changes.

## The data model

One rule drives the whole schema: **a customer is a single permanent row.**
Everything else references `customers.id` — it's never copied into a second
"client" or "sale" record when a lead converts:

```
customers
 ├── note_versions   (append-only — full history, nothing overwritten)
 ├── calls           (every dial, with attempt #, outcome, disposition)
 ├── quotes
 ├── appointments
 ├── applications
 ├── policies
 ├── commissions
 ├── payments        (renewals feed lifetime value)
 ├── referrals
 └── audit_history    (the full timeline shown on each lead)
```

Reference tables: `lead_vendors`, `carriers`, `carrier_underwriting_rules`,
`quick_links`, `routing_lookup`.

The SQLite file lives at `data/crm.sqlite3`. Schema lives in
`lib/schema.sql` and is applied automatically on first run.

## Bank routing-number lookup

`routing_lookup` ships with a small sample set of major banks/credit unions
(their routing numbers as the institutions themselves publish them) —
intentionally **not** a copy of the Federal Reserve's full directory, which
restricts commercial redistribution. The lookup always shows candidates to
pick from (not an auto-fill), and the routing field stays manually editable
no matter what — the client's own check or online banking is the
definitive source. Add more entries any time via
`INSERT INTO routing_lookup ...` or a small admin screen if you want one
built out further.

## Carrier health-suggestion engine

`carrier_underwriting_rules` holds comma-separated keywords per carrier
(e.g. `diabetes, insulin, a1c`) plus a tier note and an optional
"knockout" flag. When you type in a lead's HEALTH note field, the workspace
matches your text against those keywords and ranks carriers #1/#2/#3, each
with a one-click **Agent Login →** link. This is a keyword heuristic to
help you decide who to run first — not real underwriting — so it always
carries a reminder to verify against the carrier's actual field guide.
Manage the rules (and your real carrier list) from **⚡ Quick Access →
Manage Quick Links → Underwriting Rules**.

## Ending Quo calls from the CRM (macOS only)

The Lead Workspace has a **☎️ End Quo Call** button that hangs up the active
call in [Quo](https://www.getquo.com) without you having to switch windows —
useful when you've got several tabs/sites open and Quo isn't the focused app.

The CRM runs in your browser and Quo is a separate desktop app, so the button
can't click Quo's UI directly (browsers can't reach outside the tab). Instead
it talks to a tiny local helper that runs alongside the CRM on your Mac.

### Setup (run once, on the Mac that runs Quo)

```bash
bash scripts/install-quo-helper.sh
```

This installs Node if you don't have it, opens the macOS Accessibility
settings pane for you, and starts the helper. The **one thing no script can
do for you** is click the toggle in that Accessibility pane — macOS
deliberately blocks any program from granting itself that permission, so
that's a one-time manual click on your end. The installer tells you exactly
which entry to enable.

Want it to start automatically every time you log in, instead of running the
script by hand each day?
```bash
bash scripts/install-quo-helper.sh --autostart
```
This registers a `launchd` agent that starts the helper at login and
restarts it if it ever crashes (logs at `data/quo-helper.log`). To remove it
later: `launchctl unload ~/Library/LaunchAgents/com.crm.quo-helper.plist &&
rm ~/Library/LaunchAgents/com.crm.quo-helper.plist`.

Either way, it listens on `http://127.0.0.1:8787` and does three things per
click of **☎️ End Quo Call**: switches focus to Quo, sends Quo's own end-call
shortcut (`Cmd+Shift+H` by default), then switches focus back to whatever you
were using. If the helper isn't running, the button tells you so instead of
failing silently.

If your Quo hangup shortcut isn't `Cmd+Shift+H`, or Quo's app name differs,
override with environment variables before starting the helper:
```bash
QUO_APP_NAME="Quo" QUO_HANGUP_KEY="h" npm run quo-helper
```

This is deliberately narrow: the helper only performs that one hardcoded
action (send the hangup shortcut) and only listens on `127.0.0.1`, so it's
not reachable from outside your machine. See the comments in
`scripts/quo-helper-server.js` for the full detail, including why it has no
auth token (the only thing it can do is hang up a call).

## Incoming call popup (macOS only)

When a call rings in on Quo from a number that matches an existing lead, the
CRM pops up that lead's name — as a real OS-level notification you'll see
even if the CRM tab isn't in front — with **Answer**/**Decline** buttons that
control the actual call in Quo, plus a click-through to their Lead
Workspace. Unmatched numbers are silently ignored.

Quo doesn't expose a "call is ringing" event to outside tools (its Zapier
integration only fires *after* a call completes, too late for a live popup),
so this works by having the same local helper from "Ending Quo calls" watch
Quo's window directly: it periodically screenshots Quo (without stealing
focus — Quo doesn't need to be the frontmost app) and reads the "Incoming
call" popup via OCR, since Quo's call screen is a web view that hides its
real content from accessibility tools. Answer/Decline work the same way in
reverse — the helper finds "Accept"/"Reject" on screen and clicks it.

**Known limitation:** since this reads actual screen pixels, Quo's window
needs to be visible somewhere on screen (not minimized, not fully hidden
behind another window) for detection to work.

### Setup

1. **Install OCR support and a click tool** (one-time, on the Mac running Quo):
   ```bash
   brew install tesseract cliclick
   ```
   (`cliclick` performs the actual Answer/Decline click — it's a real low-level click, unlike AppleScript's `click at`, which turned out not to work on Quo's web-based UI.)
2. **Generate a shared secret token:**
   ```bash
   openssl rand -hex 24
   ```
3. **Add it to your deployment:** `QUO_WEBHOOK_TOKEN=<that value>` (Railway: your service → **Variables**).
4. **Start (or restart) the helper with those two values set** — same token as step 3, plus your CRM's URL:
   - Running it manually: `CRM_BASE_URL="https://<your-crm-domain>" QUO_WEBHOOK_TOKEN="<same token as step 3>" npm run quo-helper`
   - Using the `--autostart` launchd version: `launchd` agents don't read `~/.zshrc`/shell profiles, so put the values directly on the installer command instead of trying to export them separately:
     ```bash
     CRM_BASE_URL="https://<your-crm-domain>" QUO_WEBHOOK_TOKEN="<same token as step 3>" bash scripts/install-quo-helper.sh --autostart
     ```
     This bakes them straight into the launchd agent. Re-run it any time you need to change either value.
5. The first time it detects a call, your browser will ask permission for notifications — allow it.

From then on, any matching call pops a notification within a couple of
seconds of ringing — click it (or the popup's Answer/Decline buttons, or its
"Open lead →" link) to act on it.

## Protected fields & login

SSN, bank name/state, routing number, and account number live in
`note_versions` but are hidden behind a "Show bank / SSN fields" toggle in
the workspace, masked (`•••-••-1234`) everywhere else they might surface,
and excluded from the leads list/search.

The app itself has one shared login (not per-agent accounts): set
`BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` as environment variables (see
`.env.example`) and `middleware.ts` will prompt for them on every page. This
is **off by default** for local dev — set both before putting a live URL
anywhere someone else could find it. See "Going live" above.

## Project layout

```
app/                 Next.js App Router pages + API routes
components/          Client components (workspace, modals, nav, settings)
lib/                 db access, schema.sql, metrics, underwriting engine, utils
scripts/seed.js      Wipes + repopulates data/crm.sqlite3 with demo data
data/                SQLite database lives here (gitignored)
```

## Notes on scope

This is a working, single-user CRM you can run today and keep extending —
not a hosted multi-tenant product. There's no login/auth, no SMS/dialer
integration (the Call button opens your phone's own dialer via `tel:`), and
renewal/referral payments are entered manually rather than pulled from a
carrier feed. All of those are natural next steps once the core workflow
feels right.
