const {app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, session, shell, clipboard} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {validate, stateRoot, codeIdentity, coreRoot, takeRequests} = require('./protocol.cjs');
const {createCore} = require('./core.cjs');
const {Workspace} = require('./workspace.cjs');
const {authorizeUi} = require('./ipc.cjs');
const {Preferences, imageTypes} = require('./preferences.cjs');
const {applyWindowAppearance, watchAppearance} = require('./appearance.cjs');

const root = stateRoot();
if (!path.isAbsolute(root)) throw Error('Absolute app state required');
const startupCode = codeIdentity(__dirname);
if (process.env.LAVISH_APP_TEST_CDP === '1') app.commandLine.appendSwitch('remote-debugging-port', '0');
fs.mkdirSync(root, {recursive: true, mode: 0o700});
// LaunchServices gives an app it starts for a sandboxed caller no stdout or stderr, so the app writes its
// own log to app.log in its state directory: Chromium's log (Electron reads these switches again once this
// script has run, and passes them to the GPU and renderer processes) and the request diagnostics of log().
const logFile = path.join(root, 'app.log');
fs.closeSync(fs.openSync(logFile, 'a', 0o600));
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('log-file', logFile);
// WARNING and above only: errors and crashes stay, the artifacts' console messages (INFO) do not.
app.commandLine.appendSwitch('log-level', '1');
app.setName('Lavish');
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'profile'));
const uiFile = path.join(__dirname, 'ui/index.html'), uiUrl = pathToFileURL(uiFile).href;
const coreDirectory = coreRoot();
let win, workspace, core, preferences, initialized, queue = Promise.resolve();
const enqueue = fn => {const current = queue.then(fn);queue = current.catch(() => {});return current;};
function parse(argv) {
  const [url, file, id] = argv.slice(-3);
  if (!/^[0-9a-f-]{36}$/.test(id || '')) {
    if (argv.slice(app.isPackaged ? 1 : 2).every(arg => /^-psn_/.test(arg))) return null;
    throw Error('Invalid review request identity');
  }
  return {...validate(url, file, root), id};
}
function acknowledge(request, data) {
  const file = path.join(root, 'requests', request.id + '.json');
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file + '.tmp', JSON.stringify({...data, appCode: startupCode, url: request.url,
    file: request.file, profile: path.join(root, 'profile')}), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
}
function log(message) {
  try {fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, {mode: 0o600});} catch {}
}
// Requests that app/open.mjs leaves in requests/ (see takeRequests in protocol.cjs). Handled at
// startup and on every change of that folder, in arrival order through the queue.
function drainRequests() {
  let taken;
  try {taken = takeRequests(root);} catch (error) {log('Cannot read review requests: ' + error.message);return;}
  for (const entry of taken) void enqueue(async () => {
    let request;
    try {
      if (entry.error) throw Error(entry.error);
      request = parse([entry.url, entry.file, entry.id]);
    } catch (error) {
      log('Refused review request ' + entry.id + ': ' + error.message);
      acknowledge({id: entry.id, url: entry.url, file: entry.file}, {status: 'error', error: error.message});
      return;
    }
    await openRequest(request);
  }).catch(error => log('Review request ' + entry.id + ' failed: ' + error.message));
}
function snapshot() {return {...workspace.snapshot(), preferences: preferences.snapshot(), fullscreen: isFullscreen()};}
function notify() {if (win && !win.isDestroyed()) win.webContents.send('lavish:changed', snapshot());}
// With transparency, macOS native full screen moves the window to its own empty
// Space and only black remains behind it. Like iTerm2's non-native full screen,
// Lavish then uses Electron's simple (pre-Lion) full screen on the current Space,
// so the desktop or the chosen image stays behind the backgrounds. The green
// button cannot be redirected, so it maximizes instead of opening a new Space.
const sameSpace = () => process.platform === 'darwin' && preferences.snapshot().transparent;
function isFullscreen() {return Boolean(win && !win.isDestroyed() && (win.isFullScreen() || (process.platform === 'darwin' && win.isSimpleFullScreen())));}
function toggleFullscreen() {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin' && win.isSimpleFullScreen()) win.setSimpleFullScreen(false);
  else if (win.isFullScreen()) win.setFullScreen(false);
  else if (sameSpace()) win.setSimpleFullScreen(true);
  else win.setFullScreen(true);
  notify();
}
function fullscreenPolicy() {
  if (!win || win.isDestroyed() || process.platform !== 'darwin') return;
  const transparent = preferences.snapshot().transparent;
  if (transparent && win.isFullScreen()) {win.once('leave-full-screen', () => {fullscreenPolicy();win.setSimpleFullScreen(true);notify();});win.setFullScreen(false);return;}
  if (!transparent && win.isSimpleFullScreen()) {win.setSimpleFullScreen(false);notify();}
  win.fullScreenable = !transparent;
}
function appearance() {if (win && !win.isDestroyed()) {applyWindowAppearance(win, preferences.snapshot());fullscreenPolicy();}}
async function chooseFullscreenImage() {
  await ensureWindow();
  const selection = await dialog.showOpenDialog(win, {title: 'Immagine a schermo intero', properties: ['openFile'], filters: [{name: 'Immagini', extensions: Object.keys(imageTypes).map(type => type.slice(1))}]});
  if (selection.canceled || !selection.filePaths[0]) return;
  preferences.setFullscreenImage(fs.realpathSync(selection.filePaths[0]));notify();
}
function fullscreenImage() {
  const file = preferences.snapshot().fullscreenImage;
  if (!file) return null;
  const stat = fs.statSync(file, {throwIfNoEntry: false});
  if (!stat?.isFile()) throw Error('L’immagine a schermo intero non è più disponibile: ' + file);
  if (stat.size > 40 * 1024 * 1024) throw Error('L’immagine a schermo intero supera 40 MB.');
  return `data:${imageTypes[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
}
function createView(url) {
  const view = new WebContentsView({webPreferences: {sandbox: true, nodeIntegration: false,
    contextIsolation: true, webSecurity: true}});
  const origin = new URL(url).origin;
  view.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  for (const name of ['will-navigate', 'will-redirect']) view.webContents.on(name, (event, target) => {
    try {if (new URL(target).origin !== origin) event.preventDefault();} catch {event.preventDefault();}
  });
  view.webContents.on('will-attach-webview', event => event.preventDefault());
  watchAppearance(view, () => preferences.snapshot());
  return view;
}
async function ensureWindow() {
  if (win && !win.isDestroyed()) return;
  win = new BrowserWindow({title: 'Bruvish', width: 1240, height: 920, minWidth: 720, minHeight: 520,
    transparent: true, backgroundColor: '#00000000', visualEffectState: 'active', show: false, webPreferences: {sandbox: true, nodeIntegration: false,
      contextIsolation: true, webSecurity: true, preload: path.join(__dirname, 'preload.cjs')}});
  workspace = new Workspace({window: win, createView, onChange: notify});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('resize', () => workspace?.layout());
  for (const name of ['enter-full-screen', 'leave-full-screen']) win.on(name, notify);
  win.on('closed', () => {workspace?.destroy();workspace = null;win = null;});
  appearance();await win.loadFile(uiFile);win.show();
}
async function openRequest(request) {
  try {await ensureWindow();const result = await workspace.open(request);
    acknowledge(request, {status: 'opened', surface: 'dedicated-electron', pid: process.pid, ...result, electron: process.versions.electron});
  } catch (error) {acknowledge(request, {status: 'error', error: error.message});}
}
async function withReopen(open) {
  let result = await open(false);
  if (result.requiresReopen) {
    const choice = await dialog.showMessageBox(win, {type: 'question', buttons: ['Riapri review', 'Annulla'],
      defaultId: 1, cancelId: 1, title: 'Review conclusa', message: 'Questa review è stata conclusa da te.',
      detail: 'Vuoi riaprirla? Le risposte già salvate rimangono disponibili.'});
    if (choice.response !== 0) return {cancelled: true};
    result = await open(true);
  }
  if (result.requiresReopen) throw Error('The shared service did not reopen the review.');
  return workspace.open(result);
}
async function chooseFile() {
  const selection = await dialog.showOpenDialog(win, {title: 'Apri un artefatto Lavish', properties: ['openFile'], filters: [{name: 'Artefatti HTML', extensions: ['html', 'htm']}]});
  if (selection.canceled || !selection.filePaths[0]) return {cancelled: true};
  return withReopen(reopen => core.openFile(selection.filePaths[0], {reopen}));
}
function registerIpc() {
  const handlers = {
    'lavish:catalog': () => core.catalog(),
    'lavish:snapshot': snapshot,
    'lavish:preferences': async settings => {
      preferences.update(settings);appearance();
      await Promise.all([...workspace.tabs.values()].map(row => row.view.applyAppearance()));
      notify();return preferences.snapshot();
    },
    'lavish:mark': async request => {
      if (!request || typeof request !== 'object') throw Error('Invalid artifact preference');
      const row = await core.review(request.key);
      const result = preferences.mark(row.file, request.field, request.value);notify();return result;
    },
    'lavish:file-action': async request => {
      if (!request || !['reveal', 'copy'].includes(request.action)) throw Error('Invalid file action');
      const row = await core.review(request.key);
      if (request.action === 'copy') clipboard.writeText(row.file);
      else {if (!row.available) throw Error('Il file non è più disponibile. Puoi copiarne il percorso.');shell.showItemInFolder(row.file);}
    },
    'lavish:home': () => workspace.home(),
    'lavish:fullscreen-image': fullscreenImage,
    'lavish:select': id => {if (typeof id !== 'string') throw Error('Invalid tab');workspace.select(id);},
    'lavish:close': id => {if (typeof id !== 'string') throw Error('Invalid tab');workspace.close(id);},
    'lavish:open-review': key => withReopen(reopen => core.openRegistered(key, {reopen})),
    'lavish:choose-file': chooseFile
  };
  for (const [channel, handle] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => {
    authorizeUi(event, win?.webContents, uiUrl);
    if (args.length > 1) throw Error('Unexpected application arguments');
    return enqueue(() => handle(...args)).catch(error => {dialog.showErrorBox('Bruvish', error.message);throw error;});
  });
}
const first = parse(process.argv);
if (!app.requestSingleInstanceLock(first || {})) app.quit();
else {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    void initialized.then(() => enqueue(async () => {
      if (!data.url) {await ensureWindow();workspace.home();win.show();win.focus();return;}
      await openRequest(parse([data.url, data.file, data.id]));
    })).catch(error => {console.error(error.message);log(error.message);});
  });
  app.on('activate', () => {void initialized.then(() => enqueue(async () => {await ensureWindow();win.show();win.focus();}));});
  app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
  initialized = app.whenReady().then(async () => {
    if (codeIdentity(path.join(coreDirectory, 'app')) !== startupCode) throw Error('Questa app non corrisponde al sorgente Lavish mantenuto. Ricostruisci e aggiorna il bundle prima di riaprirla.');
    const {runtimeEnvironment} = await import(pathToFileURL(path.join(coreDirectory, 'bruvish/lib/env.mjs')).href);
    const env = runtimeEnvironment(process.env);
    core = createCore({coreDirectory, stateDirectory: env.LAVISH_AXI_STATE_DIR, port: env.LAVISH_AXI_PORT, env});
    preferences = new Preferences(root);
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', event => event.preventDefault());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label: 'Bruvish', submenu: [{role: 'about'}, {type: 'separator'}, {role: 'quit'}]},
      {label: 'File', submenu: [{label: 'Tutti i Lavish', accelerator: 'CmdOrCtrl+L', click: () => {void enqueue(async () => {await ensureWindow();workspace.home();});}},
        {label: 'Apri HTML…', accelerator: 'CmdOrCtrl+O', click: () => {void enqueue(async () => {await ensureWindow();await chooseFile();}).catch(error => dialog.showErrorBox('Bruvish', error.message));}},
        {label: 'Chiudi scheda', accelerator: 'CmdOrCtrl+W', click: () => {if (workspace?.active) workspace.close(workspace.active);else win?.close();}}]},
      {role: 'editMenu'}, {label: 'Vista', submenu: [{label: 'Ricarica scheda', accelerator: 'CmdOrCtrl+R', click: () => {const view = workspace?.tabs.get(workspace.active)?.view;if (view) view.webContents.reload();else win?.webContents.reload();}}, {type: 'separator'},
        {label: 'Schermo intero', accelerator: 'Ctrl+Cmd+F', click: toggleFullscreen},
        {label: 'Immagine a schermo intero…', click: () => {void enqueue(chooseFullscreenImage).catch(error => dialog.showErrorBox('Bruvish', error.message));}},
        {label: 'Scrivania a schermo intero', click: () => {void enqueue(async () => {preferences.setFullscreenImage(null);notify();}).catch(error => dialog.showErrorBox('Bruvish', error.message));}}]}
    ]));
    registerIpc();
    fs.writeFileSync(path.join(root, 'instance.json'), JSON.stringify({pid: process.pid, appCode: startupCode, executable: process.execPath}), {mode: 0o600});
    app.on('will-quit', () => {try {const file = path.join(root, 'instance.json');if (JSON.parse(fs.readFileSync(file)).pid === process.pid) fs.unlinkSync(file);} catch {}});
    await ensureWindow();if (first) await enqueue(() => openRequest(first));
    const requests = path.join(root, 'requests');
    fs.mkdirSync(requests, {recursive: true, mode: 0o700});
    fs.watch(requests, () => drainRequests()).on('error', error => log('Request watcher stopped: ' + error.message));
    drainRequests();
  }).catch(error => {log('Startup failed: ' + error.message);dialog.showErrorBox('Lavish non può avviarsi', error.message);app.quit();});
}
