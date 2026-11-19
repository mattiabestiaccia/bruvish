// Fixed, main-process-only bridge between the trusted local toolbar and the review's existing UI.
// It accepts action names, never selectors, source code, URLs, or messages from an artifact.
const selectors = Object.freeze({
  annotate: '#annotation', closed: '.mb-closed-switch', panel: '#sidebarToggle',
  more: '#moreButton', revisions: '#revisionsButton', warnings: '#warningsButton'
});
const reviewToolbarCSS = `
  :root{--bar-h:0px!important}
  .bar{display:contents!important}
  .bar>*{display:none!important}
  .bar>.warnings-wrap,.bar>.revisions-wrap,.bar>.more-wrap{display:contents!important}
  .bar>.warnings-wrap>button,.bar>.revisions-wrap>button,.bar>.more-wrap>button{display:none!important}
  .bar .menu{position:fixed!important;top:8px!important;right:8px!important}
  .mb-rail{top:12px!important}
`;
const readToolbarScript = `(() => {
  const style=getComputedStyle(document.documentElement);
  const theme=Object.fromEntries(['--mb-title','--mb-muted','--mb-line','--mb-field','--mb-glass','--mb-on-accent'].map(key=>[key,style.getPropertyValue(key)]));
  const bar=document.querySelector('.bar');if(bar)theme['--mb-glass']=getComputedStyle(bar).backgroundColor;
  const controls=Object.fromEntries(Object.entries(${JSON.stringify(selectors)}).map(([name,selector])=>{
    const target=name==='panel'&&matchMedia('(max-width: 860px)').matches?'#panelToggle':selector;
    const button=document.querySelector(target);
    if(!button)return [name,{hidden:true}];
    const wrap=button.closest('.warnings-wrap,.revisions-wrap');
    return [name,{
      hidden:button.hidden||Boolean(wrap?.hidden),disabled:button.disabled,
      checked:button.getAttribute('aria-checked')==='true',expanded:button.getAttribute('aria-expanded')==='true',
      label:button.getAttribute('aria-label')||button.title||'',title:button.title||'',
      count:(button.querySelector('.warnings-count,.revisions-count,.sidebar-toggle-count')?.textContent||'').slice(0,8)
    }];
  }));
  return {theme,controls};
})()`;
/** @param {unknown} action */
function toolbarActionScript(action) {
  if (typeof action !== 'string' || !Object.hasOwn(selectors, action)) throw Error('Invalid review toolbar action');
  const name = /** @type {keyof typeof selectors} */ (action);
  const selector = name === 'panel' ? `(matchMedia('(max-width: 860px)').matches?'#panelToggle':'#sidebarToggle')` : JSON.stringify(selectors[name]);
  return `(() => {const button=document.querySelector(${selector});if(!button||button.hidden||button.disabled)return false;button.click();return true})()`;
}
module.exports = {reviewToolbarCSS, readToolbarScript, toolbarActionScript};
