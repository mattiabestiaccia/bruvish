(() => {
    // Dark before first paint, including standalone files and legacy saved choices. Only the Mac
    // app's toolbar can subsequently change this through the runtime bridge; artifacts own no mode state.
    const root = document.documentElement;
    root.dataset.mbMode = 'dark';
    const init = () => {
        document.querySelectorAll('[data-mb-voice]').forEach(button => button.addEventListener('click', () => { if (!('speechSynthesis' in window))
            return; if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            return;
        } const card = button.closest('.card'); const lines = node => { const sentences = [...node.querySelectorAll('.sentence')].map(s => s.textContent); return sentences.length ? sentences.join(' ') : node.textContent; }; const text = [card.querySelector('h3')?.textContent, ...[...card.querySelectorAll(':scope>p, :scope>.mb-fields tr')].map(node => node.matches('tr') ? node.querySelector('th').textContent + ': ' + lines(node.querySelector('td')) : lines(node))].join(' '); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'it-IT'; speechSynthesis.speak(utterance); }));
        // The queued answer is marked next to the option itself, never with a sentence in the card. The answer is
        // queued with a selector that names the chosen option, so the chrome's queued-anchor list (lavish:queuedAnchors,
        // sent after every queue change and on each load) says which option of which question is in the queue:
        // the mark moves when the answer changes and goes away when the answer is removed from the queue. An answer
        // the chrome reports as delivered (lavish:deliveredAnchors) shows "inviata" instead, until the page reloads
        // or another answer to the same question enters the queue.
        const quoted = value => String(value).replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ');
        const optionSelector = (form, input) => '[data-mb-question="' + form.dataset.mbQuestion + '"] input[value="' + quoted(input.value) + '"]';
        // The status region stays out of sight; it only speaks to screen readers, unless it has a problem to show.
        const say = (form, text, problem = false) => { const status = form.querySelector('.queue-status'); if (!status)
            return; status.classList.toggle('mb-alert', problem); status.textContent = text; };
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); const input = form.querySelector('input[name="choice"]:checked'); if (!input) {
            say(form, 'Scegli una risposta.', true);
            return;
        } if (!window.lavish) {
            say(form, 'Apri la pagina con Lavish per accodare la risposta.', true);
            return;
        } const question = form.dataset.mbQuestion; window.lavish.queuePrompt('Risposta per ' + question, { tag: 'choice', text: 'Risposta: ' + question, element: input, selector: optionSelector(form, input), queueKey: 'answer:' + question, data: { question, answer: { choice: String(input.value) } } }); say(form, ''); form.querySelector('.mb-armed')?.classList.remove('mb-armed'); armed = null; }));
        // Answer in two taps: the first tap on an option selects it, a second tap on the same option queues it
        // through requestSubmit(), without a submit button. Space on the selected option is the second tap.
        let armed = null;
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('click', event => { const input = event.target; if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked)
            return; if (armed === input) {
            form.requestSubmit();
            return;
        } document.querySelectorAll('.mb-armed').forEach(option => option.classList.remove('mb-armed')); armed = input; input.closest('label')?.classList.add('mb-armed'); }));
        // Chrome fires no click when Space is released on a radio that is already selected, so Space on the selected
        // option is handled here: it arms the option like a first tap, or queues it if it is already armed. Space on an
        // option that is not selected yet keeps the browser's own behaviour (select it, then the click above arms it).
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('keyup', event => { const input = event.target; if (event.key !== ' ' || !(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked)
            return; event.preventDefault(); if (armed === input) {
            form.requestSubmit();
            return;
        } document.querySelectorAll('.mb-armed').forEach(option => option.classList.remove('mb-armed')); armed = input; input.closest('label')?.classList.add('mb-armed'); }));
        // The first list after a load only restores the marks; later changes are also said to screen readers.
        let marksRestored = false, queued = new Set();
        const sent = new Set();
        window.addEventListener('message', event => { const message = event.data; if (event.source !== window.parent || !message || (message.type !== 'lavish:queuedAnchors' && message.type !== 'lavish:deliveredAnchors'))
            return; const selectors = Array.isArray(message.selectors) ? message.selectors.map(String) : []; if (message.type === 'lavish:deliveredAnchors')
            selectors.forEach(selector => sent.add(selector));
        else
            queued = new Set(selectors); document.querySelectorAll('[data-mb-question]').forEach(form => { const options = [...form.querySelectorAll('input[name="choice"]')].map(input => ({ input, label: input.closest('label'), selector: optionSelector(form, input) })).filter(option => option.label); if (options.some(option => queued.has(option.selector) && !option.label.classList.contains('mb-queued')))
            options.forEach(option => sent.delete(option.selector)); let change = ''; options.forEach(({ input, label, selector }) => { const isQueued = queued.has(selector), isSent = !isQueued && sent.has(selector), wasQueued = label.classList.contains('mb-queued'); if (wasQueued === isQueued && label.classList.contains('mb-sent') === isSent)
            return; label.classList.toggle('mb-queued', isQueued); label.classList.toggle('mb-sent', isSent); const name = label.querySelector('span')?.textContent || input.value; if (isQueued) {
            label.classList.remove('mb-armed');
            if (armed === input)
                armed = null;
            change = 'Risposta «' + name + '» in coda.';
        }
        else if (isSent)
            change = 'Risposta «' + name + '» inviata.';
        else if (wasQueued && !change)
            change = 'Risposta tolta dalla coda.'; }); if (change && marksRestored)
            say(form, change); }); marksRestored = true; });
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
