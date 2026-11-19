const path = require('node:path');
const reviewIdentity = value => {const url = new URL(value);return url.origin + url.pathname;};
const closeView = view => {const contents = view.webContents;if (contents && !contents.isDestroyed?.()) contents.close();};

// Owns only app tabs. Closing one never calls the Lavish end-session API.
class Workspace {
  constructor({window, toolbar, createView, onChange}) {
    this.window = window; this.toolbar = toolbar; this.createView = createView; this.onChange = onChange;
    this.tabs = new Map(); this.active = null;
  }
  snapshot() { return {active: this.active, theme: this.tabs.get(this.active)?.toolbar?.theme || null, controls: this.tabs.get(this.active)?.toolbar?.controls || null, tabs: [...this.tabs].map(([id, row]) => ({id, title: row.title}))}; }
  changed() { this.onChange(this.snapshot()); }
  layout() {
    const [width, height] = this.window.getContentSize();
    // One full-width local toolbar, with the review strictly below it: no overlap or split row.
    if (this.active) this.tabs.get(this.active)?.view.setBounds({x: 0, y: 40, width, height: Math.max(0, height - 40)});
    if (this.toolbar) {
      this.toolbar.setBounds({x: 0, y: 0, width, height: this.active ? 40 : height});
      this.window.contentView.addChildView(this.toolbar);
    }
  }
  select(file) {
    if (!this.tabs.has(file)) throw Error('This tab is no longer open.');
    if (this.active) this.window.contentView.removeChildView(this.tabs.get(this.active).view);
    this.active = file; const row = this.tabs.get(file);
    this.window.contentView.addChildView(row.view); this.layout();
    this.window.show(); this.window.focus(); row.view.webContents.focus(); this.changed();
  }
  home() {
    if (this.active) this.window.contentView.removeChildView(this.tabs.get(this.active).view);
    this.active = null; this.layout(); this.changed();
  }
  async open(request) {
    const previous = this.tabs.get(request.file);
    if (previous && reviewIdentity(previous.url) === reviewIdentity(request.url)) {
      this.select(request.file);
      return {window: this.window.id, view: previous.view.webContents.id, reused: true};
    }
    const view = this.createView(request.url);
    // A tab only ever shows its own review: the frame's arrow to the catalog (/) goes to the app's own home.
    for (const name of ['will-navigate', 'will-redirect']) view.webContents.on(name, (event, target) => {
      let url = null;
      try { url = new URL(target); } catch { }
      if (url && reviewIdentity(target) === reviewIdentity(request.url)) return;
      event.preventDefault();
      if (url?.origin === new URL(request.url).origin && url.pathname === '/' && this.active === request.file && this.tabs.get(request.file)?.view === view) this.home();
    });
    try { await view.webContents.loadURL(request.url); }
    catch (error) { closeView(view); throw error; }
    if (view.webContents.getURL() !== request.url) {closeView(view);throw Error('Review navigation did not match the requested URL.');}
    if (this.active === request.file) this.home();
    const row = {view, url: request.url, title: path.basename(request.file).replace(/\.html?$/i, '')};
    this.tabs.set(request.file, row);
    view.webContents.on('page-title-updated', (_event, title) => {
      if (typeof title === 'string' && title.trim()) {row.title = title.trim().slice(0, 160);this.changed();}
    });
    this.select(request.file); if (previous) closeView(previous.view);
    return {window: this.window.id, view: view.webContents.id, reused: false};
  }
  close(file) {
    const row = this.tabs.get(file); if (!row) return;
    if (this.active === file) this.home();
    this.tabs.delete(file); closeView(row.view); this.changed();
  }
  destroy() { if (!this.window.isDestroyed?.()) this.home(); else this.active = null; for (const row of this.tabs.values()) closeView(row.view); this.tabs.clear(); }
}
module.exports = {Workspace};
