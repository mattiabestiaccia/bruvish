import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

test('library choices persist independently across restarts, with explicit unpin and unfavorite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lavish-preferences-'));
  try {
    const {Preferences} = require('../preferences.cjs');
    const prefs = new Preferences(root);
    prefs.update({layout: 'grid', transparent: true, artifactBackground: true});
    prefs.mark('/tmp/one.html', 'favorite', true);
    prefs.mark('/tmp/one.html', 'pinned', true);
    let restored = new Preferences(root);
    assert.deepEqual(restored.snapshot().artifacts['/tmp/one.html'], {favorite: true, pinned: true});
    assert.equal(restored.snapshot().layout, 'grid');
    assert.equal(restored.snapshot().transparent, true);
    restored.mark('/tmp/one.html', 'pinned', false);
    restored.mark('/tmp/one.html', 'favorite', false);
    restored = new Preferences(root);
    assert.equal(restored.snapshot().artifacts['/tmp/one.html'], undefined);
    assert.throws(() => restored.update({layout: 'bogus'}), /Invalid/);
    assert.throws(() => restored.mark('/tmp/one.html', '__proto__', true), /Invalid/);
    fs.writeFileSync(path.join(root, 'preferences.json'), '{broken');
    assert.throws(() => new Preferences(root), /preferenze/);
    assert.equal(fs.readFileSync(path.join(root, 'preferences.json'), 'utf8'), '{broken');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('catalog folders survive restart without changing legacy preferences or moving files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lavish-folders-'));
  try {
    const {Preferences} = require('../preferences.cjs');
    const prefs = new Preferences(root);
    const file = path.join(root, 'example.html');
    fs.writeFileSync(file, '<p>Example</p>');
    prefs.mark(file, 'pinned', true);
    const legacyFile = path.join(root, 'preferences.json');
    const legacyBytes = fs.readFileSync(legacyFile, 'utf8');
    const state = prefs.createFolder('  Révision  ');
    const [folder] = state.folders;
    assert.equal(folder.name, 'Révision');
    assert.throws(() => prefs.createFolder('revision'), /esiste già/i);
    assert.throws(() => prefs.createFolder('   '), /nome/);
    assert.throws(() => prefs.assignFolder(file, 'unknown'), /non esiste/i);
    assert.throws(() => prefs.assignFolder('relative.html', folder.id), /percorso/);
    prefs.assignFolder(file, folder.id);
    const restored = new Preferences(root);
    assert.equal(restored.snapshot().folderAssignments[file], folder.id);
    assert.equal(restored.snapshot().artifacts[file].pinned, true);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);
    assert.equal(fs.readFileSync(file, 'utf8'), '<p>Example</p>');
    restored.assignFolder(file, null);
    assert.equal(new Preferences(root).snapshot().folderAssignments[file], undefined);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('full-screen image is chosen only by the main process, persists, and accepts only absolute images', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lavish-preferences-'));
  try {
    const {Preferences} = require('../preferences.cjs');
    const prefs = new Preferences(root);
    assert.equal(prefs.snapshot().fullscreenImage, null);
    assert.throws(() => prefs.update({fullscreenImage: '/tmp/a.png'}), /Invalid/);
    for (const bad of ['relative.png', '/tmp/a.html', '/tmp/a', 42]) assert.throws(() => prefs.setFullscreenImage(bad));
    prefs.setFullscreenImage('/tmp/Sfondo.JPG');
    assert.equal(new Preferences(root).snapshot().fullscreenImage, '/tmp/Sfondo.JPG');
    prefs.setFullscreenImage(null);
    assert.equal(new Preferences(root).snapshot().fullscreenImage, null);
    fs.writeFileSync(path.join(root, 'preferences.json'), JSON.stringify({layout: 'list', artifacts: {}, fullscreenImage: '/etc/passwd'}));
    assert.throws(() => new Preferences(root), /preferenze/);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
