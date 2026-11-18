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
    // The other official texts of bar, panel and the ended card, in Italian, also when the official code writes them
    // later. Exact strings only; the reader's and the agent's own words (messages, drafts, anchors, paths) are never touched.
    const UNSENT_STAY = 'Le risposte non inviate restano nella scheda o nella finestra in cui le hai scritte: continuare da un’altra finestra non le porta con sé.';
    const ITALIAN = new Map([
        ['Attach images', 'Allega immagini'], ['Queued', 'In coda'], ['Sending\u2026', 'Invio…'],
        ['Edit queued prompt', 'Modifica il messaggio in coda'], ['Remove queued prompt', 'Togli il messaggio in coda'],
        ['Your agent is not listening. If this persists, ask your agent to poll for updates from Lavish.', 'L’agente non è in ascolto. Se continua, chiedigli di tornare ad ascoltare Lavish.'],
        ['This review is open in another Lavish tab. Unsent answers stay in the tab or window where you entered them; taking over in another window does not bring them along.', 'Questa revisione è aperta in un’altra scheda di Lavish. ' + UNSENT_STAY],
        ['Take over here', 'Continua qui'],
        ['Nothing queued in this tab. Unsent answers stay in the tab or window where you entered them; taking over in another window does not bring them along.', 'Niente in coda in questa scheda. ' + UNSENT_STAY],
        ['Nothing to send. To end without feedback, use End session in the More menu (⋮).', 'Niente da inviare. Per chiudere senza riscontro, usa «Chiudi la sessione» nel menu Altro (⋮).'],
        ['Still trying to send. Your feedback is saved in this tab. Keep this tab open while Lavish catches up, and check that the server is running.', 'Sto ancora provando a inviare. Il riscontro è salvato in questa scheda: tienila aperta mentre Lavish recupera e controlla che il server sia acceso.'],
        ['Could not send. Your feedback is still queued in this tab. Check that Lavish is running, then click Send to Agent to retry.', 'Invio non riuscito. Il riscontro è ancora in coda in questa scheda. Controlla che Lavish sia acceso, poi premi «Invia all’agente» per riprovare.'],
        ['Could not send. Your terminal feedback is still queued in this tab. Check that Lavish is running, then click Send & End to retry the same batch.', 'Invio non riuscito. Il riscontro finale è ancora in coda in questa scheda. Controlla che Lavish sia acceso, poi premi «Invia e chiudi» per riprovare lo stesso invio.'],
        ['No agent is listening', 'Nessun agente in ascolto'], ['Delivering', 'In consegna'], ['Agent is busy; delivered on its next poll', 'L’agente è occupato: lo riceverà al prossimo ascolto'],
        ['Unsent annotation', 'Annotazione non inviata'],
        ['The artifact removed or replaced what this note was attached to, so Lavish could not keep it open. Your text is kept here:', 'L’artefatto ha tolto o sostituito ciò a cui era legata questa nota, quindi Lavish non ha potuto tenerla aperta. Il tuo testo resta qui:'],
        ['Image expired', 'Immagine scaduta'],
        ['Session ended', 'Sessione chiusa'], ['Agent is working…', 'L’agente sta lavorando…'], ['External listener active', 'Ascolto esterno attivo'], ['Agent listening', 'Agente in ascolto'], ['Agent not listening', 'Agente non in ascolto'],
        ['Session ended.', 'Sessione chiusa.'], ['Return to your agent to continue.', 'Torna all’agente per continuare.'],
        ['Revisions', 'Revisioni'], ['Layout issues', 'Problemi di impaginazione'], ['Select all', 'Seleziona tutto'], ['Queue selected fixes', 'Accoda le correzioni scelte'],
        ['Queueing sends a repair request with your next feedback. An issue is marked resolved only after a newer artifact load and a complete check at the same viewport no longer finds it.', 'Accodare manda una richiesta di correzione con il prossimo riscontro. Un problema risulta risolto solo quando, dopo un nuovo caricamento dell’artefatto, un controllo completo alla stessa larghezza non lo trova più.'],
        ['The agent declares these in the artifact itself. Reveal flashes the next block it marked for that revision; nothing about the page is restyled, so the saved file still looks the way it does here.', 'Le dichiara l’agente nell’artefatto. «Mostra» fa lampeggiare il blocco successivo che ha segnato per quella revisione; la pagina non viene ristilizzata, quindi il file salvato resta come lo vedi qui.'],
        ['Reveal', 'Mostra'], ['Dismiss', 'Ignora'], ['No unresolved layout issues.', 'Nessun problema di impaginazione aperto.'],
        ['More', 'Altro'], ['Editing', 'In modifica'], ['Copy', 'Copia'], ['Copied', 'Copiato'], ['Reload artifact', 'Ricarica l’artefatto'], ['Copy DOM snapshot', 'Copia l’istantanea del DOM'],
        ['Export standalone HTML', 'Esporta HTML autonomo'], ['Publish link', 'Pubblica un link'], ['End session', 'Chiudi la sessione'],
        ['Cancel', 'Annulla'], ['Save', 'Salva'], ['None selected', 'Nessuno scelto'],
        ['This browser refused to store it, so copy it before you reload this page.', 'Questo browser non ha voluto salvarlo: copialo prima di ricaricare la pagina.'],
        ['The Lavish server this page was connected to is no longer running. Reloading will work once it is running again.', 'Il server di Lavish a cui era collegata questa pagina non è più acceso. Il ricaricamento funzionerà quando sarà di nuovo acceso.'],
        ['Lavish was updated. This page is running the previous version.', 'Lavish è stato aggiornato. Questa pagina usa ancora la versione precedente.'],
        ['Lavish was restarted to pick up a local build. This page is running the copy the previous server sent.', 'Lavish è stato riavviato con una build locale. Questa pagina usa la copia mandata dal server precedente.'],
        ['Lavish was stopped. Reload after you start it again.', 'Lavish è stato fermato. Ricarica dopo averlo riavviato.'],
        ['Lavish is still not running. Start it again, then use Check and reload.', 'Lavish non è ancora acceso. Riavvialo, poi usa «Controlla e ricarica».'],
        ['Lavish did not answer the check, so this page cannot tell whether it is running. Try again in a moment.', 'Lavish non ha risposto al controllo, quindi questa pagina non sa se è acceso. Riprova fra un momento.'],
        ['Check and reload', 'Controlla e ricarica'],
        ['Working...', 'L’agente sta lavorando…'], ['Exporting...', 'Esportazione…'], ['Export failed - retry', 'Esportazione non riuscita: riprova'],
        ['Uploading…', 'Caricamento…'], ['Retry', 'Riprova'], ['Waiting for an image to finish uploading…', 'Aspetto che un’immagine finisca di caricarsi…'],
        ['An image couldn\'t be attached. Retry or remove it before sending.', 'Non è stato possibile allegare un’immagine. Riprova o toglila prima di inviare.'],
        ['Too many uploads. Wait a moment and retry.', 'Troppi caricamenti. Aspetta un momento e riprova.'],
        ['Too many uploads in flight. Wait a moment and retry.', 'Troppi caricamenti in corso. Aspetta un momento e riprova.']
    ]);
    const plural = (n, one, many) => n + ' ' + (n === '1' ? one : many);
    const NOT_SENT = [
        [/^images exceed the ([^]*) per-prompt limit$/, m => 'le immagini superano il limite di ' + m[1] + ' per messaggio'],
        [/^more than (\d+) images on one prompt$/, m => 'più di ' + m[1] + ' immagini in un messaggio'],
        [/^too many images queued at once$/, () => 'troppe immagini in coda insieme'],
        [/^an image attachment was malformed$/, () => 'un’immagine allegata non è valida'],
        [/^an image is no longer available$/, () => 'un’immagine non è più disponibile'],
        [/^some attachments could not be delivered$/, () => 'alcuni allegati non sono stati consegnati']
    ];
    const notSentPart = part => { for (const [rule, write] of NOT_SENT) {
        const match = rule.exec(part);
        if (match)
            return write(match);
    } return part; };
    const RECEIPT_STEPS = { Seen: 'Visto', Working: 'In lavorazione', Done: 'Fatto' };
    const ITALIAN_RULES = [
        [/^(Show|Hide) conversation(?: \((\d+) queued\)| \((new reply)\))?$/, m => (m[1] === 'Show' ? 'Mostra' : 'Nascondi') + ' la conversazione' + (m[2] ? ' (' + m[2] + ' in coda)' : m[3] ? ' (nuova risposta)' : '')],
        [/^(\d+) queued$/, m => m[1] + ' in coda'],
        [/^(\d+) selected$/, m => m[1] + (m[1] === '1' ? ' scelto' : ' scelti')],
        [/^(Seen|Working|Done)(?:: (not yet)| (\d{1,2}[:.]\d{2}(?:\s?[AaPp]\.?[Mm]\.?)?))$/, m => RECEIPT_STEPS[m[1]] + (m[2] ? ': non ancora' : ' ' + m[3])],
        [/^Copy path · ([^]*)$/, m => 'Copia il percorso · ' + m[1]],
        [/^(Retry|Remove) ([^]*)$/, m => (m[1] === 'Retry' ? 'Riprova ' : 'Togli ') + m[2]],
        [/^(\d+) more images?$/, m => m[1] === '1' ? '1 altra immagine' : m[1] + ' altre immagini'],
        [/^Exported with (?:(\d+) unresolved assets?)?(?: and )?(?:(\d+) notices?)?$/, m => 'Esportato con ' + [m[1] && plural(m[1], 'risorsa non risolta', 'risorse non risolte'), m[2] && plural(m[2], 'avviso', 'avvisi')].filter(Boolean).join(' e ')],
        [/^Reveal (\d+)\/(\d+)$/, m => 'Mostra ' + m[1] + '/' + m[2]],
        [/^Reveal the next block changed in ([^]*)$/, m => 'Mostra il blocco successivo cambiato in ' + m[1]],
        [/^Reveal ([^]*) in the artifact$/, m => 'Mostra ' + m[1] + ' nell’artefatto'],
        [/^Select ([^]*) on ([^]*)$/, m => 'Seleziona ' + m[1] + ' su ' + m[2]],
        [/^([^]*) on ([^]*) (is queued to send|is already queued for a fix)$/, m => m[1] + ' su ' + m[2] + (m[3] === 'is queued to send' ? ' è in coda per l’invio' : ' ha già una correzione in coda')],
        [/^Dismiss ([^]*) for this artifact revision$/, m => 'Ignora ' + m[1] + ' per questa revisione dell’artefatto'],
        [/^([^]*) cannot be dismissed while (queued to send|a fix is queued)$/, m => m[1] + ' non si può ignorare mentre ' + (m[2] === 'queued to send' ? 'è in coda per l’invio' : 'c’è una correzione in coda')],
        [/^Image is larger than the ([^]*) limit$/, m => 'L’immagine supera il limite di ' + m[1]],
        [/^Unsupported file type\. Use ([^]*)\.$/, m => 'Tipo di file non supportato. Usa ' + m[1].replace(/,? or /, ' o ') + '.'],
        [/^Upload limit reached for this session \(([^]*)\)\.$/, m => 'Limite di caricamento raggiunto per questa sessione (' + m[1] + ').'],
        [/^You can attach up to (\d+) images?\.$/, m => 'Puoi allegare fino a ' + plural(m[1], 'immagine', 'immagini') + '.'],
        [/^Not sent — ([^]*)\. Remove or fix the image, then send again\.$/, m => 'Non inviato: ' + m[1].split('; ').map(notSentPart).join('; ') + '. Togli o correggi l’immagine, poi invia di nuovo.']
    ];
    function italian(text) { const core = text.trim(); if (!core)
        return text; const exact = ITALIAN.get(core); if (exact !== undefined)
        return text.replace(core, () => exact); for (const [rule, write] of ITALIAN_RULES) {
        const match = rule.exec(core);
        if (match)
            return text.replace(core, () => write(match));
    } return text; }
    const OWN_WORDS = '.chat-md,.bubble-text,.note-draft,.anchor,.menu-file-text,.revision-label,.revision-summary,.warning-chip,.warning-title,.warning-explanation,.warning-target,.chat-attachment-copy strong,.revision-time,.ended-copy,.panel-summary.is-unread';
    function localizeText(node) { if (node.parentElement?.closest(OWN_WORDS) || node.parentElement?.tagName === 'TEXTAREA')
        return; const value = italian(node.nodeValue); if (value !== node.nodeValue)
        node.nodeValue = value; }
    function localizeElement(el) { if (el.closest(OWN_WORDS) || el.classList.contains('bubble-attachment'))
        return; for (const name of ['aria-label', 'title', 'placeholder']) {
        const value = el.getAttribute(name);
        const it = value && italian(value);
        if (it && it !== value)
            el.setAttribute(name, it);
    } }
    function localize(node) { if (node.nodeType === Node.TEXT_NODE)
        return localizeText(node); if (node.nodeType !== Node.ELEMENT_NODE)
        return; localizeElement(node); const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT); for (let n = walker.nextNode(); n; n = walker.nextNode())
        n.nodeType === Node.TEXT_NODE ? localizeText(n) : localizeElement(n); }
    for (const scope of ['.bar', '.panel', '#endedOverlay'].map(selector => document.querySelector(selector)).filter(Boolean)) {
        localize(scope);
        new MutationObserver(records => { for (const record of records) {
            if (record.type === 'childList')
                record.addedNodes.forEach(localize);
            else if (record.type === 'characterData')
                localizeText(record.target);
            else
                localizeElement(record.target);
        } }).observe(scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
    }
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
        if (m.type === 'lavish-mb:show-closed' && !showClosed)
            setShowClosed(true);
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
