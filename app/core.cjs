const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {listReviews, findReview} = require('./catalog.cjs');
const {validate} = require('./protocol.cjs');

function createCore({coreDirectory, stateDirectory, port, env = process.env, run}) {
  const invoke = run || (args => new Promise((resolve, reject) => {
    // Finder has a minimal PATH. The bundled Electron binary supplies Node mode;
    // the installed Bruvish build remains the single maintained Lavish core.
    const child = spawn(process.execPath, [path.join(coreDirectory, 'dist/bruvish.mjs'), ...args], {
      env: {...env, ELECTRON_RUN_AS_NODE: '1'}, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Lavish did not respond within 30 seconds.')); }, 30000);
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', error => {clearTimeout(timer);reject(error);});
    child.on('close', code => {clearTimeout(timer);resolve({code, stdout, stderr});});
  }));
  async function openFile(file, {reopen = false} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.html?$/i.test(file) || !(await fs.stat(file)).isFile()) throw Error('Choose an existing HTML artifact.');
    const result = await invoke([file, '--no-open', ...(reopen ? ['--reopen'] : [])]);
    if (result.code) throw Error((result.stderr || 'The shared Lavish core could not open this review.').slice(0, 2000));
    if (/status:\s*"?user-ended"?/.test(result.stdout)) return {requiresReopen: true};
    const url = result.stdout.match(/https?:\/\/[^\s"<>]+/)?.[0];
    if (!url || new URL(url).origin !== `http://127.0.0.1:${port}`) throw Error('The shared core returned an unexpected review origin.');
    return validate(url, file, stateDirectory);
  }
  async function openRegistered(key, {reopen = false} = {}) {
    const review = await findReview(stateDirectory, key);
    if (!review.available) throw Error('This artifact file is no longer available.');
    if (review.status === 'ended' && review.endedBy === 'user' && !reopen) return {requiresReopen: true};
    return openFile(review.registeredFile, {reopen});
  }
  return {catalog: () => listReviews(stateDirectory), review: key => findReview(stateDirectory, key), openRegistered, openFile};
}
module.exports = {createCore};
