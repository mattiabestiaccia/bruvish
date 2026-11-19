// A self-contained expression evaluated in the review renderer, not in this module's realm.
/** @param {string} selector */
export function queuePointerExpression(selector) {
 return `(() => {
  const selector = ${JSON.stringify(selector)};
  const el = document.querySelector(selector);
  if (!el) return null;
  el.scrollIntoView({block:'center'});
  const r = el.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
  const describe = node => node ? {tag:node.tagName,id:node.id,className:node.getAttribute?.('class')} : null;
  if (!window.__queuePointerTrace) {
   window.__queuePointerTrace = [];
   for (const type of ['pointerdown','mousedown','mouseup','click']) document.addEventListener(type,event => {
    window.__queuePointerTrace.push({type,x:event.clientX,y:event.clientY,screenX:event.screenX,screenY:event.screenY,trusted:event.isTrusted,target:describe(event.target)});
    window.__queuePointerTrace = window.__queuePointerTrace.slice(-40);
   },true);
  }
  window.__queuePointerPoint = {selector,x,y,rect:r.toJSON(),width:innerWidth,height:innerHeight,scrollY,hit:describe(document.elementFromPoint(x,y)),wanted:describe(el),focus:document.hasFocus()};
  return {x,y};
 })()`;
}
