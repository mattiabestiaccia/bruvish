const search = document.getElementById('search');
const filter = document.getElementById('filter');
const rows = [...document.querySelectorAll('.review')];
function refresh() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  for (const row of rows) {
    const matches = row.querySelector('h2').textContent.toLocaleLowerCase().includes(query)
      && (filter.value === 'all' || row.dataset.status === filter.value);
    row.hidden = !matches;
    if (matches) count++;
  }
  document.getElementById('status').textContent = `${count} ${count === 1 ? 'artefatto' : 'artefatti'}`;
  document.getElementById('empty').hidden = count > 0;
}
search.addEventListener('input', refresh);
filter.addEventListener('change', refresh);
