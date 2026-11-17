const fs = require('node:fs/promises');
const path = require('node:path');

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
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : ''};
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
module.exports = {listReviews, findReview};
