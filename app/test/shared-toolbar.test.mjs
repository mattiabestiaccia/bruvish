import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Workspace} = require('../workspace.cjs');
const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('a single full-width trusted toolbar sits above the entire review', () => {
 const calls = [], toolbar = {setBounds: bounds => calls.push(['toolbar', bounds])};
 const review = {setBounds: bounds => calls.push(['review', bounds])};
 const window = {getContentSize: () => [1000,700], contentView: {addChildView: view => calls.push(['top',view])}};
 const workspace = new Workspace({window, toolbar, createView(){}, onChange(){}});
 workspace.tabs.set('one', {view: review});workspace.active = 'one';workspace.layout();
 assert.deepEqual(calls, [['review',{x:0,y:40,width:1000,height:660}],['toolbar',{x:0,y:0,width:1000,height:40}],['top',toolbar]]);
 calls.length=0;workspace.active=null;workspace.layout();
 assert.deepEqual(calls, [['toolbar',{x:0,y:0,width:1000,height:700}],['top',toolbar]]);
});
test('toolbar is accessible, branded, and removes obsolete visible controls', () => {
 const html = source('../ui/index.html'), css = source('../ui/app.css');
 assert.match(html, /class="brand"[^>]*>BRUVISH</);
 assert.match(html, /id="transparent"[^>]*role="switch"[^>]*aria-checked="false"[^>]*aria-label="Trasparenza"/);
 assert.doesNotMatch(html, /id="(?:artifact-background|choose)"/);
 assert.match(css, /letter-spacing:\.16em/);
 assert.match(source('../main.cjs'), /titleBarStyle: 'hidden'/);
 assert.match(source('../main.cjs'), /trafficLightPosition: \{x: 12, y: 13\}/);
 assert.match(html, /id="toolbar-actions"[^>]*>[\s\S]*id="transparent"[\s\S]*id="closed"[\s\S]*id="annotate"[\s\S]*id="panel"[\s\S]*id="more"/);
 assert.match(css, /#toolbar-actions\{[^}]*margin-left:auto/);
 assert.doesNotMatch(source('../workspace.cjs'), /width - 360/);
});
