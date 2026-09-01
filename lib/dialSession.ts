// Shared shape for dial_sessions rows, used by both /api/dial-session (the
// queue itself) and /api/dial-session/auto-dial (the Auto-Dial toggle/pace/
// stats) so the two routes can't drift out of sync on what a "session"
// looks like to the client.
export type DialSessionRow = {
  current_lead_id: string | null;
  queue: string;
  recycle: string;
  pass: number;
  auto_dial: number;
  auto_dial_pace_ms: number;
  session_dials: number;
  session_connects: number;
  consecutive_no_answer: number;
  categories: string;
  updated_at: string;
};

export function serializeDialSession(row: DialSessionRow | undefined) {
  if (!row) return null;
  return {
    currentLeadId: row.current_lead_id,
    queue: row.queue ? row.queue.split(',').filter(Boolean) : [],
    recycle: row.recycle ? row.recycle.split(',').filter(Boolean) : [],
    pass: row.pass,
    autoDial: !!row.auto_dial,
    autoDialPaceMs: row.auto_dial_pace_ms,
    sessionDials: row.session_dials,
    sessionConnects: row.session_connects,
    consecutiveNoAnswer: row.consecutive_no_answer,
    updatedAt: row.updated_at
  };
}
