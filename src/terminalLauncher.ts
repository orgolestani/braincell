import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IpcMain } from 'electron';
import { wrapperPath } from './wrapperPath';

/**
 * Launches a *wired* Claude session in the user's real terminal (iTerm if
 * installed, else Terminal.app). AppleScript is used ONLY to open a window and
 * run a command — never to type into the session. The command runs the
 * Braincells wrapper (wrapper/braincell-wrap.cjs), which owns Claude's PTY and
 * exposes a control socket (see wired.ts). No terminal focus/keyboard control.
 */
const run = promisify(execFile);
const USE_ITERM = fs.existsSync('/Applications/iTerm.app');

async function osa(script: string): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script]);
  return stdout.trim();
}
const asStr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Build the shell line: cd into cwd, export the wired key, run the wrapper. */
function wrapperCommand(cwd: string, key: string, claudeArgs: string[]): string {
  const args = claudeArgs.map(shq).join(' ');
  return `cd ${shq(cwd)}; BC_KEY=${shq(key)} node ${shq(wrapperPath())} ${args}`.trim();
}

async function openTerminal(cmd: string): Promise<void> {
  if (USE_ITERM) {
    await osa(
      `tell application "iTerm"
        activate
        set w to (create window with default profile)
        tell current session of w to write text ${asStr(cmd)}
      end tell`,
    );
  } else {
    await osa(
      `tell application "Terminal"
        activate
        do script ${asStr(cmd)}
      end tell`,
    );
  }
}

/** Launch a fresh wired session; returns the key Braincells tracks it by. */
async function launch(cwd: string): Promise<{ launched: boolean; key: string }> {
  const key = crypto.randomUUID();
  await openTerminal(wrapperCommand(cwd, key, []));
  return { launched: true, key };
}

/**
 * Add controls to a watched session by forking it into a new wired session.
 * The old terminal is left untouched (no two writers on one session file).
 */
async function reconnect(
  sessionId: string | null,
  cwd: string,
): Promise<{ launched: boolean; key: string }> {
  const key = crypto.randomUUID();
  const args = sessionId
    ? ['--resume', sessionId, '--fork-session']
    : ['--continue', '--fork-session'];
  await openTerminal(wrapperCommand(cwd, key, args));
  return { launched: true, key };
}

export function registerTerminal(ipcMain: IpcMain): void {
  ipcMain.handle('terminal:launch', (_e, opts: { cwd?: string }) => launch(opts?.cwd || os.homedir()));
  ipcMain.handle('terminal:reconnect', (_e, opts: { sessionId: string | null; cwd: string }) =>
    reconnect(opts.sessionId, opts.cwd || os.homedir()),
  );
}
