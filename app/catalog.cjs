const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {workedAt, agent, profile, sessionId} = value;
  if (Object.keys(value).length !== 4 || typeof workedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(workedAt)) return null;
  const date = new Date(workedAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19) !== workedAt.slice(0, 19) || date.valueOf() > Date.now() + 5 * 60_000) return null;
  if (typeof agent !== 'string' || !agent.trim() || agent.length > 80 || /[\p{Cc}\p{Cf}]/u.test(agent) ||
    typeof profile !== 'string' || !/^[\w.-]{1,50}$/.test(profile) ||
    typeof sessionId !== 'string' || !/^[\w.:-]{1,128}$/.test(sessionId)) return null;
  return {workedAt: date.toISOString(), agent: agent.trim(), profile, sessionId};
}
async function lookupMetadata(stateDirectory, key) {
  try {return normalizeMetadata(JSON.parse(await fs.readFile(path.join(stateDirectory, 'catalog-metadata', `${key}.json`), 'utf8')));}
  catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;throw error;}
}
async function recordMetadata(stateDirectory, key, metadata) {
  if (!/^[a-f0-9]{16}$/.test(key)) throw Error('Invalid review key');
  const normalized = normalizeMetadata(metadata);
  if (!normalized) throw Error('Invalid artifact metadata');
  const previous = await lookupMetadata(stateDirectory,key);
  if (previous && previous.workedAt > normalized.workedAt) return false;
  if (JSON.stringify(previous) === JSON.stringify(normalized)) return false;
  const dir = path.join(stateDirectory, 'catalog-metadata');
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const file = path.join(dir, `${key}.json`), tmp = path.join(dir, `${randomUUID()}.tmp`);
  try {await fs.writeFile(tmp, JSON.stringify(normalized), {mode:0o600,flag:'wx'});await fs.rename(tmp,file);}
  finally {await fs.rm(tmp,{force:true});}
  return true;
}

async function entries(stateDirectory) {
  let data;
  try { data = JSON.parse(await fs.readFile(path.join(stateDirectory, 'state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw Error('Cannot read the Lavish catalog. The saved state was not changed.'); }
  if (!data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions)) throw Error('Invalid Lavish catalog. The saved state was not changed.');
  return Promise.all(Object.entries(data.sessions).map(async ([key, entry]) => {
    if (!/^[a-f0-9]{16}$/.test(key) || !entry || !path.isAbsolute(entry.file || '')) throw Error('Invalid registered review. The saved state was not changed.');
    let file = entry.file, available = false;
    try { file = await fs.realpath(file); available = /\.html?$/i.test(file) && (await fs.stat(file)).isFile(); } catch {}
    return {key, file, registeredFile: entry.file, name: path.basename(file).replace(/\.html?$/i, ''), available,
      status: entry.status === 'ended' ? 'ended' : 'active', endedBy: entry.ended_by || null,
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : '', metadata: await lookupMetadata(stateDirectory, key)};
  }));
}
async function listReviews(stateDirectory) {
  const rows = (await entries(stateDirectory)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const unique = new Map();
  for (const row of rows) if (!unique.has(row.file)) unique.set(row.file, row);
  return [...unique.values()];
}
async function findReview(stateDirectory, key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{16}$/.test(key)) throw Error('Invalid review key');
  const entry = (await entries(stateDirectory)).find(row => row.key === key);
  if (!entry) throw Error('Review is not registered in this Lavish catalog');
  return entry;
}
module.exports = {listReviews, findReview, normalizeMetadata, recordMetadata};
