const api = window.lavishApp;
const $ = id => document.getElementById(id);
let reviews = [], state = {tabs: [], active: null};
let preferences = {layout: 'list', transparent: false, artifactBackground: true, fullscreenImage: null, artifacts: {}};
let imageFile = null, imageRequest = null;
// The chosen image appears only in full screen with transparency, under the same tint.
function renderFullscreenImage(fullscreen) {
 const file = preferences.transparent && fullscreen ? preferences.fullscreenImage : null;
 if (file === imageFile) return;
 imageFile = file;const request = imageRequest = Symbol();
 if (!file) {document.body.style.removeProperty('--fullscreen-image');document.body.classList.remove('fullscreen-image');return;}
 void action(async () => {const url = await api.fullscreenImage();if (request !== imageRequest || !url) return;document.body.style.setProperty('--fullscreen-image', `url("${url}")`);document.body.classList.add('fullscreen-image');}).then(() => {if (request === imageRequest && !document.body.classList.contains('fullscreen-image')) imageFile = null;});
}
function showError(error) {$('error').textContent = error.message || String(error);$('error').hidden = false;}
async function action(fn) {try {$('error').hidden = true;return await fn();}catch (error) {showError(error);}}
function button(text, listener, className = '') {const node = document.createElement('button');node.textContent = text;node.className = className;node.addEventListener('click', listener);return node;}
function renderPreferences(next) {
 if (next) preferences = next;
 document.body.classList.toggle('transparent', preferences.transparent);
 document.body.classList.toggle('transparent-artifacts', preferences.transparent);
 $('transparent').setAttribute('aria-checked', String(preferences.transparent));
 $('layout').setAttribute('aria-pressed', String(preferences.layout === 'grid'));
 $('layout').textContent = preferences.layout === 'grid' ? 'Elenco' : 'Griglia';
 $('reviews').classList.toggle('grid', preferences.layout === 'grid');
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
 state = next;renderReviewControls(next.controls, next.active);renderPreferences(next.preferences);document.body.classList.toggle('fullscreen', Boolean(next.fullscreen));renderFullscreenImage(Boolean(next.fullscreen));document.body.classList.toggle('in-review', Boolean(state.active));$('tabs').replaceChildren();
 for (const tab of state.tabs) {const item = document.createElement('span');item.className = 'tab' + (tab.id === state.active ? ' active' : '');
  const title = button(tab.title, () => action(() => api.select(tab.id)), 'title');title.title = tab.title;
  const close = button('×', () => action(() => api.close(tab.id)), 'close');close.setAttribute('aria-label', 'Ferma la visualizzazione di ' + tab.title);item.append(title, close);$('tabs').append(item);
 }
 renderCatalog();
}
function markButton(row, field, label, activeLabel, glyph) {
 const selected = Boolean(preferences.artifacts[row.file]?.[field]);
 const node = button(glyph, () => action(async () => {
  node.disabled = true;
  try {renderPreferences(await api.mark({key: row.key, field, value: !selected}));renderCatalog();}
  finally {node.disabled = false;}
 }), field === 'favorite' ? 'favorite' : 'pin');
 node.setAttribute('aria-pressed', String(selected));node.setAttribute('aria-label', (selected ? activeLabel : label) + ': ' + row.name);node.title = selected ? activeLabel : label;
 return node;
}
function renderCatalog() {
 const query = $('search').value.trim().toLocaleLowerCase(), filter = $('filter').value, collection = $('collection').value;
 const marks = row => preferences.artifacts[row.file] || {};
 const rows = reviews.filter(row => (!query || (row.name + ' ' + row.file).toLocaleLowerCase().includes(query)) && (filter === 'all' || row.status === filter) && (collection === 'all' || marks(row)[collection === 'favorites' ? 'favorite' : 'pinned']))
  .sort((a,b) => Number(Boolean(marks(b).pinned)) - Number(Boolean(marks(a).pinned)));
 $('reviews').replaceChildren();$('empty').hidden = Boolean(rows.length);$('status').textContent = `${rows.length} ${rows.length === 1 ? 'artefatto' : 'artefatti'}`;
 for (const row of rows) {const card = document.createElement('article');card.className = 'review ' + row.status + (row.available ? '' : ' missing') + (marks(row).pinned ? ' pinned' : '');const detail = document.createElement('div');detail.className = 'review-detail';
  const name = document.createElement('h2');name.textContent = row.name;name.title = row.name;
  const file = document.createElement('p');file.className = 'path';file.textContent = row.file;file.title = row.file;
  const meta = document.createElement('p');meta.className = 'meta';const badge = document.createElement('span');badge.className = 'badge';badge.textContent = !row.available ? 'File non disponibile' : row.status === 'ended' ? 'Concluso' : 'Attivo';meta.append(badge);
  const date = new Date(row.updatedAt);if (!Number.isNaN(date.valueOf())) meta.append(document.createTextNode(date.toLocaleString('it-IT', {dateStyle:'medium',timeStyle:'short'})));
  detail.append(name, file, meta);
  const open = button(row.status === 'ended' ? 'Apri / riapri' : 'Apri', () => action(async () => {open.disabled = true;try {await api.openReview(row.key);}finally {open.disabled = !row.available;}}), 'open-review');open.disabled = !row.available;
  const actions = document.createElement('div');actions.className = 'review-actions';
  const reveal = button('Finder', () => action(() => api.fileAction({key: row.key, action: 'reveal'})), 'reveal');reveal.disabled = !row.available;reveal.title = 'Mostra il file nel Finder';reveal.setAttribute('aria-label', 'Mostra nel Finder: ' + row.name);
  const copy = button('Copia percorso', () => action(async () => {await api.fileAction({key: row.key, action: 'copy'});$('status').textContent = 'Percorso copiato: ' + row.file;}), 'copy-path');
  actions.append(markButton(row, 'favorite', 'Aggiungi ai preferiti', 'Rimuovi dai preferiti', '★'), markButton(row, 'pinned', 'Pinna in cima', 'Rimuovi pin', '◆'), reveal, copy);
  card.append(detail, open, actions);$('reviews').append(card);
 }
}
async function settings(value) {renderPreferences(await api.preferences(value));renderCatalog();}
async function refresh() {$('status').textContent = 'Caricamento…';reviews = await api.catalog();renderCatalog();}
$('search').addEventListener('input', renderCatalog);$('filter').addEventListener('change', renderCatalog);$('collection').addEventListener('change', renderCatalog);
$('layout').addEventListener('click', () => action(() => settings({layout: preferences.layout === 'grid' ? 'list' : 'grid'})));
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
