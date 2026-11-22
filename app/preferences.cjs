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
const folderName = value => typeof value === 'string' && !/[\u0000-\u001f\u007f]/u.test(value) && value.trim().length <= 40 ? value.trim() : '';
const folderKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
function readOrganization(file) {
  try {
    const {folders, folderAssignments} = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(folders) || !folderAssignments || typeof folderAssignments !== 'object' || Array.isArray(folderAssignments)) throw Error('Invalid organization');
    const ids = new Set(), names = new Set();
    for (const folder of folders) {
      if (!folder || typeof folder.id !== 'string' || !/^[a-f0-9-]{36}$/.test(folder.id) || !folderName(folder.name) || folderName(folder.name) !== folder.name || ids.has(folder.id) || names.has(folderKey(folder.name))) throw Error('Invalid folder');
      ids.add(folder.id);
      names.add(folderKey(folder.name));
    }
    if (Object.entries(folderAssignments).some(([artifact, id]) => !path.isAbsolute(artifact) || !ids.has(id))) throw Error('Invalid folder assignment');
    return {folders, folderAssignments};
  } catch (error) {
    if (error.code === 'ENOENT') return {folders: [], folderAssignments: {}};
    throw Error('Impossibile leggere le cartelle Bruvish. Il file non è stato modificato.');
  }
}
function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600}); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, {force: true}); }
}
class Preferences {
  constructor(root) {
    this.file = path.join(root, 'preferences.json');
    this.organizationFile = path.join(root, 'catalog-organization.json');
    this.organization = readOrganization(this.organizationFile);
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
  snapshot() { return structuredClone({...this.value, ...this.organization}); }
  save(next) {
    saveJson(this.file, next);
    this.value = next;
    return this.snapshot();
  }
  saveOrganization(next) {
    saveJson(this.organizationFile, next);
    this.organization = next;
    return this.snapshot();
  }
  createFolder(value) {
    const name = folderName(value);
    if (!name) throw Error('Scrivi un nome di massimo 40 caratteri, senza caratteri di controllo.');
    if (this.organization.folders.some(folder => folderKey(folder.name) === folderKey(name))) throw Error('Esiste già una cartella con questo nome.');
    return this.saveOrganization({...this.organization, folders: [...this.organization.folders, {id: randomUUID(), name}]});
  }
  assignFolder(file, folderId) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Serve il percorso assoluto di un artefatto registrato.');
    if (folderId !== null && !this.organization.folders.some(folder => folder.id === folderId)) throw Error('La cartella non esiste.');
    const folderAssignments = {...this.organization.folderAssignments};
    if ((folderAssignments[file] ?? null) === folderId) return this.snapshot();
    if (folderId === null) delete folderAssignments[file];
    else folderAssignments[file] = folderId;
    return this.saveOrganization({...this.organization, folderAssignments});
  }
  update(settings) { validateSettings(settings); return this.save({...this.value, ...settings}); }
  // Set only from the main-process menu: the UI cannot choose a file to read.
  setFullscreenImage(file) {
    if (!validImage(file)) throw Error('Scegli un’immagine PNG, JPEG, WebP o GIF.');
    return this.save({...this.value, fullscreenImage: file});
  }
  mark(file, field, value) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !['favorite', 'pinned'].includes(field) || typeof value !== 'boolean') throw Error('Invalid artifact preference');
    const next = structuredClone(this.value), mark = {...next.artifacts[file], [field]: value};
    if (mark.favorite || mark.pinned) next.artifacts[file] = {favorite: Boolean(mark.favorite), pinned: Boolean(mark.pinned)};
    else delete next.artifacts[file];
    return this.save(next);
  }
}
module.exports = {Preferences, imageTypes};
