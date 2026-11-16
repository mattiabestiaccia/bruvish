const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

// The app's catalog supplies registered files and ordering. The web view exposes
// only names, dates and opaque session identifiers, never local absolute paths.
export function renderCatalog(reviews) {
  const counts = new Map();
  for (const row of reviews) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  const cards = reviews.map(row => {
    const status = !row.available ? 'missing' : row.status;
    const label = status === 'missing' ? 'File non disponibile' : status === 'ended' ? 'Concluso' : 'Attivo';
    const date = new Date(row.updatedAt);
    const time = Number.isNaN(date.valueOf()) ? '' : `<time datetime="${escape(row.updatedAt)}">${escape(date.toLocaleString('it-IT', {dateStyle: 'medium', timeStyle: 'short'}))}</time>`;
    const duplicate = counts.get(row.name) > 1 ? `<span class="identifier">${escape(row.key.slice(0, 8))}</span>` : '';
    const action = row.available
      ? `<a href="/session/${escape(row.key)}">${status === 'ended' ? 'Consulta' : 'Apri'}</a>`
      : '<span class="unavailable">Non disponibile</span>';
    return `<article class="review ${status}" data-status="${status}"><div class="details"><h2>${escape(row.name)}</h2><p class="meta"><span class="badge">${label}</span>${time}${duplicate}</p></div>${action}</article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="lavish-mb-catalog" content="1"><title>I tuoi Lavish</title><link rel="stylesheet" href="/mb-catalog-fonts.css"><link rel="stylesheet" href="/mb-catalog.css"><script defer src="/mb-catalog.js"></script></head>
<body><header><span class="brand">Lavish</span><a class="refresh" href="/">Aggiorna</a></header><main>
<p class="eyebrow">Il tuo spazio di revisione</p><h1>I tuoi Lavish</h1><p class="intro">Scegli un artefatto. I più recenti sono in alto.</p>
<div class="filters"><label class="search">Cerca<input type="search" id="search" placeholder="Nome dell’artefatto" autocomplete="off"></label><label>Mostra<select id="filter"><option value="all">Tutti</option><option value="active">Attivi</option><option value="ended">Conclusi</option></select></label></div>
<p id="status" role="status">${reviews.length} ${reviews.length === 1 ? 'artefatto' : 'artefatti'}</p><section id="reviews" aria-label="Artefatti Lavish">${cards}</section><p id="empty"${reviews.length ? ' hidden' : ''}>Nessun Lavish trovato.</p>
<footer>Salva questo indirizzo nei preferiti o nella schermata Home del telefono. Il Mac, Lavish e Tailscale devono essere attivi. Le review concluse si aprono in sola lettura.</footer>
</main></body></html>`;
}
