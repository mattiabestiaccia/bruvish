const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const defaults = () => ({layout: 'list', transparent: false, artifactBackground: true, fullscreenImage: null, artifacts: {}});
const imageTypes = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'};
const validImage = file => file === null || (typeof file === 'string' && path.isAbsolute(file) && Object.hasOwn(imageTypes, path.extname(file).toLowerCase()));
function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, v]) =>
    key === 'layout' ? !['list', 'grid'].includes(v) : !['transparent', 'artifactBackground'].includes(key) || typeof v !== 'boolean')) throw Error('Invalid application preferences');
}
class Preferences {
  constructor(root) {
    this.file = path.join(root, 'preferences.json');
    this.value = defaults();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const {artifacts, fullscreenImage = null, ...settings} = saved;
      validateSettings(settings);
      if (!validImage(fullscreenImage)) throw Error('Invalid saved fullscreen image');
      if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts) || Object.entries(artifacts).some(([file, mark]) =>
        !path.isAbsolute(file) || !mark || typeof mark !== 'object' || Array.isArray(mark) || Object.entries(mark).some(([key, v]) => !['favorite', 'pinned'].includes(key) || typeof v !== 'boolean'))) throw Error('Invalid saved metadata');
      this.value = {...this.value, ...settings, fullscreenImage, artifacts};
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('Impossibile leggere le preferenze Lavish. Il file non è stato modificato.');
    }
  }
  snapshot() { return structuredClone(this.value); }
  save(next) {
    fs.mkdirSync(path.dirname(this.file), {recursive: true, mode: 0o700});
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(next), {mode: 0o600}); fs.renameSync(temp, this.file); }
    finally { fs.rmSync(temp, {force: true}); }
    this.value = next;
    return this.snapshot();
  }
  update(settings) { validateSettings(settings); return this.save({...this.value, ...settings}); }
  // Set only from the main-process menu: the UI cannot choose a file to read.
  setFullscreenImage(file) {
    if (!validImage(file)) throw Error('Scegli un’immagine PNG, JPEG, WebP o GIF.');
    return this.save({...this.value, fullscreenImage: file});
  }
  mark(file, field, value) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !['favorite', 'pinned'].includes(field) || typeof value !== 'boolean') throw Error('Invalid artifact preference');
    const next = this.snapshot(), mark = {...next.artifacts[file], [field]: value};
    if (mark.favorite || mark.pinned) next.artifacts[file] = {favorite: Boolean(mark.favorite), pinned: Boolean(mark.pinned)};
    else delete next.artifacts[file];
    return this.save(next);
  }
}
module.exports = {Preferences, imageTypes};
