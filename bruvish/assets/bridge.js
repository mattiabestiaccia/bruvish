/* Runtime-only bridge. Generated artifacts carry semantic IDs, never an index implementation. */
(() => {
    const VERSION = 1;
    let token = '', initialized = false, zoom = 1, pendingFrame = 0;
    let initial = new Map(), retained = {}, conflicts = {}, outlineEntries = [];
    // The minimap is the only cursor: once it has entries, the native scrollbar of the document goes
    // (still scrollable by wheel, trackpad, touch and keys). Only with a fine pointer: on touch screens
    // the overlay scroll indicator stays, since it can be dragged to move through long pages.
    const finePointer = typeof matchMedia === 'function' ? matchMedia('(pointer: fine)') : null;
    function scrollbar() { document.documentElement.style.scrollbarWidth = outlineEntries.length && finePointer?.matches ? 'none' : ''; }
    finePointer?.addEventListener?.('change', scrollbar);
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const send = (type, data = {}) => parent.postMessage({ type: 'lavish-mb:' + type, version: VERSION, token, ...data }, '*');
    function fields() {
        const result = new Map();
        document.querySelectorAll('[data-mb-field],details[id]').forEach(el => {
            const id = el.dataset.mbField || (el.tagName === 'DETAILS' ? 'disclosure:' + el.id : null);
            if (!id || result.has(id)) return;
            if (el.type === 'radio') {
                // All options share the stable field ID: compare the selected value atomically.
                const group = [...document.querySelectorAll('input[type=radio][data-mb-field]')]
                    .filter(option => option.dataset.mbField === id && option.form === el.form && option.name === el.name);
                result.set(id, {el, group, kind:'radio', value:group.find(option => option.checked)?.value ?? null});
                return;
            }
            const kind = el.tagName === 'DETAILS' ? 'open' : el.type === 'checkbox' ? 'checked' : 'value';
            result.set(id, {el, kind, value:kind === 'open' ? el.open : kind === 'checked' ? el.checked : el.value});
        });
        return result;
    }
    function applyField(field, value) { if (field.kind === 'open')
        field.el.open = Boolean(value);
    else if (field.kind === 'radio') {
        for (const option of field.group) option.checked = option.value === value;
    }
    else if (field.kind === 'checked')
        field.el.checked = Boolean(value);
    else
        field.el.value = String(value ?? ''); }
    function draft() { if (!initialized)
        return; const dirty = { ...retained }; for (const [id, field] of fields()) {
        const base = initial.get(id);
        if (!base)
            continue;
        if (!equal(field.value, base.value))
            dirty[id] = { base: base.value, value: field.value, kind: field.kind };
        else if (!conflicts[id])
            delete dirty[id];
    } retained = dirty; send('draft', { fields: dirty, conflicts: Object.keys(conflicts) }); }
    function restore(saved) { const live = fields(); retained = {}; conflicts = {}; for (const [id, record] of Object.entries(saved || {})) {
        const field = live.get(id);
        if (!field || field.kind !== record.kind) {
            retained[id] = record;
            conflicts[id] = true;
            continue;
        }
        const base = initial.get(id);
        if (!equal(field.value, base.value)) {
            retained[id] = { base: base.value, value: field.value, kind: field.kind };
            continue;
        }
        if (equal(field.value, record.value))
            continue;
        if (equal(field.value, record.base)) {
            applyField(field, record.value);
            retained[id] = { ...record, base: base.value };
        }
        else {
            retained[id] = record;
            conflicts[id] = true;
        }
    } initialized = true; draft(); outline(); }
    // Closed cards (answered and not new) are hidden from the start, as the host page's default, and until the host
    // page asks to show them; never every card. Applied before the load, so the scroll restored on load lands on this layout.
    const closed = el => el.dataset.mbState === 'answered' && !('mbNew' in el.dataset);
    let hideClosed = true, closedStyle = null;
    function applyClosed() {
        const all = [...document.querySelectorAll('[data-mb-state],.card')];
        const closedCount = all.filter(closed).length, openCount = all.length - closedCount;
        const hiding = hideClosed && closedCount > 0 && openCount > 0;
        if (hiding && !closedStyle) {
            closedStyle = document.createElement('style');
            closedStyle.textContent = ':root[data-mb-closed=hide] [data-mb-state=answered]:not([data-mb-new]){display:none!important}';
            (document.head || document.documentElement).append(closedStyle);
        }
        document.documentElement.dataset.mbClosed = hiding ? 'hide' : 'show';
        return { all, closedCount, openCount, hiding };
    }
    function outline() {
        const visible = el => el.getClientRects().length;
        const { all, closedCount, openCount, hiding } = applyClosed();
        // A closed card hidden by that filter stays in the minimap, as a dot, when its place in the page is visible.
        const hiddenClosed = el => hiding && closed(el) && !visible(el) && Boolean(el.parentElement?.getClientRects().length);
        const cards = all.filter(el => visible(el) || hiddenClosed(el));
        // With cards present the minimap maps cards one-to-one, without extra title lines.
        const nodes = cards.length ? cards : [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible);
        const ids = new Set();
        const items = nodes.slice(0,400).map((el,i) => {
            if (!el.id) el.id = 'mb-outline-' + i;
            if (ids.has(el.id)) return null;
            ids.add(el.id);
            const heading = el.matches('h1,h2,h3,h4') ? el : el.querySelector('h1,h2,h3,h4');
            return {
                id:el.id,
                title:String(heading?.textContent || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g,' ').slice(0,160),
                state:el.dataset.mbState || 'info',
                // Cards expose their state colour as --mb-state-color (glow); older pages used the left border.
                color:cards.length ? (getComputedStyle(el).getPropertyValue('--mb-state-color').trim() || getComputedStyle(el).borderLeftColor) : getComputedStyle(heading || el).color,
                // New or changed cards pulse in the minimap too (data-mb-new set by the renderer).
                fresh:cards.length && ['new','changed'].includes(el.dataset.mbNew) ? el.dataset.mbNew : '',
                closed:cards.length > 0 && closed(el),
                hidden:hiddenClosed(el),
                level:Number(heading?.tagName.slice(1) || 3),
                top:el.getBoundingClientRect().top + scrollY
            };
        }).filter(Boolean);
        outlineEntries = items;
        scrollbar();
        // The host page draws the minimap focus ring in the theme accent of the artifact, and bar and panel in its theme family.
        const rootStyle = getComputedStyle(document.documentElement);
        const palette = Object.fromEntries(['card','line','ink','muted','title','field'].map(name => [name, rootStyle.getPropertyValue('--' + name).trim()]));
        send('outline',{items, accent:palette.title, palette, closed:closedCount, open:openCount});
        position(items.filter(item => !item.hidden));
    }
    function position(items) { const list = items || outlineEntries.map(item => ({ id: item.id, el: document.getElementById(item.id) })).filter(item => item.el?.getClientRects().length).map(item => ({ id: item.id, top: item.el.getBoundingClientRect().top + scrollY })); let current = list[0]?.id || '', best = Infinity; for (const item of list) {
        const distance = Math.abs(item.top - scrollY - 80);
        if (distance < best) {
            best = distance;
            current = item.id;
        }
    } send('position', { current }); }
    function schedule() { if (!token || pendingFrame)
        return; pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; outline(); }); }
    addEventListener('message', event => { if (event.source !== parent)
        return; const m = event.data || {}; if (m.type === 'lavish-mb:hello' && typeof m.token === 'string') {
        token = m.token;
        document.documentElement.dataset.mbRuntime = '1';
        initial = fields();
        send('ready');
        return;
    } if (m.token !== token || !token)
        return; if (m.type === 'lavish-mb:restore')
        restore(m.fields); if (m.type === 'lavish-mb:theme' && ['dark', 'light'].includes(m.theme)) {
        document.documentElement.dataset.mbTheme = m.theme;
        schedule();
    } if (m.type === 'lavish-mb:mode' && ['dark', 'transparent'].includes(m.mode)) {
        document.documentElement.dataset.mbMode = m.mode;
    } if (m.type === 'lavish-mb:zoom' && Number.isFinite(m.zoom)) {
        zoom = Math.max(.6, Math.min(2.5, m.zoom));
        document.documentElement.style.zoom = String(zoom);
        schedule();
    } if (m.type === 'lavish-mb:closed' && typeof m.show === 'boolean') {
        hideClosed = !m.show;
        outline();
    } if (m.type === 'lavish-mb:reveal') {
        const el = document.getElementById(String(m.id));
        el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    } if (m.type === 'lavish-mb:resolve-draft') {
        const field = fields().get(m.id), record = retained[m.id];
        if (record && m.restore && field) {
            applyField(field, record.value);
            const base = initial.get(m.id);
            retained[m.id] = { base: base?.value, value: record.value, kind: field.kind };
        }
        else
            delete retained[m.id];
        delete conflicts[m.id];
        draft();
    } });
    document.addEventListener('input', () => { for (const [id] of fields())
        if (conflicts[id]) {
            const f = fields().get(id), base = initial.get(id);
            if (f && base && !equal(f.value, base.value))
                delete conflicts[id];
        } draft(); });
    document.addEventListener('change', draft);
    // The artifact iframe is sandboxed (no storage): the host page remembers the backdrop mode on the device.
    document.addEventListener('lavish-mb:mode-change', event => { const mode = event.detail?.mode; if (token && ['dark', 'transparent'].includes(mode))
        send('mode', { mode }); });
    document.addEventListener('toggle', () => { draft(); schedule(); }, true);
    addEventListener('scroll', () => { if (!pendingFrame)
        pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; position(); }); }, { passive: true });
    addEventListener('resize', schedule);
    document.addEventListener('keydown', event => { if (!(event.metaKey || event.ctrlKey) || event.altKey)
        return; if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        send('zoom-request', { delta: event.key === '-' ? -.1 : event.key === '0' ? 0 : .1, reset: event.key === '0' });
    } }, true);
    // A double tap of the right Option key inside the artifact asks the host page to toggle annotation mode,
    // with the same rule as chrome-addon.js: within 400 ms, no other key in between, not while typing.
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
        if (event.timeStamp - lastTap <= 400) {
            lastTap = -Infinity;
            if (token)
                send('annotate-toggle');
        }
        else
            lastTap = event.timeStamp;
    }, true);
    applyClosed();
    new MutationObserver(records => { if (records.some(r => r.type === 'childList' || r.attributeName === 'hidden' || r.attributeName === 'data-mb-state' || r.attributeName === 'data-mb-new' || r.attributeName === 'open'))
        schedule(); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-mb-state', 'data-mb-new', 'open'] });
    document.fonts?.ready.then(schedule);
})();
