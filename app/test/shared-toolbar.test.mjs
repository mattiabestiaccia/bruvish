import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Workspace} = require('../workspace.cjs');

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
