import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {readToolbarScript, toolbarActionScript} = require('../review-toolbar.cjs');

test('only the six fixed review actions are admitted; no renderer-supplied selector or code', () => {
 for (const action of ['annotate','closed','panel','more','revisions','warnings']) {
  let clicked=0;
  const script=toolbarActionScript(action);
  assert.equal(vm.runInNewContext(script,{matchMedia:()=>({matches:false}),document:{querySelector:()=>({click(){clicked++;},hidden:false,disabled:false})}}),true);
  assert.equal(clicked,1);
  assert.equal(vm.runInNewContext(script,{matchMedia:()=>({matches:false}),document:{querySelector:()=>({disabled:true,click(){throw Error('disabled');}})}}),false);
 }
 for (const action of ['__proto__','constructor','toString','#send','send','end','more);process.exit()',null,{}]) assert.throws(()=>toolbarActionScript(action),/Invalid review toolbar action/);
});
test('panel action follows the actual responsive sheet control below the desktop breakpoint', () => {
 for (const mobile of [false,true]) {
  let selector;
  vm.runInNewContext(toolbarActionScript('panel'),{matchMedia:()=>({matches:mobile}),document:{querySelector:value=>{selector=value;return {click(){}};}}});
  assert.equal(selector,mobile?'#panelToggle':'#sidebarToggle');
 }
});
test('read script copies only state/theme, including late hidden and disabled state', () => {
 const buttons = new Map([
  ['#annotation',{attributes:{'aria-checked':'true','aria-label':'Annota'},title:'Annota',disabled:false}],
  ['.mb-closed-switch',{hidden:true}],
  ['#sidebarToggle',{attributes:{'aria-expanded':'false','aria-label':'Mostra la conversazione'},count:'2'}],
  ['#moreButton',{attributes:{'aria-expanded':'true'},disabled:true}],
  ['#revisionsButton',{wrapHidden:true,count:'4'}],
  ['#warningsButton',{count:'3'}]
 ]);
 const result=vm.runInNewContext(readToolbarScript,{
  matchMedia:()=>({matches:false}),
  document:{documentElement:{},querySelector:selector=>{
   if(selector==='.bar')return {bar:true};
   const data=buttons.get(selector);if(!data)return null;
   return {...data,getAttribute:key=>data.attributes?.[key]??null,closest:()=>({hidden:data.wrapHidden||false}),querySelector:()=>({textContent:data.count||''})};
  }},getComputedStyle:()=>({getPropertyValue:key=>key==='--mb-title'?'#c7abfa':'',backgroundColor:'rgb(20, 24, 30)'})
 });
 assert.equal(result.theme['--mb-title'],'#c7abfa');assert.equal(result.theme['--mb-glass'],'rgb(20, 24, 30)');
 assert.equal(result.controls.annotate.checked,true);assert.equal(result.controls.closed.hidden,true);
 assert.equal(result.controls.panel.expanded,false);assert.equal(result.controls.panel.count,'2');
 assert.equal(result.controls.more.expanded,true);assert.equal(result.controls.more.disabled,true);
 assert.equal(result.controls.revisions.hidden,true);assert.equal(result.controls.warnings.count,'3');
});
