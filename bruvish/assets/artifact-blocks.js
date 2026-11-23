(() => {
    // Behaviour of the building blocks (tabs, help, free text in answers, line comments). Embedded only in pages that use them.
    const init = () => {
        // Page operations (S20). Header and «⋯» menu: a click opens a confirmation dropdown that says what happens; «Conferma»
        // queues the operation and sends it. Card forms: a text, then two taps on the button (choose, then confirm).
        const view = document.querySelector('main[data-mb-view]')?.dataset.mbView || '';
        const sentText = fallback => fallback;
        const sendOperation = (operation, text, element) => {
            if (!window.lavish?.queuePrompt)
                return false;
            window.lavish.queuePrompt('Operazione ' + operation + (text ? ':\n' + text : ''), { tag: 'operation', text: 'Operazione: ' + operation, element, queueKey: '', data: { view, operation, text: text || '' } });
            window.lavish.sendQueuedPrompts?.();
            return true;
        };
        document.querySelectorAll('[data-mb-actions]').forEach(bar => {
            const box = bar.querySelector('.mb-confirm');
            const ask = button => {
                bar.querySelectorAll('details.mb-actions-menu[open]').forEach(menu => { menu.open = false; });
                box.replaceChildren();
                const title = make('b', { class: 'mb-confirm-title' }, button.dataset.mbConfirmTitle + '?'), text = make('p', { class: 'mb-confirm-text' });
                text.innerHTML = button.dataset.mbConfirm;
                const row = make('div', { class: 'mb-confirm-row' }), no = make('button', { type: 'button', class: 'mb-confirm-no' }, 'Annulla'), yes = make('button', { type: 'button', class: 'mb-confirm-yes' }, 'Conferma');
                // A fixed operation that asks for a text (a login, a reason) carries its field inside the dropdown.
                const kind = button.dataset.mbFieldKind;
                let field = null, status = null;
                if (kind === 'line' || kind === 'text') {
                    const attributes = { class: 'mb-op-text mb-confirm-field', 'aria-label': button.dataset.mbConfirmTitle, placeholder: button.dataset.mbPlaceholder || '' };
                    field = kind === 'text' ? make('textarea', { ...attributes, rows: '3' }) : make('input', { ...attributes, type: 'text', autocomplete: 'off', spellcheck: 'false' });
                    status = make('span', { class: 'mb-op-status', role: 'status' });
                    row.append(status);
                }
                row.append(no, yes);
                box.append(...[title, text, field, row].filter(Boolean));
                box.hidden = false;
                field?.focus?.();
                no.addEventListener('click', () => { box.hidden = true; button.focus?.(); });
                yes.addEventListener('click', () => {
                    const value = field ? String(field.value || '').trim() : '';
                    if (field && button.hasAttribute('data-mb-required') && !value) {
                        status.textContent = 'Compila il campo prima di confermare.';
                        field.focus?.();
                        return;
                    }
                    const sent = sendOperation(button.dataset.mbOp, value, button);
                    box.replaceChildren(make('p', { class: 'mb-confirm-text' }, sent ? sentText('✓ ' + button.dataset.mbConfirmTitle + ': inviato all\'agente.') : 'Lavish non è collegato: scrivi l\'operazione in chat.'));
                });
                // Enter in a single-line field confirms, as the button does.
                if (kind === 'line')
                    field.addEventListener('keydown', event => { if (event && event.key === 'Enter') { event.preventDefault?.(); yes.click(); } });
            };
            bar.querySelectorAll('button[data-mb-op]').forEach(button => button.addEventListener('click', () => {
                if (button.classList.contains('mb-action'))
                    bar.querySelectorAll('.mb-action').forEach(other => other.classList.toggle('mb-action-main', other === button));
                ask(button);
            }));
        });
        document.querySelectorAll('[data-mb-op-form]').forEach(form => {
            const field = form.querySelector('.mb-op-text'), status = form.querySelector('.mb-op-status'), submit = form.querySelector('.mb-op-submit');
            const disarm = () => { delete submit.dataset.mbArmed; status.textContent = ''; };
            form.addEventListener('input', disarm);
            form.addEventListener('change', disarm);
            form.addEventListener('submit', event => {
                event.preventDefault();
                const choice = [...form.querySelectorAll('input')].find(input => input.getAttribute('type') === 'radio' && input.checked);
                const operation = choice ? choice.value : form.dataset.mbOp, required = choice ? choice.hasAttribute('data-mb-required') : form.hasAttribute('data-mb-required');
                const text = field.value.trim();
                if (required && !text) {
                    status.textContent = 'Scrivi il testo prima di inviare.';
                    return;
                }
                if (!submit.hasAttribute('data-mb-armed')) {
                    submit.dataset.mbArmed = '';
                    status.textContent = 'Tocca ancora per inviare.';
                    return;
                }
                disarm();
                status.textContent = sendOperation(operation, text, form) ? '✓ Inviato all\'agente.' : 'Lavish non è collegato: scrivi in chat.';
            });
        });
        // Comparison matrix (form C): a tapped cell shows its reason in the box under the table; a tapped option highlights
        // its column. The reason is the cell's own rendered markup, already escaped by the renderer.
        document.querySelectorAll('[data-mb-matrix]').forEach(matrix => {
            const box = matrix.querySelector('.mb-matrix-detail');
            matrix.querySelectorAll('.mb-matrix-cell').forEach(cell => cell.addEventListener('click', () => {
                matrix.querySelectorAll('.mb-matrix-cell[aria-pressed="true"]').forEach(other => other.setAttribute('aria-pressed', 'false'));
                cell.setAttribute('aria-pressed', 'true');
                if (box)
                    box.innerHTML = cell.dataset.mbMatrixDetail;
            }));
            matrix.querySelectorAll('.mb-matrix-option').forEach(option => option.addEventListener('click', () => {
                const col = option.dataset.mbMatrixCol, on = option.getAttribute('aria-pressed') !== 'true';
                matrix.querySelectorAll('.mb-matrix-option').forEach(other => other.setAttribute('aria-pressed', String(on && other === option)));
                matrix.querySelectorAll('td[data-mb-matrix-col]').forEach(td => td.classList.toggle('mb-matrix-dim', on && td.dataset.mbMatrixCol !== col));
            }));
        });
        // Tabs: the index bar shows one section at a time. The hash, a link or a reveal of the frame pointing into a hidden
        // section opens its tab first. The minimap follows, since it maps only the visible cards.
        const bar = document.querySelector('nav.mb-tabs');
        if (bar) {
            if (document.documentElement.dataset.mbFamily === 'revisione')
                new ResizeObserver(() => document.documentElement.style.setProperty('--mb-tabs-height', bar.offsetHeight + 'px')).observe(bar);
            const links = [...bar.querySelectorAll('a[data-mb-tab]')];
            const panels = links.map(link => document.getElementById(link.dataset.mbTab)).filter(Boolean);
            const show = id => {
                if (!panels.some(panel => panel.id === id))
                    return;
                panels.forEach(panel => { panel.hidden = panel.id !== id; });
                links.forEach(link => { if (link.dataset.mbTab === id)
                    link.setAttribute('aria-current', 'page');
                else
                    link.removeAttribute('aria-current'); });
            };
            const panelOf = el => panels.find(panel => panel === el || panel.contains(el)) || null;
            const target = () => { let id = ''; try {
                id = decodeURIComponent(String(location.hash || '').slice(1));
            }
            catch { } return id ? document.getElementById(id) : null; };
            show(panelOf(target())?.id || panels[0]?.id);
            links.forEach(link => link.addEventListener('click', event => {
                event.preventDefault();
                show(link.dataset.mbTab);
                try {
                    history.replaceState(null, '', '#' + link.dataset.mbTab);
                }
                catch { }
            }));
            window.addEventListener('hashchange', () => { const el = target(), panel = el && panelOf(el); if (!panel)
                return; show(panel.id); if (el !== panel)
                el.scrollIntoView({ block: 'start' }); });
            window.addEventListener('message', event => {
                const m = event.data || {};
                if (event.source !== window.parent || !['lavish:revealElement', 'lavish:annotateElement'].includes(m.type) || typeof m.selector !== 'string')
                    return;
                let el = null;
                try {
                    el = document.querySelector(m.selector);
                }
                catch { }
                const panel = el && panelOf(el);
                if (!panel || !panel.hidden)
                    return;
                show(panel.id);
                el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            });
        }
        // Help of a card, as on the approved review page: a click on «?» opens the bubble under the title row (one at a
        // time), another click, a click outside the bubble or Esc closes it. Never on hover.
        const helpOf = button => document.getElementById(button.getAttribute('aria-controls'));
        const closeHelp = (button, focus) => { const panel = helpOf(button); if (panel && !panel.hidden) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus && button.focus) button.focus(); } };
        const helpButtons = () => document.querySelectorAll('[data-mb-help]');
        helpButtons().forEach(button => button.addEventListener('click', event => {
            const panel = helpOf(button);
            if (!panel)
                return;
            const open = panel.hidden;
            helpButtons().forEach(other => { if (other !== button) closeHelp(other, false); });
            panel.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
        }));
        // In capture, so a click outside closes the bubble even where another handler stops the event.
        document.addEventListener('click', event => {
            const target = event && event.target;
            if (target && target.closest && target.closest('.mb-help, [data-mb-help]'))
                return;
            helpButtons().forEach(button => closeHelp(button, false));
        }, true);
        document.addEventListener('keydown', event => {
            if (event && event.key === 'Escape')
                helpButtons().forEach(button => { if (button.getAttribute('aria-expanded') === 'true') closeHelp(button, true); });
        });
        // Text in an answer: shown for the options listed in data-mb-for (always without it), also after the bridge restores
        // a draft without change events (mb:restored). When the form has a text,
        // the submit is handled here, before artifact.js: an option that asks for the text refuses an empty one, and the
        // queued answer is { choice, text }, with the same selector, key and marks as a plain answer.
        const quoted = value => String(value).replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ');
        const forOf = box => { try {
            return box.dataset.mbFor ? JSON.parse(box.dataset.mbFor) : null;
        }
        catch {
            return null;
        } };
        const chosen = form => [...form.querySelectorAll('input[name="choice"]')].find(input => input.checked) || null;
        const showText = form => { const box = form.querySelector('.mb-answer-text'), list = forOf(box), input = chosen(form); box.hidden = !!list && !(input && list.includes(String(input.value))); };
        const sayIn = (form, text, problem = false) => { const status = form.querySelector('.queue-status'); if (!status)
            return; status.classList.toggle('mb-alert', problem); status.textContent = text; };
        const textForms = [...document.querySelectorAll('form[data-mb-question]')].filter(form => form.querySelector('.mb-answer-text'));
        textForms.forEach(form => form.addEventListener('change', () => showText(form)));
        document.addEventListener('mb:restored', () => textForms.forEach(showText));
        document.addEventListener('submit', event => {
            const form = event.target;
            if (!form?.matches?.('form[data-mb-question]') || !form.querySelector('.mb-answer-text'))
                return;
            const input = chosen(form);
            if (!input)
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const box = form.querySelector('.mb-answer-text'), list = forOf(box), area = box.querySelector('textarea');
            showText(form);
            const text = String(area?.value || '').trim();
            if (list && list.includes(String(input.value)) && !text) {
                sayIn(form, 'Scrivi il testo per questa risposta.', true);
                area?.focus();
                return;
            }
            if (!window.lavish) {
                sayIn(form, 'Apri la pagina con Lavish per accodare la risposta.', true);
                return;
            }
            const question = form.dataset.mbQuestion, answer = { choice: String(input.value) };
            if (!box.hidden && text)
                answer.text = text;
            const selector = '[data-mb-question="' + question + '"] input[value="' + quoted(input.value) + '"]';
            window.lavish.queuePrompt('Risposta per ' + question, { tag: 'choice', text: 'Risposta: ' + question, element: input, selector, queueKey: 'answer:' + question, data: { question, answer } });
            sayIn(form, '');
            form.querySelector('.mb-armed')?.classList.remove('mb-armed');
            lastQueued = { input, selector, queued: !!input.closest('label')?.classList.contains('mb-queued') };
        }, true);
        // The submit above stops artifact.js, which therefore keeps that option armed: the next tap on it would queue it
        // again at once. So the next tap (or Space) on the option just queued only arms it again, as a first tap does;
        // the tap after that reaches artifact.js, which queues it. Whatever disarms the option in artifact.js drops this
        // memory too: a tap on another option of any question, or the queued-anchor list that first shows the option queued.
        let lastQueued = null;
        const rearm = event => {
            const input = event.target;
            if (!lastQueued || !input || input.type !== 'radio' || (event.type === 'keyup' && event.key !== ' '))
                return;
            if (input !== lastQueued.input || !input.checked) {
                lastQueued = null;
                return;
            }
            const label = input.closest('label');
            if (!label || label.classList.contains('mb-armed'))
                return;
            label.classList.add('mb-armed');
            event.preventDefault();
            event.stopImmediatePropagation();
            lastQueued = null;
        };
        document.querySelectorAll('[data-mb-question]').forEach(form => { form.addEventListener('click', rearm, true); form.addEventListener('keyup', rearm, true); });
        // Files of a diff in the theme «revisione»: one button above them closes them all when every file is open, and
        // opens them all otherwise; its words follow the files also when one is opened or closed by its own name.
        document.querySelectorAll('[data-mb-diff-all]').forEach(button => {
            const files = [...button.closest('.mb-diff').querySelectorAll('details.mb-diff-file')];
            const allOpen = () => files.every(file => file.hasAttribute('open'));
            const update = () => { button.textContent = allOpen() ? 'Chiudi tutti' : 'Apri tutti'; };
            button.addEventListener('click', () => {
                const open = !allOpen();
                files.forEach(file => { if (open)
                    file.setAttribute('open', '');
                else
                    file.removeAttribute('open'); });
                update();
            });
            files.forEach(file => file.addEventListener('toggle', update));
            update();
        });
        // Line comments on a diff: «commenta» opens a text box under the line; «Aggiungi» queues the comment with the
        // line as anchor. The queued and sent marks follow the chrome's anchor lists, as for the answers.
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
                window.lavish.queuePrompt('Commento sulla riga ' + line + ' di ' + file + ':\n' + text, { tag: 'line-comment', text: 'Commento su ' + file + ':' + line, element: row, selector: lineSelector(key), queueKey: 'line:' + key, data: view ? { file, line, text, view } : { file, line, text } });
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
            else {
                lineQueued = new Set(selectors);
                if (lastQueued) {
                    const isQueued = lineQueued.has(lastQueued.selector);
                    if (isQueued && !lastQueued.queued)
                        lastQueued = null;
                    else
                        lastQueued.queued = isQueued;
                }
            }
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
