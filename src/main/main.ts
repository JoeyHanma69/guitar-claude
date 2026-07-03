import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tiny JSON store (settings / high scores) with corruption recovery.
// Writes go to a temp file first, then rename — a crash mid-write can never
// leave a half-written store behind.
// ---------------------------------------------------------------------------

function storePath(name: string): string {
  return path.join(app.getPath('userData'), `${name}.json`);
}

function readStore(name: string): unknown {
  const file = storePath(name);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    // Corrupted save: keep a copy for inspection, start fresh.
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}.bak`);
    } catch {
      /* nothing else we can do */
    }
    console.error(`[store] failed to read ${name}, resetting`, err);
    return null;
  }
}

function writeStore(name: string, data: unknown): void {
  const file = storePath(name);
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`[store] failed to write ${name}`, err);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    title: 'Guitar Claude',
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#07070f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload scripts require the sandbox to be off.
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Any external link opens in the system browser, never inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
  });
}

// macOS needs an application menu for Cmd+C/V/Q to work; everywhere else the
// menu bar is hidden anyway.
function buildMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('settings:get', () => readStore('settings'));
ipcMain.handle('settings:set', (_event, settings: unknown) => writeStore('settings', settings));
ipcMain.handle('scores:get', () => readStore('highscores'));
ipcMain.handle('scores:set', (_event, scores: unknown) => writeStore('highscores', scores));
ipcMain.handle('window:fullscreen', (_event, flag: boolean) => {
  win?.setFullScreen(Boolean(flag));
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
