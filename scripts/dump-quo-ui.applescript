-- Diagnostic only — not used by the running helper. Dumps every UI element
-- Quo's window exposes via macOS accessibility, so we can find exactly
-- which element holds the incoming caller's number/name. Run this WHILE a
-- call is actively ringing into Quo:
--
--   osascript scripts/dump-quo-ui.applescript > ~/Desktop/quo-ui-dump.txt
--
-- Then send back the contents of that file (or just the lines that look
-- like a phone number / caller name).

on run
	tell application "System Events"
		if not (exists process "Quo") then
			return "Quo isn't running — open it first, then run this again while a call is ringing."
		end if
		tell process "Quo"
			set frontmost to true
			set output to ""
			set winList to windows
			repeat with w from 1 to count of winList
				set output to output & "=== WINDOW " & w & " ===" & linefeed
				set output to output & my dumpElement(item w of winList, 0)
			end repeat
			return output
		end tell
	end tell
end run

-- Every property/element access below has to happen while System Events is
-- the addressed application — a separate handler like this one does NOT
-- inherit the caller's "tell" context, so without this wrapper every
-- property read here would silently fail.
on dumpElement(elem, depth)
	tell application "System Events"
		set indentStr to ""
		repeat depth times
			set indentStr to indentStr & "  "
		end repeat

		set elemClass to "?"
		try
			set elemClass to (class of elem) as string
		end try

		set elemRole to ""
		try
			set elemRole to (value of attribute "AXRole" of elem) as string
		end try

		set elemTitle to ""
		try
			set elemTitle to (title of elem) as string
		end try

		set elemDesc to ""
		try
			set elemDesc to (description of elem) as string
		end try

		set elemValue to ""
		try
			set elemValue to (value of elem) as string
		end try

		set elemLine to indentStr & elemClass
		if elemRole is not "" then set elemLine to elemLine & " role=" & elemRole
		if elemTitle is not "" then set elemLine to elemLine & " title=\"" & elemTitle & "\""
		if elemDesc is not "" then set elemLine to elemLine & " desc=\"" & elemDesc & "\""
		if elemValue is not "" then set elemLine to elemLine & " value=\"" & elemValue & "\""
		set out to elemLine & linefeed

		-- Depth-limited so this doesn't run away on a deeply nested window —
		-- 8 levels is plenty to reach any visible label in a call-screen UI.
		if depth < 8 then
			try
				set kids to UI elements of elem
				repeat with kid in kids
					set out to out & my dumpElement(kid, depth + 1)
				end repeat
			end try
		end if

		return out
	end tell
end dumpElement
