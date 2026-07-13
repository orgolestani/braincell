# CLAUDE.md

## Project: Braincells / Context Meter

Braincells is a small macOS desktop companion for Claude Code. It monitors the current Claude Code session and shows a playful but useful “Context Meter” with session state, context pressure, model, token usage, and quick controls.

The product should feel like a small physical desktop device, not a SaaS dashboard.

## Product direction

Core idea:

- User runs Claude Code normally.
- Braincells opens as a small always-on-top companion.
- It automatically detects the active/latest Claude Code session.
- It shows whether the session is healthy, bloated, stale, or “cooked.”
- It should be useful first, funny second.

Tone:

- Useful developer tool.
- Slightly cursed / playful.
- Avoid overdoing joke labels.
- Main gauge should be called **Context Meter**.
- App/mascot personality can be funny, but core controls should be clear.

## Visual direction

The UI should feel like one cohesive physical object:

- Vintage cartoon machine / 1930s rubber-hose inspired.
- Brass, cream, ink, paper, glass, bulbs, levers.
- No modern dashboard cards unless intentionally restyled as machine parts.
- Everything important should live inside the device/panel.
- Avoid large black gutters around the device.
- Prefer compact utility size over giant showcase panel.

Design rule:

> If an element looks like it came from a React admin dashboard, restyle it as a physical control/readout or hide it in a drawer.

## Asset strategy

Use the right asset format for each job:

- Decorative textured shell/panel assets: PNG/WebP.
- Dynamic mechanical parts: SVG/CSS.
- Live text/data: HTML/CSS.
- Mascot: WebM loops for now, possible Rive state machine later.

Do not convert detailed textured AI images into giant vector SVGs unless absolutely needed. Vectorized grime creates huge noisy path soup and shifts colors.

## Mascot

Mascot currently can be a whole brain, but conceptually the product should stay focused on context/session health.

Preferred mascot behavior:

- One mascot slot inside the porthole.
- State-based mood: Genius / Smart / Cooking / Sweating / Fried.
- For now WebM loops are acceptable.
- Later Rive can replace the mascot only.
- Do not rebuild the whole UI around Rive.

The mascot should be charming but not distract from the Context Meter.

## Session connection model

Braincells has three connection modes:

### WATCHING

Default mode.

- Braincells detects Claude Code sessions by reading local JSONL transcripts.
- Look under `$CLAUDE_CONFIG_DIR/projects` if set, otherwise `~/.claude/projects`.
- Auto-select the latest/active session by default.
- User can pin/select another session.
- This mode is read-only.
- Compact/Clear controls do NOT copy to clipboard (mechanism dropped
  2026-07-05). Pulling a control on an unwired session actively connects:
  it starts a controlled fork (RECONNECTING) and sends the command over the
  socket once the fork's wrapper registers.
- Do not pretend to execute live commands in WATCHING mode.

Session detection rules (do not regress):

- Any transcript under `projects/<cwd-slug>/*.jsonl` that carries a `cwd` is a
  real Claude Code session — watch it regardless of `entrypoint`.
- `entrypoint` does NOT gate watchability. Claude Code runs under several
  harnesses: `cli` (terminal), `claude-desktop` (desktop/web app), IDE
  extensions. All write the same transcript format with a real `cwd`/`gitBranch`.
  Do NOT skip `entrypoint === "claude-desktop"` — that hides the user's actual
  active session and makes the app fall back to stale/empty cli files.
- `entrypoint` only affects controllability, not visibility: WIRED requires a
  CLI PTY, so non-cli sessions get WATCHING (+ Reconnect fork), never live control.
- Auto-select must prefer a genuinely active/real session (recent mtime, has a
  model/usage) over stale or empty aborted transcripts. Never make an idle
  0-token junk session the followed hero just because its file was touched last.
- Context % denominator is the model's real window. Inferring the limit from
  token count alone (`tokens > 200k ? 1M : 200k`) over-inflates % for
  large-window models under 200k tokens — prefer a model→window map.

### WIRED

Controlled mode.

- Claude was launched through a Braincells wrapper.
- Wrapper runs inside the user’s real terminal.
- Braincells does not embed a terminal.
- Wrapper owns Claude’s PTY and exposes a local control socket.
- Braincells sends whitelisted slash commands to the socket.
- Wrapper writes those commands to Claude stdin.
- Compact/Clear execute live only in WIRED mode.

### RECONNECTING

Transient mode.

- User is watching an unmanaged session and clicks “Reconnect with controls.”
- Braincells launches a new wired Claude process in the user’s preferred terminal.
- It resumes/forks the selected session.
- Use deterministic IDs:
  - old watched session id = `oldId`
  - Braincells generates `newId`
  - launch Claude with `--resume oldId --fork-session --session-id newId`
- Do not use global newest-mtime guessing.
- Do not kill the old terminal.
- Once the socket for `newId` is alive, mode becomes WIRED.

## Safety rules

Do not use terminal keyboard injection for controls.

Avoid:

- focusing Terminal/iTerm
- AppleScript `write text`
- simulated keystrokes
- typing into the active app

AppleScript may be used only to open a terminal window and run the wrapper command.

Control must happen through the wrapper/socket path.

Socket rules:

- Store sockets/registry under `~/.braincell/wired`.
- Use safe permissions.
- Whitelist commands: `/compact`, `/clear`, `/model`.
- No arbitrary shell command execution.
- Clean up stale registry entries when PID/socket is dead.

## Controls

Keep v1 controls simple:

- Compact → `/compact`
- Clear → `/clear`
- Reconnect with controls → fork/resume into WIRED mode

Do not implement Stabilize for now. It was considered but intentionally dropped.

## UI behavior

Show clear link status:

- WATCHING = detected and monitoring only
- RECONNECTING = opening a controlled fork
- WIRED = live controls available

Control behavior:

- WATCHING:
  - Compact/Clear fork the session into a wired terminal and queue the
    command; it fires once the fork's wrapper is up
  - toasts narrate each step (“Not wired — opening a controlled fork…”,
    “Sent /compact to the forked session”)
- WIRED:
  - Compact sends `/compact`
  - Clear sends `/clear` after confirmation (arm → confirm in both modes)

If multiple sessions exist:

- Default to “Follow latest.”
- Manual selection pins a session.
- Reconnect applies to the selected/pinned session, not blindly latest.

## Implementation preferences

Prefer:

- TypeScript
- plain CSS / CSS variables
- SVG for dynamic simple pieces
- WebM for mascot loops
- small focused modules
- honest mode separation

Avoid:

- heavy component libraries
- generic SaaS UI
- terminal automation for control
- mixing decorative raster assets into massive SVGs
- overbuilding before core mechanics work

## Development philosophy

Keep tasks small.

Before large refactors:

1. Preserve existing session parsing.
2. Preserve current UI behavior unless explicitly changing it.
3. Make one focused change.
4. Verify with typecheck/lint.
5. Prefer safe fallback over clever guessing.

The goal is not “make Claude smarter.”

The goal is:

> Make Claude Code’s context/session health visible, ambient, and easier to manage.