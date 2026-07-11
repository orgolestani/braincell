import { app, BrowserWindow, ipcMain, clipboard, screen } from 'electron';
import path from 'node:path';
import http from 'node:http';
import started from 'electron-squirrel-startup';
import { getSessions } from './sessions';
import { registerTerminal } from './terminalLauncher';
import { registerWired } from './wired';
import { registerShim } from './shim';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Dev-only: expose CDP so DevTools tooling (e.g. Chrome DevTools MCP) can
// attach to the live app — screenshots, DOM, input, console — over loopback.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9223');
}

ipcMain.handle('sessions:get', () => getSessions());
// Global cursor position for the mascot's gaze — the case is a drag region
// (no DOM mouse events), and the mascot should watch the cursor even when
// it roams outside the window.
ipcMain.handle('cursor:get', () => screen.getCursorScreenPoint());
ipcMain.handle('clipboard:copy', (_e, text: string) => {
  clipboard.writeText(String(text));
  return { ok: true };
});
// Watch ↔ fob view toggle. The window is resizable:false (fixed forms, no
// user resizing), so flip resizable around the programmatic change.
ipcMain.handle('window:setContentSize', (event, size: { width: number; height: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.setResizable(true);
  win.setContentSize(Math.round(size.width), Math.round(size.height));
  win.setResizable(false);
});
registerTerminal(ipcMain);
registerWired(ipcMain);
registerShim(ipcMain);

const createWindow = () => {
  // A small round pocket watch floating on the desktop: frameless and
  // transparent so only the circular case shows. hasShadow off — the OS
  // shadow is rectangular and betrays the window bounds.
  const mainWindow = new BrowserWindow({
    width: 280,
    height: 392, // 336 watch + 56px headroom so the danger steam isn't cropped
    useContentSize: true,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

};

/**
 * Dev-only visual-check server: lets tooling verify the UI without macOS
 * screen-recording permission — the app photographs itself via capturePage.
 * Loopback only; never runs in packaged builds (no vite dev server there).
 *   GET /capture      → PNG of the live window
 *   GET /key?k=w      → inject a keypress (the dev state keys: w/d/t/Escape)
 *   GET /click?x=&y=  → inject a left click at CSS-px window coordinates
 *   GET /move?x=&y=   → inject a mouse move (hover states)
 */
function startDevCheckServer(): void {
  http
    .createServer((req, res) => {
      const win = BrowserWindow.getAllWindows()[0];
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!win) {
        res.writeHead(503);
        res.end('no window');
        return;
      }
      if (url.pathname === '/capture') {
        void win.webContents.capturePage().then((image) => {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(image.toPNG());
        });
      } else if (url.pathname === '/key') {
        const k = url.searchParams.get('k') ?? '';
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
        res.writeHead(200);
        res.end('ok');
      } else if (url.pathname === '/click' || url.pathname === '/move') {
        const x = Number(url.searchParams.get('x'));
        const y = Number(url.searchParams.get('y'));
        if (url.pathname === '/click') {
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        } else {
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        }
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(43117, '127.0.0.1');
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) startDevCheckServer();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
