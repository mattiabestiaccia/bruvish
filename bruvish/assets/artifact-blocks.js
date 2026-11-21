(() => {
    // Behaviour of the building blocks (tabs, help, free text in answers, line comments). Embedded only in pages that use them.
    const init = () => {
        // Help of a card: a click on «?» opens the panel in the flow of the card, another click closes it. Never on hover.
        document.querySelectorAll('[data-mb-help]').forEach(button => button.addEventListener('click', () => {
            const panel = document.getElementById(button.getAttribute('aria-controls'));
            if (!panel)
                return;
            const open = panel.hidden;
            panel.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
        }));
        // Line comments on a diff: «commenta» opens a text box under the line; «Aggiungi» queues the comment with the
        // line as anchor. The queued and sent marks follow the chrome's anchor lists, as for the answers.
        const quoted = value => String(value).replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
        const lineSelector = key => 'tr[data-mb-line="' + quoted(key) + '"]';
        const make = (tag, attributes = {}, text = '') => { const el = document.createElement(tag); Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v)); if (text)
            el.textContent = text; return el; };
        const boxes = new Map();
        document.querySelectorAll('button[data-mb-comment]').forEach(button => button.addEventListener('click', () => {
            const row = button.closest('tr');
            let box = boxes.get(row);
            if (box) {
                box.hidden = !box.hidden;
                button.setAttribute('aria-expanded', String(!box.hidden));
                if (!box.hidden)
                    box.querySelector('textarea').focus();
                return;
            }
            const key = row.dataset.mbLine, at = key.lastIndexOf(':'), file = key.slice(0, at), line = Number(key.slice(at + 1));
            const area = make('textarea', { rows: '3', 'aria-label': 'Commento sulla riga ' + line + ' di ' + file, placeholder: 'Scrivi un commento su questa riga…' });
            const add = make('button', { type: 'button', class: 'mb-comment-add' }, 'Aggiungi'), cancel = make('button', { type: 'button' }, 'Annulla');
            const status = make('span', { class: 'mb-comment-status', role: 'status' });
            const actions = make('div', { class: 'mb-comment-actions' }), wrap = make('div', { class: 'mb-comment-box' }), cell = make('td', { colspan: '4' });
            actions.append(add, cancel, status);
            wrap.append(area, actions);
            cell.append(wrap);
            box = make('tr', { class: 'mb-comment-row' });
            box.append(cell);
            row.after(box);
            boxes.set(row, box);
            button.setAttribute('aria-expanded', 'true');
            area.focus();
            cancel.addEventListener('click', () => { box.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); });
            add.addEventListener('click', () => {
                const text = area.value.trim();
                if (!text) {
                    status.textContent = 'Scrivi il commento.';
                    return;
                }
                if (!window.lavish) {
                    status.textContent = 'Apri la pagina con Lavish per accodare il commento.';
                    return;
                }
                window.lavish.queuePrompt('Commento sulla riga ' + line + ' di ' + file + ':\n' + text, { tag: 'line-comment', text: 'Commento su ' + file + ':' + line, element: row, selector: lineSelector(key), queueKey: 'line:' + key, data: { file, line, side: 'RIGHT', text } });
                status.textContent = '';
                box.hidden = true;
                button.setAttribute('aria-expanded', 'false');
            });
        }));
        // A line in the queue shows «✓ in coda», a delivered one «✓ inviata» until the page reloads or the line is queued again.
        let lineQueued = new Set(), marksRestored = false, announcer = null;
        const lineSent = new Set();
        const announce = text => { if (!announcer) {
            announcer = make('span', { class: 'mb-announce', role: 'status' });
            (document.querySelector('main') || document.body).append(announcer);
        } announcer.textContent = text; };
        window.addEventListener('message', event => {
            const message = event.data;
            if (event.source !== window.parent || !message || (message.type !== 'lavish:queuedAnchors' && message.type !== 'lavish:deliveredAnchors'))
                return;
            const selectors = Array.isArray(message.selectors) ? message.selectors.map(String) : [];
            if (message.type === 'lavish:deliveredAnchors')
                selectors.forEach(selector => lineSent.add(selector));
            else
                lineQueued = new Set(selectors);
            let change = '';
            document.querySelectorAll('tr[data-mb-line]').forEach(row => {
                const selector = lineSelector(row.dataset.mbLine), isQueued = lineQueued.has(selector), wasQueued = row.classList.contains('mb-queued');
                if (isQueued && !wasQueued)
                    lineSent.delete(selector);
                const isSent = !isQueued && lineSent.has(selector);
                if (wasQueued === isQueued && row.classList.contains('mb-sent') === isSent)
                    return;
                row.classList.toggle('mb-queued', isQueued);
                row.classList.toggle('mb-sent', isSent);
                let mark = row.querySelector('.mb-line-mark');
                if (!mark && (isQueued || isSent)) {
                    mark = make('span', { class: 'mb-line-mark' });
                    row.querySelector('.mb-cmt')?.append(mark);
                }
                if (mark)
                    mark.textContent = isQueued ? '✓ in coda' : isSent ? '✓ inviata' : '';
                const where = 'riga ' + row.dataset.mbLine.slice(row.dataset.mbLine.lastIndexOf(':') + 1);
                change = isQueued ? 'Commento sulla ' + where + ' in coda.' : isSent ? 'Commento sulla ' + where + ' inviato.' : wasQueued ? 'Commento tolto dalla coda.' : change;
            });
            if (change && marksRestored)
                announce(change);
            marksRestored = true;
        });
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
