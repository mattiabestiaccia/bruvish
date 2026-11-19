import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {watchAppearance}=require('../appearance.cjs');

test('handwritten artifact canvases match the dark host and retain a dark opaque fallback',async()=>{
 let settings={transparent:true};const styles=new Map(),inserted=new Map(),root={dataset:{}};
 const document={getElementById:id=>styles.get(id),createElement:()=>({dataset:{},remove(){styles.delete(this.id);}}),documentElement:{append:style=>styles.set(style.id,style)}};
 const child={executeJavaScript:async script=>vm.runInNewContext(script,{document})};
 const mainFrame={framesInSubtree:[]};mainFrame.framesInSubtree=[mainFrame,child];
 const contents=Object.assign(new EventEmitter(),{mainFrame,isDestroyed:()=>false,executeJavaScript:async script=>vm.runInNewContext(script,{document:{documentElement:root}}),insertCSS:async css=>{inserted.set('shell',css);return 'shell';},removeInsertedCSS:async()=>inserted.clear()});
 const view={webContents:contents,setBackgroundColor(value){this.background=value;}};
 watchAppearance(view,()=>settings,error=>{throw error;});
 await view.applyAppearance();
 assert.match(styles.get('lavish-private-app-background').textContent,/color-scheme:\s*dark/,'child canvas must match the dark embedding document, not force a white canvas');
 assert.match(inserted.get('shell'),/iframe[^}]*color-scheme:\s*dark/);
 settings={transparent:false};await view.applyAppearance();
 assert.equal(view.background,'#1f2023');
 assert.match(styles.get('lavish-private-app-background').textContent,/background:\s*#1f2023/,'transparent or unspecified artifact backgrounds need an explicit dark canvas when off');
 assert.match(inserted.get('shell'),/\.frame[^}]*background:\s*#1f2023/,'the chrome frame must not retain upstream white');
 settings={transparent:true};await view.applyAppearance();
 assert.match(styles.get('lavish-private-app-background').textContent,/html[^}]*background:\s*transparent/);
 assert.equal(styles.size,1,'repeated toggles replace the single temporary style');
});

test('the app toolbar alone supplies bridge mode, ignoring the legacy artifact-background setting',async()=>{
 let settings={transparent:false,artifactBackground:false},key=0;
 const root={dataset:{}},styles=new Map();
 const contents=new EventEmitter();
 const mainFrame={};mainFrame.framesInSubtree=[mainFrame];
 Object.assign(contents,{mainFrame,isDestroyed:()=>false,executeJavaScript:async script=>vm.runInNewContext(script,{document:{documentElement:root}}),insertCSS:async css=>{const id=String(++key);styles.set(id,css);return id;},removeInsertedCSS:async id=>{styles.delete(id);}});
 const view={webContents:contents,setBackgroundColor(value){this.background=value;}};
 watchAppearance(view,()=>settings,error=>{throw error;});
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'dark');assert.equal(view.background,'#1f2023');assert.equal(styles.size,1);
 settings={transparent:true,artifactBackground:false};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'transparent');assert.equal(view.background,'#00000000');assert.equal(styles.size,1);
 settings={transparent:true,artifactBackground:true};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'transparent');assert.equal(styles.size,1,'old flag cannot override the toolbar');
 settings={transparent:false,artifactBackground:true};
 await view.applyAppearance();
 assert.equal(root.dataset.mbAppMode,'dark');assert.equal(styles.size,1);
});
