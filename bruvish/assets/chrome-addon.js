/* Extends upstream chrome; no Markdown parser and no native browser launch. */
(() => {
    const iframe = document.getElementById('artifact');
    if (!iframe)
        return;
    // Backdrop mode chosen in an artifact (dark/transparent), remembered for every artifact on this device.
    const MODE_KEY = 'lavish-mb:mode', MODES = ['dark', 'transparent'];
    let mode = null;
    try {
        const saved = localStorage.getItem(MODE_KEY);
        if (MODES.includes(saved))
            mode = saved;
    }
    catch { }
    let token = '', theme = 'dark', contentZoom = 1, storageKey = '', storageAvailable = false, record = { fields: {}, conflicts: [] }, outlineItems = [];
    const rail = document.createElement('nav');
    rail.className = 'mb-rail';
    rail.setAttribute('aria-label', 'Indice delle schede');
    // The minimap is the only position cue: the current line is longer, no separate scroll cursor.
    document.body.append(rail);
    const tools = document.createElement('div');
    tools.className = 'mb-tools';
    const note = document.createElement('span');
    note.className = 'mb-draft-note';
    note.setAttribute('role', 'status');
    document.body.append(tools);
    const send = (type, data = {}) => { if (token)
        iframe.contentWindow?.postMessage({ type: 'lavish-mb:' + type, version: 1, token, ...data }, '*'); };
    function button(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); tools.append(b); return b; }
    const light = button('Chiaro', () => setTheme('light')), dark = button('Scuro', () => setTheme('dark'));
    button('A−', () => setZoom(contentZoom - .1));
    button('A+', () => setZoom(contentZoom + .1));
    button('100%', () => setZoom(1));
    const conflictButton = button('Bozze in conflitto', showConflicts);
    conflictButton.hidden = true;
    tools.append(note);
    function persist() { if (!storageAvailable)
        return; try {
        localStorage.setItem(storageKey, JSON.stringify({ theme, zoom: contentZoom, ...record }));
    }
    catch {
        storageAvailable = false;
        note.textContent = 'Bozze non persistenti in questo browser';
    } }
    function setTheme(value) { theme = value; light.setAttribute('aria-pressed', theme === 'light'); dark.setAttribute('aria-pressed', theme === 'dark'); send('theme', { theme }); persist(); }
    function setZoom(value) { contentZoom = Math.max(.6, Math.min(2.5, Math.round(value * 10) / 10)); send('zoom', { zoom: contentZoom }); persist(); }
    function hello() { token = crypto.randomUUID(); send('hello'); }
    function renderOutline() { rail.replaceChildren(); for (const item of outlineItems) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.state = ['waiting', 'answered', 'info', 'blocked'].includes(item.state) ? item.state : 'info';
        b.title = item.title;
        b.setAttribute('aria-label', 'Vai a ' + item.title + (item.state === 'waiting' ? ', in attesa di risposta' : '') + (item.fresh === 'new' ? ', nuova' : item.fresh === 'changed' ? ', modificata' : ''));
        b.dataset.target = item.id;
        // New or changed cards pulse in the minimap as they do in the page.
        if (item.fresh === 'new' || item.fresh === 'changed')
            b.classList.add('mb-new');
        const line = document.createElement('i');
        if (typeof item.color === 'string' && CSS.supports('color', item.color)) line.style.backgroundColor = item.color;
        b.append(line);
        b.addEventListener('click', () => send('reveal', { id: item.id }));
        rail.append(b);
    } }
    function showConflicts() { document.querySelector('.mb-conflict-dialog')?.remove(); const dialog = document.createElement('section'); dialog.className = 'mb-conflict-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Bozze e documento aggiornato'); const title = document.createElement('h3'); title.textContent = 'Il documento è cambiato: scegli come trattare queste bozze'; dialog.append(title); for (const id of record.conflicts || []) {
        const row = document.createElement('div'), label = document.createElement('strong'), value = document.createElement('pre');
        row.dataset.field = id;
        label.textContent = id;
        value.textContent = String(record.fields?.[id]?.value ?? '');
        row.append(label, value);
        for (const [text, restore] of [['Ripristina bozza', true], ['Mantieni documento', false]]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.onclick = () => { send('resolve-draft', { id, restore }); row.remove(); };
            row.append(b);
        }
        dialog.append(row);
    } const close = document.createElement('button'); close.textContent = 'Chiudi'; close.onclick = () => dialog.remove(); dialog.append(close); document.body.append(dialog); }
    addEventListener('message', event => {
        if (event.source !== iframe.contentWindow)
            return;
        const m = event.data || {};
        if (m.token !== token || m.version !== 1)
            return;
        if (m.type === 'lavish-mb:ready') {
            send('restore', { fields: record.fields || {} });
            send('theme', { theme });
            send('zoom', { zoom: contentZoom });
            if (mode)
                send('mode', { mode });
        }
        if (m.type === 'lavish-mb:mode' && MODES.includes(m.mode)) {
            mode = m.mode;
            try {
                localStorage.setItem(MODE_KEY, mode);
            }
            catch { }
        }
        if (m.type === 'lavish-mb:outline' && Array.isArray(m.items)) {
            outlineItems = m.items.filter(i => typeof i.id === 'string' && typeof i.title === 'string').slice(0, 400);
            if (typeof m.accent === 'string' && m.accent && CSS.supports('color', m.accent))
                rail.style.setProperty('--mb-accent', m.accent);
            renderOutline();
        }
        if (m.type === 'lavish-mb:position') {
            for (const b of rail.children)
                b.classList.toggle('current', b.dataset.target === m.current);
        }
        if (m.type === 'lavish-mb:draft' && m.fields && typeof m.fields === 'object') {
            record = { fields: m.fields, conflicts: Array.isArray(m.conflicts) ? m.conflicts : [] };
            persist();
            const n = Object.keys(record.fields).length;
            note.textContent = storageAvailable ? (n ? 'Bozza salvata su questo browser' : '') : 'Bozze non persistenti in questo browser';
            conflictButton.hidden = !record.conflicts.length;
            conflictButton.textContent = 'Bozze in conflitto (' + record.conflicts.length + ')';
        }
        if (m.type === 'lavish-mb:zoom-request')
            setZoom(m.reset ? 1 : contentZoom + (Number(m.delta) || 0));
    });
    iframe.addEventListener('load', () => { if (storageKey)
        hello(); });
    document.addEventListener('keydown', event => { if (!(event.metaKey || event.ctrlKey) || event.altKey)
        return; if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        setZoom(event.key === '0' ? 1 : contentZoom + (event.key === '-' ? -.1 : .1));
    } }, true);
    // Reuse upstream's native reveal/collapse implementation when new replies arrive.
    const originalNote = typeof noteAgentReply === 'function' ? noteAgentReply : null;
    if (originalNote)
        noteAgentReply = function (text) { originalNote(text); if (typeof revealConversation === 'function')
            revealConversation(); };
    fetch('/health').then(r => r.json()).then(health => { if (typeof health.state_id !== 'string')
        throw new Error('missing state identity'); const session = JSON.parse(document.getElementById('lavish-session')?.textContent || '{}'); storageKey = 'lavish-mb:v1:' + JSON.stringify([location.origin, health.state_id, session.key, session.file]); try {
        const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (value && typeof value === 'object') {
            record = { fields: value.fields || {}, conflicts: value.conflicts || [] };
            theme = value.theme === 'light' ? 'light' : 'dark';
            contentZoom = Number.isFinite(value.zoom) ? value.zoom : 1;
        }
        storageAvailable = true;
    }
    catch {
        storageAvailable = false;
    } setTheme(theme); hello(); }).catch(() => { note.textContent = 'Identità server non verificata: bozze solo in memoria'; storageKey = 'memory'; setTheme('dark'); hello(); });
})();
