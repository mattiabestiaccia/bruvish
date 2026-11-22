const search = document.getElementById('search'), menu = document.getElementById('filter-menu');
const suggestions = document.getElementById('suggestions'), folders = document.getElementById('folders');
const rows = [...document.querySelectorAll('.review')], groups = [...document.querySelectorAll('.group')];
let filter = 'all', folder = '', selected = -1, exact = null, candidates = [];
const title = row => row.querySelector('h2').textContent;
const normal = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
function refresh() {
  const terms = normal(search.value).trim().split(/\s+/).filter(Boolean);
  const matched = rows.filter(row => (!folder || row.dataset.folder === folder) && terms.every(term => normal(title(row)).includes(term)) && (
    filter === 'all' || (filter.startsWith('profile:') ? row.dataset.profile === filter.slice(8) : filter === 'favorite' || filter === 'pinned' ? row.dataset[filter] === 'true' : row.dataset.status === filter)));
  const visible = new Set(matched.filter(row => exact === null || row === exact));
  for (const row of rows) row.hidden = !visible.has(row);
  for (const group of groups) group.hidden = !group.querySelector('.review:not([hidden])');
  document.getElementById('status').textContent = `${visible.size} ${visible.size === 1 ? 'artefatto' : 'artefatti'}`;
  document.getElementById('empty').hidden = visible.size > 0;
  return matched;
}
function hide() {
  suggestions.hidden = true;selected = -1;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');
}
function choose(row) {search.value = title(row);exact = row;hide();refresh();}
function suggest() {
  candidates = refresh().slice(0,12);hide();suggestions.replaceChildren();
  if (!search.value.trim() || exact || !candidates.length) return;
  candidates.forEach((row,index) => {
    const option = document.createElement('li');option.textContent = title(row);option.id = `result-${index}`;
    option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.addEventListener('click',() => choose(row));suggestions.append(option);
  });
  suggestions.hidden = false;search.setAttribute('aria-expanded','true');
}
search.addEventListener('input', () => {exact = null;suggest();});
search.addEventListener('focus',suggest);search.addEventListener('blur',hide);
suggestions.addEventListener('pointerdown',event => event.preventDefault());
search.addEventListener('keydown',event => {
  if (event.key === 'Escape' && !suggestions.hidden) {event.preventDefault();hide();return;}
  if (event.key === 'Enter' && selected >= 0) {event.preventDefault();choose(candidates[selected]);return;}
  if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
  if (suggestions.hidden) suggest();
  if (suggestions.hidden) return;
  event.preventDefault();const count = candidates.length, step = event.key === 'ArrowDown' ? 1 : -1;
  selected = selected < 0 ? (step === 1 ? 0 : count - 1) : (selected + step + count) % count;
  [...suggestions.children].forEach((option,index) => option.setAttribute('aria-selected',String(index === selected)));
  const option = suggestions.children[selected];search.setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});
});
function select(parent,attribute,button) {for (const option of parent.querySelectorAll(attribute)) option.setAttribute('aria-pressed',String(option === button));}
const summary = menu.querySelector('summary');
menu.addEventListener('click',event => {
  const button = event.target.closest('button[data-filter]');if (!button) return;
  filter = button.dataset.filter;exact = null;select(menu,'[data-filter]',button);menu.open = false;summary.focus();
  summary.setAttribute('aria-label',filter === 'all' ? 'Filtri di ricerca' : `Filtro: ${button.textContent}`);summary.classList.toggle('active',filter !== 'all');refresh();
});
menu.addEventListener('keydown',event => {if (event.key === 'Escape' && menu.open) {event.preventDefault();menu.open = false;summary.focus();}});
document.addEventListener('click',event => {if (menu.open && !menu.contains(event.target)) menu.open = false;});
folders?.addEventListener('click',event => {
  const button = event.target.closest('button[data-folder]');if (!button) return;
  folder = button.dataset.folder;exact = null;select(folders,'[data-folder]',button);refresh();
});
