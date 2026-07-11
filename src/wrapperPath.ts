import path from 'node:path';
import { app } from 'electron';

/**
 * Absolute path to the wired wrapper (wrapper/braincell-wrap.cjs).
 *
 * Dev: lives in the project root. Packaged: ships OUTSIDE the asar via forge
 * `extraResource` — the wrapper runs under the user's system `node` (not
 * Electron), and nothing inside an asar is spawnable that way. node-pty ships
 * beside it in Resources/ for the same reason.
 */
export function wrapperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wrapper', 'braincell-wrap.cjs')
    : path.join(app.getAppPath(), 'wrapper', 'braincell-wrap.cjs');
}
