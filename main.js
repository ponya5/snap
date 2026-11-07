const { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen, ipcMain, clipboard, nativeImage, dialog, session, shell, systemPreferences, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULTS = { hotkey: 'CommandOrControl+Shift+S', folder: '', askWhere: true, format: 'png', countdown: 5, sys: true, mic: false, mode: 'shot' };
const cfgFile = path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch (e) {}
let tray, settingsWin, overlay, overlayDisplay, recorder, control, home, pending;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const webPrefs = { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false };

async function sourceFor(display) {
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  try {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = srcs.find(s => s.display_id === String(display.id)) || srcs[0];
    if (src && !src.thumbnail.isEmpty()) return src;
  } catch (e) { /* permission denied */ }
  const { response } = await dialog.showMessageBox({
    type: 'warning', message: 'Snap needs Screen Recording permission',
    detail: 'Enable Snap in System Settings > Privacy & Security > Screen Recording, then quit and reopen Snap.',
    buttons: ['Open Settings', 'Cancel'],
  });
  if (response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  return null;
}

async function capture() {
  if (recorder) return stopRecording();
  if (overlay) return;
  if (home?.isVisible()) { home.hide(); await new Promise(r => setTimeout(r, 250)); }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const src = await sourceFor(d);
  if (!src) return;
  const mac = process.platform === 'darwin';
  overlayDisplay = d;
  overlay = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
    fullscreen: !mac, alwaysOnTop: true, webPreferences: webPrefs,
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (mac) overlay.setSimpleFullScreen(true);
  overlay.loadFile('overlay.html');
  overlay.webContents.once('did-finish-load', () => overlay.webContents.send('shot', { url: src.thumbnail.toDataURL(), sys: settings.sys, mic: settings.mic, mode: settings.mode }));
  overlay.on('closed', () => { overlay = null; });
}

ipcMain.on('copy', (_e, url) => { clipboard.writeImage(nativeImage.createFromDataURL(url)); overlay?.close(); });
ipcMain.on('close', () => overlay?.close());
async function saveTo(kind, name, filters, data) {
  const dir = settings.folder || app.getPath(kind);
  let file = path.join(dir, name);
  if (settings.askWhere) {
    const r = await dialog.showSaveDialog({ defaultPath: file, filters });
    if (r.canceled) return false;
    file = r.filePath;
  } else {
    fs.mkdirSync(dir, { recursive: true });
    new Notification({ title: 'Snap', body: 'Saved to ' + file }).show();
  }
  fs.writeFileSync(file, data(file));
  return true;
}

ipcMain.on('save', async (_e, url) => {
  overlay.hide();
  const img = nativeImage.createFromDataURL(url);
  const ok = await saveTo('pictures', `screenshot-${stamp()}.${settings.format}`, [{ name: 'Image', extensions: ['png', 'jpg'] }],
    file => (/\.jpe?g$/i.test(file) ? img.toJPEG(92) : img.toPNG()));
  if (ok) overlay.close(); else overlay.show();
});

// Video: overlay sends region + audio options, then we record the display and crop in the recorder window.
ipcMain.on('rec', async (_e, o) => {
  const d = overlayDisplay;
  overlay.close();
  if (o.mic && process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone');
  const src = await sourceFor(d);
  if (!src) return;
  const r = o.region, cb = d.bounds;
  const cd = settings.countdown > 0 && new BrowserWindow({
    x: Math.round(cb.x + r.x + r.w / 2 - 100), y: Math.round(cb.y + r.y + r.h / 2 - 100), width: 200, height: 200,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
  });
  cd?.setAlwaysOnTop(true, 'screen-saver');
  cd?.loadFile('countdown.html', { query: { n: String(settings.countdown) } });
  await new Promise(r => setTimeout(r, settings.countdown * 1000));
  cd?.destroy();
  pending = { video: src, audio: o.sys ? 'loopback' : undefined };
  recorder = new BrowserWindow({ show: false, webPreferences: webPrefs });
  recorder.loadFile('recorder.html');
  recorder.webContents.once('did-finish-load', () => recorder.webContents.send('start', { ...o, id: src.id }));

  // Stop bar, placed outside the region and hidden from capture.
  const b = d.bounds, h = 44, w = 220;
  const above = o.region.y > h + 10;
  control = new BrowserWindow({
    x: b.x + Math.round(b.width / 2 - w / 2), y: b.y + (above ? 8 : b.height - h - 8), width: w, height: h,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, webPreferences: webPrefs,
  });
  control.setContentProtection(true);
  control.setAlwaysOnTop(true, 'screen-saver');
  control.loadFile('control.html');
  menu();
});

function stopRecording() { recorder?.webContents.send('stop'); }

ipcMain.on('video', async (_e, buf, ext) => {
  recorder.destroy(); recorder = null;
  control?.destroy(); control = null;
  menu();
  await saveTo('videos', `recording-${stamp()}.${ext}`, [{ name: ext.toUpperCase() + ' video', extensions: [ext] }], () => Buffer.from(buf));
});

ipcMain.on('cmd', (_e, c) => {
  if (c === 'stop') return stopRecording();
  capture();
});

function registerHotkey(key) {
  globalShortcut.unregisterAll();
  try { if (globalShortcut.register(key, capture)) return true; } catch (e) {}
  globalShortcut.register(settings.hotkey, capture); // restore previous
  return false;
}

ipcMain.on('mode', (_e, m) => { settings.mode = m; fs.writeFileSync(cfgFile, JSON.stringify(settings, null, 2)); });
ipcMain.handle('s:get', () => settings);
ipcMain.handle('s:pick', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('s:set', (_e, n) => {
  if (n.hotkey !== settings.hotkey && !registerHotkey(n.hotkey)) return { error: 'That shortcut is not available. Try another.' };
  settings = { ...settings, ...n };
  fs.writeFileSync(cfgFile, JSON.stringify(settings, null, 2));
  menu();
  return { ok: true };
});

function showSettings() {
  if (settingsWin) return settingsWin.show();
  settingsWin = new BrowserWindow({ width: 440, height: 470, resizable: false, title: 'Snap Settings', webPreferences: webPrefs });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}
ipcMain.on('cmd', (_e, c) => { if (c === 'settings') showSettings(); });

function menu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: recorder ? 'Stop recording' : 'Capture…', accelerator: settings.hotkey, click: capture },
    { label: 'Show window', click: showHome },
    { label: 'Settings…', click: showSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip(recorder ? 'Snap (recording...)' : 'Snap');
}

function showHome() {
  if (home) return home.show();
  home = new BrowserWindow({ width: 340, height: 220, resizable: false, title: 'Snap', webPreferences: webPrefs });
  home.setMenuBarVisibility(false);
  home.loadFile('home.html');
  home.on('closed', () => { home = null; });
}
app.on('activate', () => (recorder ? stopRecording() : showHome())); // Dock click

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => cb(pending || {}));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Snap', submenu: [{ label: 'Settings…', accelerator: 'CommandOrControl+,', click: showSettings }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'Capture…', click: capture }, { label: 'Settings…', click: showSettings }]));
  showHome();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  tray.on('click', capture);
  menu();
  globalShortcut.register(settings.hotkey, capture);
});

app.on('window-all-closed', () => {}); // tray app: keep running
app.on('will-quit', () => globalShortcut.unregisterAll());
