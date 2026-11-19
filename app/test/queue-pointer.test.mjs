import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {queuePointerExpression} from '../test-helpers/queue-pointer.mjs';

test('generated CDP pointer expression executes without selector or other caller bindings',()=>{
 for(const selector of ['#queuedLog .bubble-text','.queued-edit-save','button[data-value="quote\'\\value"]']){
  const events=new Map(),window={};let queried,registrations=0;
  const rect={x:10,y:20,width:100,height:40,toJSON(){return {x:this.x,y:this.y,width:this.width,height:this.height};}};
  const node={tagName:'DIV',id:'note',getAttribute:()=> 'bubble-text',getBoundingClientRect:()=>rect,scrollIntoView(){}};
  const document={querySelector:value=>{queried=value;return node;},elementFromPoint:(x,y)=>{assert.deepEqual([x,y],[60,40]);return node;},hasFocus:()=>true,addEventListener:(type,fn)=>{registrations++;events.set(type,fn);}};
  const context=vm.createContext({document,window,innerWidth:1200,innerHeight:800,scrollY:0});
  const script=new vm.Script(queuePointerExpression(selector));
  const point=script.runInContext(context);
  assert.equal(queried,selector);
  assert.deepEqual([point.x,point.y],[60,40]);
  assert.equal(window.__queuePointerPoint.selector,selector);
  events.get('click')({clientX:60,clientY:40,screenX:160,screenY:140,isTrusted:true,target:node});
  assert.equal(window.__queuePointerTrace[0].target.id,'note');
  script.runInContext(context);
  assert.equal(registrations,4,'retries do not install more listeners');
 }
});

test('pointer probe retries when its target is not present',()=>{
 const result=vm.runInNewContext(queuePointerExpression('#missing'),{document:{querySelector:()=>null}});
 assert.equal(result,null);
});
