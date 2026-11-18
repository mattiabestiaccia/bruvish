import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {watchAppearance}=require('../appearance.cjs');

test('the app toolbar alone supplies bridge mode, ignoring the legacy artifact-background setting',async()=>{
 let settings={transparent:false,artifactBackground:false},key=0;
 const root={dataset:{}},styles=new Map();
 const contents=new EventEmitter();
 const mainFrame={};mainFrame.framesInSubtree=[mainFrame];
 Object.assign(contents,{mainFrame,isDestroyed:()=>false,executeJavaScript:async script=>vm.runInNewContext(script,{document:{documentElement:root}}),insertCSS:async css=>{const id=String(++key);styles.set(id,css);return id;},removeInsertedCSS:async id=>{styles.delete(id);}});
 const view={webContents:contents,setBackgroundColor(value){this.background=value;}};
 watchAppearance(view,()=>settings,error=>{throw error;});
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'dark');assert.equal(view.background,'#101318');assert.equal(styles.size,0);
 settings={transparent:true,artifactBackground:false};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'transparent');assert.equal(view.background,'#00000000');assert.equal(styles.size,1);
 settings={transparent:true,artifactBackground:true};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'transparent');assert.equal(styles.size,1,'old flag cannot override the toolbar');
 settings={transparent:false,artifactBackground:true};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'dark');assert.equal(styles.size,0);
});
