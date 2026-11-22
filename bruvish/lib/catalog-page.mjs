const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const filterIcon = icon('M3 5h18l-7 8v5l-4 2v-7z');
const openIcon = icon('M4 12h15m-6-6 6 6-6 6');

// The web catalog mirrors the desktop organization read-only. Filesystem paths
// and agent session IDs stay in the app; no web action can change local state.
export function renderCatalog(reviews, {folders = [], folderAssignments = {}, artifacts = {}} = {}) {
  const profileOptions = [...new Set(reviews.map(row => row.metadata?.profile).filter(Boolean))].sort();
  const filters = [['all', 'Tutti gli artefatti'], ['favorite','Solo preferiti'], ['pinned','Solo fissati'], ['active','Review non concluse'], ['ended','Review concluse'], ['missing','File mancanti'], ...profileOptions.map(profile => [`profile:${profile}`, `Ultimo profilo: ${profile}`])];
  const names = new Map(folders.map(folder => [folder.id, folder.name]));
  const marks = row => artifacts[row.file] || {};
  const counts = new Map();
  for (const row of reviews) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  const cards = pinned => reviews.filter(row => Boolean(marks(row).pinned) === pinned).map(row => {
    const status = !row.available ? 'missing' : row.status;
    const stateLabel = status === 'missing' ? 'File non disponibile' : status === 'ended' ? 'Conclusa' : 'Non conclusa';
    const id = folderAssignments[row.file] || '', name = names.get(id) || 'Senza cartella';
    const date = new Date(row.metadata?.workedAt ?? '');
    const worked = Number.isNaN(date.valueOf()) ? 'Non disponibile' : date.toLocaleString('it-IT', {dateStyle: 'medium', timeStyle: 'short'});
    const action = row.available
      ? `<a class="icon" href="/session/${escape(row.key)}" aria-label="${status === 'ended' ? 'Consulta' : 'Apri'} ${escape(row.name)}">${openIcon}</a>`
      : '<span class="icon disabled" title="File non disponibile">' + openIcon + '</span>';
    const favorite = Boolean(marks(row).favorite);
    const identifier = counts.get(row.name) > 1 ? `<span class="identifier">${escape(row.key.slice(0, 8))}</span>` : '';
    const indicators = `<span class="marks">${pinned ? '<span role="img" aria-label="Fissato">' + icon('M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v6') + '</span>' : ''}${favorite ? '<span role="img" aria-label="Preferito">' + icon('m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z') + '</span>' : ''}</span>`;
    return `<article class="review ${status}" data-status="${status}" data-folder="${escape(id)}" data-pinned="${pinned}" data-favorite="${favorite}" data-profile="${escape(row.metadata?.profile || '')}">${indicators}<div class="title"><h2>${escape(row.name)}</h2>${identifier}</div><span class="folder">${escape(name)}</span><div class="actions"><button type="button" class="icon" popovertarget="info-${escape(row.key)}" aria-label="Informazioni su ${escape(row.name)}">?</button>${action}</div><aside popover id="info-${escape(row.key)}" aria-label="Informazioni su ${escape(row.name)}"><h3>${escape(row.name)}</h3><dl><dt>Ultimo lavoro</dt><dd>${escape(worked)}</dd><dt>Agente</dt><dd>${escape(row.metadata?.agent || 'Non disponibile')}</dd><dt>Profilo</dt><dd>${escape(row.metadata?.profile || 'Non disponibile')}</dd><dt>Review Lavish</dt><dd>${stateLabel}</dd></dl></aside></article>`;
  }).join('\n');
  const groups = [[true, 'Fissati in alto'], [false, 'Altri artefatti']].map(([pin,title]) => {
    const rows = cards(pin);
    return rows ? `<section class="group" aria-label="${title}"><h2>${title}</h2><div class="entries">${rows}</div></section>` : '';
  }).join('\n');
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="lavish-mb-catalog" content="1"><title>I tuoi Lavish</title><link rel="stylesheet" href="/mb-catalog-fonts.css"><link rel="stylesheet" href="/mb-catalog.css"><script defer src="/mb-catalog.js"></script></head>
<body><header><span class="brand">Bruvish</span><a class="refresh" href="/">Aggiorna</a></header><main>
<h1>I tuoi Lavish</h1><p class="intro">Ritrova un artefatto. Le review concluse si aprono in sola lettura.</p>
<div class="filters"><div class="search"><label for="search">Cerca nel titolo</label><input type="search" id="search" placeholder="Inizia a digitare" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions"><ul hidden id="suggestions" role="listbox" aria-label="Titoli trovati"></ul></div><details id="filter-menu"><summary class="icon" aria-label="Filtri di ricerca">${filterIcon}</summary><div class="options">${filters.map(([id,label]) => `<button type="button" data-filter="${escape(id)}" aria-pressed="${id === 'all'}">${escape(label)}</button>`).join('')}</div></details></div>
${folders.length ? `<nav id="folders" aria-label="Cartelle"><button type="button" data-folder="" aria-pressed="true">Tutti</button>${folders.map(folder => `<button type="button" data-folder="${escape(folder.id)}" aria-pressed="false">${escape(folder.name)}</button>`).join('')}</nav>` : ''}
<p id="status" role="status">${reviews.length} ${reviews.length === 1 ? 'artefatto' : 'artefatti'}</p><div id="reviews" aria-label="Artefatti Lavish">${groups}</div><p id="empty"${reviews.length ? ' hidden' : ''}>Nessun Lavish trovato.</p>
<footer>Cartelle e contrassegni si modificano nell’app Mac. Il Mac, Lavish e Tailscale devono essere attivi per aprire l’indice dal telefono.</footer>
</main></body></html>`;
}
