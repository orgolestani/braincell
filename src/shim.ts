import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type IpcMain } from 'electron';

/**
 * "Auto-wire" shell shim: a `claude()` shell function sourced from the user's
 * rc file, so every interactive `claude` launch runs under the Braincell
 * wrapper and is born WIRED — no new windows, no forks. Non-interactive and
 * utility invocations pass through to the real binary untouched.
 *
 * Layout: ~/.braincell/shim.sh holds the function (rewritten on every
 * install, wrapper path baked in); rc files get one marker-guarded source
 * line. Both idempotent and cleanly removable.
 *
 * Packaging follow-up (not v1): app.getAppPath() points inside the asar in a
 * packaged build — either asarUnpack wrapper/** + node-pty/**, or copy the
 * wrapper into ~/.braincell at install time.
 */
export interface ShimStatus {
  installed: boolean; // shim.sh exists AND at least one rc carries the block
  wrapperCurrent: boolean; // shim.sh points at this app's wrapper
  shimPath: string;
  rcPaths: string[]; // rc files carrying the block
}

const BRAINCELL_DIR = path.join(os.homedir(), '.braincell');
const SHIM_PATH = path.join(BRAINCELL_DIR, 'shim.sh');
const MARKER_START = '# >>> braincell shim >>>';
const MARKER_END = '# <<< braincell shim <<<';
const RC_BLOCK = `${MARKER_START}\n[ -f "$HOME/.braincell/shim.sh" ] && . "$HOME/.braincell/shim.sh"\n${MARKER_END}\n`;

function wrapperPath(): string {
  return path.join(app.getAppPath(), 'wrapper', 'braincell-wrap.cjs');
}

/** zsh is the macOS default and always gets the block; bash only if present. */
function rcCandidates(): { file: string; createIfMissing: boolean }[] {
  return [
    { file: path.join(os.homedir(), '.zshrc'), createIfMissing: true },
    { file: path.join(os.homedir(), '.bashrc'), createIfMissing: false },
  ];
}

function shimScript(): string {
  return `# Braincell shim — interactive \`claude\` runs born WIRED (managed by Braincell,
# reinstall from the app). Escape hatch: BRAINCELL_DISABLE=1 claude
BRAINCELL_WRAPPER="${wrapperPath()}"
claude() {
  if [ -n "$BRAINCELL_DISABLE" ] || [ ! -t 0 ] || [ ! -t 1 ] \\
     || [ ! -f "$BRAINCELL_WRAPPER" ] || ! command -v node >/dev/null 2>&1; then
    command claude "$@"; return $?
  fi
  case "$1" in
    mcp|config|update|doctor|install|migrate-installer|setup-token)
      command claude "$@"; return $? ;;
  esac
  for _bc_arg in "$@"; do
    case "$_bc_arg" in
      -p|--print|--version|-v|-h|--help) command claude "$@"; return $? ;;
    esac
  done
  node "$BRAINCELL_WRAPPER" "$@"
}
`;
}

function readFileOr(file: string, fallback: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return fallback;
  }
}

export function getShimStatus(): ShimStatus {
  const shim = readFileOr(SHIM_PATH, '');
  const rcPaths = rcCandidates()
    .map((c) => c.file)
    .filter((f) => readFileOr(f, '').includes(MARKER_START));
  return {
    installed: shim.length > 0 && rcPaths.length > 0,
    wrapperCurrent: shim.includes(`BRAINCELL_WRAPPER="${wrapperPath()}"`),
    shimPath: SHIM_PATH,
    rcPaths,
  };
}

export function installShim(): ShimStatus {
  fs.mkdirSync(BRAINCELL_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SHIM_PATH, shimScript(), { mode: 0o600 });
  for (const { file, createIfMissing } of rcCandidates()) {
    const exists = fs.existsSync(file);
    if (!exists && !createIfMissing) continue;
    const current = exists ? fs.readFileSync(file, 'utf-8') : '';
    if (current.includes(MARKER_START)) continue; // already sourced
    const glue = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${glue}\n${RC_BLOCK}`);
  }
  return getShimStatus();
}

export function uninstallShim(): ShimStatus {
  for (const { file } of rcCandidates()) {
    const current = readFileOr(file, '');
    if (!current.includes(MARKER_START)) continue;
    const stripped = current.replace(
      new RegExp(`\\n?${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, 'g'),
      '\n',
    );
    fs.writeFileSync(file, stripped);
  }
  try {
    fs.unlinkSync(SHIM_PATH);
  } catch {
    /* already gone */
  }
  return getShimStatus();
}

export function registerShim(ipcMain: IpcMain): void {
  ipcMain.handle('shim:status', () => getShimStatus());
  ipcMain.handle('shim:install', () => installShim());
  ipcMain.handle('shim:uninstall', () => uninstallShim());
}
