const api = window.lavishApp;
const $ = id => document.getElementById(id);
let reviews = [], state = {tabs: [], active: null};
let preferences = {transparent: false, artifactBackground: true, fullscreenImage: null, artifacts: {}, folders: [], folderAssignments: {}};
let activeFolder = null, activeFilter = 'all', titleMatch = null, suggestionKeys = [], selectedSuggestion = -1, infoAnchor = null;
function showError(error) {$('error').textContent = error.message || String(error);$('error').hidden = false;}
async function action(fn) {try {$('error').hidden = true;return await fn();}catch (error) {showError(error);}}
function button(text, listener, className = '') {const node = document.createElement('button');node.textContent = text;node.className = className;node.addEventListener('click', listener);return node;}
function renderPreferences(next) {
 if (next) preferences = next;
 document.body.classList.toggle('transparent', preferences.transparent);
 document.body.classList.toggle('transparent-artifacts', preferences.transparent);
 $('transparent').setAttribute('aria-checked', String(preferences.transparent));
 renderFolders();
}
const controlLabels = {annotate:'Annota',closed:'Anche le carte chiuse',panel:'Mostra la conversazione',more:'Altro',revisions:'Revisioni',warnings:'Problemi di impaginazione'};
function renderReviewControls(controls, active) {
 $('review-actions').hidden = !active;
 for (const [id, label] of Object.entries(controlLabels)) {
  const node = $(id), control = controls?.[id];
  node.hidden = !control || Boolean(control.hidden);
  node.disabled = !control || Boolean(control.disabled);
  node.setAttribute('aria-label', control?.label || label);
  node.title = control?.title || control?.label || label;
  if (node.getAttribute('role') === 'switch') node.setAttribute('aria-checked', String(Boolean(control?.checked)));
  else node.setAttribute('aria-expanded', String(Boolean(control?.expanded)));
  const badge = node.querySelector('.control-count');
  if (badge) {const count=Number.parseInt(control?.count,10)||0;badge.textContent=count>99?'99+':String(count);badge.hidden=count<1;}
 }
}
function renderTabs(next) {
 for (const key of ['--mb-title','--mb-muted','--mb-line','--mb-field','--mb-glass','--mb-on-accent']) {
  const value = next.theme?.[key];
  if (typeof value === 'string' && value.trim()) document.documentElement.style.setProperty(key, value);
  else document.documentElement.style.removeProperty(key);
 }
 state = next;renderReviewControls(next.controls, next.active);renderPreferences(next.preferences);document.body.classList.toggle('fullscreen', Boolean(next.fullscreen));document.body.classList.toggle('in-review', Boolean(state.active));$('tabs').replaceChildren();
 for (const tab of state.tabs) {const item = document.createElement('span');item.className = 'tab' + (tab.id === state.active ? ' active' : '');
  const title = button(tab.title, () => action(() => api.select(tab.id)), 'title');title.title = tab.title;
  const close = button('×', () => action(() => api.close(tab.id)), 'close');close.setAttribute('aria-label', 'Ferma la visualizzazione di ' + tab.title);item.append(title, close);$('tabs').append(item);
 }
 renderCatalog();
}
const icons = {
 pinned:'M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v6',
 favorite:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
 open:'M4 12h15m-6-6 6 6-6 6',
 close:'m6 6 12 12M18 6 6 18'
};
const normal = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
const marks = row => preferences.artifacts[row.file] || {};
const folderOf = row => preferences.folderAssignments?.[row.file] ?? null;
const folders = () => preferences.folders ?? [];
function iconButton(text, listener, label, icon, className = '') {
 const node = button(text, listener, `catalog-icon ${className}`);node.type = 'button';node.title = label;node.setAttribute('aria-label', label);
 if (icon) {
  const namespace = 'http://www.w3.org/2000/svg', svg = document.createElementNS(namespace,'svg'), path = document.createElementNS(namespace,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',icons[icon]);svg.append(path);node.append(svg);
 }
 return node;
}
function renderFolders() {
 const parent = $('folders');
 const focused = parent.contains(document.activeElement) ? document.activeElement.dataset.folder : undefined;
 parent.replaceChildren();
 for (const {id,name} of [{id:null,name:'Tutti'}, ...folders()]) {
  const node = button(name, () => {activeFolder = id;titleMatch = null;renderFolders();renderCatalog();});
  node.dataset.folder = id ?? '';node.setAttribute('aria-pressed', String(id === activeFolder));parent.append(node);
  if (node.dataset.folder === focused) node.focus();
 }
}
function filterOptions() {
 return [['all','Tutti gli artefatti'],['favorite','Solo preferiti'],['pinned','Solo fissati'],['active','Review non concluse'],['ended','Review concluse'],['missing','File mancanti'],
  ...[...new Set(reviews.map(row => row.metadata?.profile).filter(Boolean))].sort().map(profile => [`profile:${profile}`, `Ultimo profilo: ${profile}`])];
}
function filteredRows() {
 const terms = normal($('search').value).trim().split(/\s+/).filter(Boolean);
 return reviews.filter(row => (activeFolder === null || folderOf(row) === activeFolder) && terms.every(term => normal(row.name).includes(term)) && (
  activeFilter === 'all' || (activeFilter === 'missing' ? !row.available : activeFilter.startsWith('profile:') ? row.metadata?.profile === activeFilter.slice(8) : ['favorite','pinned'].includes(activeFilter) ? Boolean(marks(row)[activeFilter]) : row.available && row.status === activeFilter)));
}
function hideSuggestions() {
 $('suggestions').hidden = true;$('search').setAttribute('aria-expanded','false');$('search').removeAttribute('aria-activedescendant');selectedSuggestion = -1;
}
function chooseSuggestion(row) {
 $('search').value = row.name;titleMatch = row.key;hideSuggestions();renderCatalog();
}
function showSuggestions() {
 if (!$('search').value.trim() || titleMatch !== null) {hideSuggestions();return;}
 const rows = filteredRows().slice(0, 12), list = $('suggestions');
 list.replaceChildren();suggestionKeys = rows;selectedSuggestion = -1;$('search').removeAttribute('aria-activedescendant');
 for (const row of rows) {
  const item = document.createElement('li');item.id = `suggestion-${row.key}`;item.textContent = row.name;item.setAttribute('role','option');item.setAttribute('aria-selected','false');
  item.addEventListener('click', () => chooseSuggestion(row));list.append(item);
 }
 if (!rows.length) {hideSuggestions();return;}
 list.hidden = false;$('search').setAttribute('aria-expanded','true');
}
function closeInfo() {const info = $('catalog-info');if (info.matches(':popover-open')) info.hidePopover();}
function positionInfo() {
 const info = $('catalog-info');if (!infoAnchor?.isConnected || !info.matches(':popover-open')) return;
 const rect = infoAnchor.getBoundingClientRect();
 info.style.left = `${Math.max(12, Math.min(innerWidth - info.offsetWidth - 12, rect.right - info.offsetWidth))}px`;
 const top = rect.bottom + 8 + info.offsetHeight <= innerHeight - 12 ? rect.bottom + 8 : rect.top - info.offsetHeight - 8;
 info.style.top = `${Math.max(12,top)}px`;
}
function showInfo(row, anchor) {
 const info = $('catalog-info');
 if (infoAnchor === anchor && info.matches(':popover-open')) {closeInfo();return;}
 infoAnchor?.setAttribute('aria-expanded','false');infoAnchor = anchor;info.replaceChildren();
 const heading = document.createElement('header'), title = document.createElement('h2');title.id = 'catalog-info-title';title.textContent = row.name;
 const close = iconButton('', () => {closeInfo();anchor.focus();}, 'Chiudi informazioni', 'close');heading.append(title,close);
 const fields = document.createElement('dl'), date = new Date(row.metadata?.workedAt ?? '');
 for (const [label,value] of [['Ultimo lavoro', Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('it-IT',{dateStyle:'medium',timeStyle:'short'})],['Agente',row.metadata?.agent],['Profilo',row.metadata?.profile],['Sessione agente',row.metadata?.sessionId],['Review Lavish',!row.available ? 'File mancante' : row.status === 'ended' ? 'Conclusa' : 'Non conclusa'],['File',row.file]]) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');dt.textContent = label;dd.textContent = value || 'Non disponibile';fields.append(dt,dd);
 }
 const label = document.createElement('label'), select = document.createElement('select');label.textContent = 'Organizza in';
 for (const folder of [{id:null,name:'Senza cartella'}, ...folders()]) {const option = document.createElement('option');option.value = folder.id ?? '';option.textContent = folder.name;option.selected = folderOf(row) === folder.id;select.append(option);}
 select.addEventListener('change', () => action(async () => {
  const folderId = select.value || null;
  try {renderPreferences(await api.assignFolder({key:row.key,folderId}));renderCatalog();($(`info-${row.key}`) || $('new-folder')).focus();}
  finally {select.value = folderOf(row) ?? '';}
 }));
 label.append(select);
 const tools = document.createElement('div');tools.className = 'catalog-actions';
 const reveal = button('Finder', () => action(() => api.fileAction({key:row.key,action:'reveal'})));reveal.disabled = !row.available;
 tools.append(reveal,button('Copia percorso', () => action(async () => {await api.fileAction({key:row.key,action:'copy'});$('status').textContent = 'Percorso copiato.';})));
 info.append(heading,fields,label,tools);if (!info.matches(':popover-open')) info.showPopover();anchor.setAttribute('aria-expanded','true');positionInfo();close.focus();
}
function markButton(row, field, label) {
 const selected = Boolean(marks(row)[field]);
 const node = iconButton('', () => action(async () => {
  node.disabled = true;
  try {renderPreferences(await api.mark({key:row.key,field,value:!selected}));renderCatalog();($(`${field}-${row.key}`) || $('catalog-filter').querySelector('summary')).focus();}
  finally {node.disabled = false;}
 }), `${label}: ${row.name}`, field, field === 'favorite' ? 'favorite' : 'pin');
 node.id = `${field}-${row.key}`;node.setAttribute('aria-pressed', String(selected));return node;
}
function renderCatalog() {
 closeInfo();
 const options = filterOptions();if (!options.some(([id]) => id === activeFilter)) activeFilter = 'all';
 const menu = $('filter-options'), details = $('catalog-filter');menu.replaceChildren();
 for (const [id,label] of options) {
  const option = button(label, () => {activeFilter = id;titleMatch = null;hideSuggestions();details.open = false;renderCatalog();details.querySelector('summary').focus();});
  option.setAttribute('aria-pressed',String(id === activeFilter));menu.append(option);
 }
 const filterLabel = options.find(([id]) => id === activeFilter)[1];
 details.classList.toggle('active', activeFilter !== 'all');details.querySelector('summary').setAttribute('aria-label', activeFilter === 'all' ? 'Filtri di ricerca' : `Filtro: ${filterLabel}`);
 const rows = filteredRows().filter(row => titleMatch === null || row.key === titleMatch);
 const listing = $('reviews');listing.replaceChildren();$('empty').hidden = Boolean(rows.length);
 $('status').textContent = `${rows.length} ${rows.length === 1 ? 'artefatto' : 'artefatti'}${activeFilter === 'all' ? '' : ` · ${filterLabel}`}`;
 for (const pinned of [true,false]) {
  const group = rows.filter(row => Boolean(marks(row).pinned) === pinned);if (!group.length) continue;
  const section = document.createElement('section'), heading = document.createElement('h2'), entries = document.createElement('ul');
  heading.textContent = pinned ? 'Fissati in alto' : folders().find(folder => folder.id === activeFolder)?.name || 'Altri artefatti';
  entries.className = 'catalog-entries';section.className = 'catalog-group';
  for (const row of group) {
   const item = document.createElement('li'), name = document.createElement('span'), folder = document.createElement('span'), leading = document.createElement('div'), trailing = document.createElement('div');
   item.className = 'catalog-row';name.className = 'catalog-name';folder.className = 'catalog-folder';leading.className = trailing.className = 'catalog-actions';
   name.textContent = row.name;folder.textContent = folders().find(item => item.id === folderOf(row))?.name || 'Senza cartella';
   leading.append(markButton(row,'pinned','Fissa in alto'),markButton(row,'favorite','Preferito'));
   const info = iconButton('?', () => showInfo(row,info), `Informazioni su ${row.name}`);info.id = `info-${row.key}`;info.setAttribute('aria-expanded','false');info.setAttribute('aria-controls','catalog-info');
   const open = iconButton('', () => action(async () => {open.disabled = true;try {await api.openReview(row.key);} finally {open.disabled = !row.available;}}), `${row.available ? 'Apri' : 'File mancante'}: ${row.name}`, 'open', 'open-review');
   open.disabled = !row.available;trailing.append(info,open);item.append(leading,name,folder,trailing);entries.append(item);
  }
  section.append(heading,entries);listing.append(section);
 }
}
async function settings(value) {renderPreferences(await api.preferences(value));renderCatalog();}
async function refresh() {$('status').textContent = 'Caricamento…';reviews = await api.catalog();renderCatalog();}
$('search').addEventListener('input', () => {titleMatch = null;renderCatalog();showSuggestions();});
$('search').addEventListener('focus', showSuggestions);
$('search').addEventListener('blur', hideSuggestions);
$('suggestions').addEventListener('pointerdown', event => event.preventDefault());
$('search').addEventListener('keydown', event => {
 if (event.key === 'Escape' && !$('suggestions').hidden) {event.preventDefault();hideSuggestions();return;}
 if (event.key === 'Enter' && selectedSuggestion >= 0) {event.preventDefault();chooseSuggestion(suggestionKeys[selectedSuggestion]);return;}
 if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
 if ($('suggestions').hidden) showSuggestions();
 if ($('suggestions').hidden) return;
 event.preventDefault();const count = suggestionKeys.length, step = event.key === 'ArrowDown' ? 1 : -1;
 selectedSuggestion = selectedSuggestion < 0 ? (step === 1 ? 0 : count - 1) : (selectedSuggestion + step + count) % count;
 const nodes = [...$('suggestions').children];nodes.forEach((node,i) => node.setAttribute('aria-selected', String(i === selectedSuggestion)));
 $('search').setAttribute('aria-activedescendant',nodes[selectedSuggestion].id);nodes[selectedSuggestion].scrollIntoView({block:'nearest'});
});
function setFolderForm(open) {
 $('folder-form').hidden = !open;$('new-folder').setAttribute('aria-expanded',String(open));
 if (open) {$('folder-name').value = '';$('folder-name').focus();} else $('new-folder').focus();
}
$('new-folder').addEventListener('click', () => setFolderForm($('folder-form').hidden));
$('cancel-folder').addEventListener('click', () => setFolderForm(false));
$('folder-form').addEventListener('submit', event => {event.preventDefault();void action(async () => {renderPreferences(await api.createFolder($('folder-name').value));setFolderForm(false);renderCatalog();});});
$('clear-catalog').addEventListener('click', () => {titleMatch = activeFolder = null;activeFilter = 'all';$('search').value = '';renderFolders();renderCatalog();$('search').focus();});
$('catalog-info').addEventListener('toggle', event => {if (event.newState === 'closed' && !$('catalog-info').matches(':popover-open')) infoAnchor?.setAttribute('aria-expanded','false');});
window.addEventListener('resize', positionInfo);window.addEventListener('scroll', positionInfo,{passive:true});
document.addEventListener('click', event => {const filter = $('catalog-filter');if (filter.open && !filter.contains(event.target)) filter.open = false;});
$('catalog-filter').addEventListener('keydown', event => {if (event.key === 'Escape' && $('catalog-filter').open) {event.preventDefault();$('catalog-filter').open = false;$('catalog-filter').querySelector('summary').focus();}});
$('transparent').addEventListener('click', () => action(() => settings({transparent: !preferences.transparent})));
$('refresh').addEventListener('click', () => action(refresh));
for (const id of ['home', 'index']) $(id).addEventListener('click', () => action(async () => {await api.home();await refresh();}));
for (const id of Object.keys(controlLabels)) $(id).addEventListener('click', () => action(async () => {renderTabs(await api.reviewAction(id));}));
// The local toolbar can hold keyboard focus; preserve annotation shortcuts there too.
let lastOptionTap = -Infinity;
document.addEventListener('keydown', event => {
 const typing = event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
 if (!state.active || typing) {lastOptionTap=-Infinity;return;}
 if ((event.metaKey||event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase()==='i') {event.preventDefault();$('annotate').click();lastOptionTap=-Infinity;return;}
 if (event.code!=='AltRight'||event.metaKey||event.ctrlKey||event.shiftKey) {lastOptionTap=-Infinity;return;}
 if (event.repeat) return;
 if (event.timeStamp-lastOptionTap<=400) {lastOptionTap=-Infinity;$('annotate').click();}
 else lastOptionTap=event.timeStamp;
},true);
api.onChange(renderTabs);void action(async () => {renderTabs(await api.snapshot());await refresh();});
