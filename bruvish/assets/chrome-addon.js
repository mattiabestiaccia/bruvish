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
        if (MODES.includes(saved) && matchMedia('(pointer: fine)').matches)
            mode = saved;
    }
    catch { }
    let token = '', theme = 'dark', contentZoom = 1, storageKey = '', storageAvailable = false, record = { fields: {}, conflicts: [] }, outlineItems = [];
    // Frame style from the approved frame mock-up: page fonts, BRUVISH mark, icon switches, Italian panel.
    const root = document.documentElement;
    if (document.head) {
        const fonts = document.createElement('link');
        fonts.rel = 'stylesheet';
        fonts.href = '/mb-catalog-fonts.css';
        document.head.append(fonts);
    }
    const brand = document.querySelector('.brand-mark');
    if (brand)
        brand.textContent = 'BRUVISH';
    // Top left, before the mark: the arrow back to the artifacts index (the catalog home, served at /).
    const brandBox = document.querySelector('.brand');
    if (brandBox) {
        const index = document.createElement('a');
        index.className = 'mb-index';
        index.href = '/';
        index.textContent = '←';
        index.setAttribute('aria-label', 'Indice degli artefatti');
        index.setAttribute('title', 'Indice degli artefatti');
        brandBox.before(index);
    }
    const panelTitle = document.querySelector('.panel h2'), sendLabel = document.getElementById('send'), endLabel = document.querySelector('#sendAndEnd span'), chatField = document.getElementById('chatInput');
    if (panelTitle)
        panelTitle.textContent = 'Conversazione';
    if (sendLabel)
        sendLabel.textContent = 'Invia all’agente';
    if (endLabel)
        endLabel.textContent = 'Invia e chiudi';
    if (chatField)
        chatField.placeholder = 'Scrivi all’agente…';
    const SVG = 'http://www.w3.org/2000/svg';
    const PENCIL = [['path', { d: 'M10.4 2.8l2.8 2.8-7.5 7.5-3.4.6.6-3.4z' }], ['path', { d: 'M8.9 4.3l2.8 2.8' }]];
    const CHECK_IN_CIRCLE = [['circle', { cx: '8', cy: '8', r: '5.7' }], ['path', { d: 'M5.4 8.1l1.8 1.8 3.4-3.6' }]];
    function icon(shapes) { const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); for (const [tag, attributes] of shapes) {
        const shape = document.createElementNS(SVG, tag);
        for (const [name, value] of Object.entries(attributes))
            shape.setAttribute(name, value);
        svg.append(shape);
    } return svg; }
    // A switch with no visible label: track and knob, the meaning drawn in the knob.
    function iconSwitch(button, label, shapes) {
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-label', label);
        let track = button.querySelector('.switch-track');
        for (const child of [...button.childNodes])
            if (child !== track)
                child.remove();
        if (!track) {
            track = document.createElement('span');
            track.className = 'switch-track';
            track.setAttribute('aria-hidden', 'true');
            button.append(track);
        }
        const knob = document.createElement('span');
        knob.className = 'switch-knob';
        knob.append(icon(shapes));
        track.replaceChildren(knob);
    }
    // Annotate: upstream keeps driving the button (click, aria-pressed); the state is mirrored to aria-checked.
    const annotate = document.getElementById('annotation');
    if (annotate) {
        const hotkey = /\(([^)]*)\)/.exec(annotate.getAttribute('title') || '')?.[1];
        iconSwitch(annotate, 'Annota', PENCIL);
        annotate.setAttribute('title', 'Annota · doppio tocco di ⌥ destro' + (hotkey ? ' · ' + hotkey : ''));
        const mirror = () => { const pressed = annotate.getAttribute('aria-pressed'); if (pressed === null)
            return; annotate.setAttribute('aria-checked', String(pressed === 'true')); annotate.removeAttribute('aria-pressed'); };
        mirror();
        new MutationObserver(mirror).observe(annotate, { attributes: true, attributeFilter: ['aria-pressed'] });
    }
    // Closed cards (answered and not new) are hidden by default; the switch shows them. Only shown while the
    // artifact has both closed and open cards (bridge.js never hides every card).
    let showClosed = false;
    const closedSwitch = document.createElement('button');
    closedSwitch.type = 'button';
    closedSwitch.className = 'mb-closed-switch';
    closedSwitch.hidden = true;
    iconSwitch(closedSwitch, 'Anche le carte chiuse', CHECK_IN_CIRCLE);
    closedSwitch.setAttribute('aria-checked', 'false');
    closedSwitch.setAttribute('title', 'Anche le chiuse');
    function setShowClosed(value) { showClosed = value; closedSwitch.setAttribute('aria-checked', String(showClosed)); send('closed', { show: showClosed }); }
    closedSwitch.addEventListener('click', () => setShowClosed(!showClosed));
    annotate?.before(closedSwitch);
    // Annotation mode also toggles with a double tap of the right Option key: two presses within
    // DOUBLE_TAP_MS, no other key in between, never while typing in a text field. bridge.js does the
    // same inside the artifact, where the keys go while it has focus.
    const DOUBLE_TAP_MS = 400;
    let lastTap = -Infinity;
    function typing(el) { while (el?.shadowRoot?.activeElement)
        el = el.shadowRoot.activeElement; if (!el)
        return false; if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
        return true; return el.tagName === 'INPUT' && !['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'].includes(el.type); }
    document.addEventListener('keydown', event => {
        if (event.code !== 'AltRight' || event.ctrlKey || event.metaKey || event.shiftKey || typing(document.activeElement)) {
            lastTap = -Infinity;
            return;
        }
        if (event.repeat)
            return;
        if (event.timeStamp - lastTap <= DOUBLE_TAP_MS) {
            lastTap = -Infinity;
            annotate?.click();
        }
        else
            lastTap = event.timeStamp;
    }, true);
    const PALETTE = ['card', 'line', 'ink', 'muted', 'title', 'field'];
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
    // The panel only appears while it has something to say: a draft notice or conflicting drafts.
    const conflictButton = button('Bozze in conflitto', showConflicts);
    conflictButton.hidden = true;
    tools.append(note);
    tools.hidden = true;
    function refreshTools() { tools.hidden = conflictButton.hidden && !note.textContent; }
    function persist() { if (!storageAvailable)
        return; try {
        localStorage.setItem(storageKey, JSON.stringify({ theme, zoom: contentZoom, ...record }));
    }
    catch {
        storageAvailable = false;
        note.textContent = 'Bozze non persistenti in questo browser';
        refreshTools();
    } }
    function setTheme(value) { theme = value; send('theme', { theme }); persist(); }
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
        // A hidden closed card is a dimmed dot; choosing it shows the closed cards, then goes there.
        if (item.closed && item.hidden)
            b.classList.add('mb-closed');
        b.addEventListener('click', () => { if (b.classList.contains('mb-closed'))
            setShowClosed(true); send('reveal', { id: item.id }); });
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
            send('closed', { show: showClosed });
        }
        if (m.type === 'lavish-mb:annotate-toggle')
            annotate?.click();
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
            // Bar and panel take the theme family of the artifact only when it reports all six colours; otherwise theme B, never a mix.
            if (root) {
                const palette = m.palette && typeof m.palette === 'object' ? m.palette : {};
                const complete = PALETTE.every(name => typeof palette[name] === 'string' && palette[name] && CSS.supports('color', palette[name]));
                for (const name of PALETTE)
                    if (complete)
                        root.style.setProperty('--mb-' + name, palette[name]);
                    else
                        root.style.removeProperty('--mb-' + name);
            }
            closedSwitch.hidden = !(Number(m.closed) > 0 && Number(m.open) > 0);
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
            refreshTools();
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
    } setTheme(theme); hello(); }).catch(() => { note.textContent = 'Identità server non verificata: bozze solo in memoria'; storageKey = 'memory'; setTheme('dark'); hello(); refreshTools(); });
})();
