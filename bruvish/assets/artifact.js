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
        // the mark moves when the answer changes and goes away when the answer leaves the queue (removed or sent).
        const quoted = value => String(value).replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
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
        // An option already in the queue needs no second tap.
        let armed = null;
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('click', event => { const input = event.target; if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked)
            return; if (armed === input) {
            form.requestSubmit();
            return;
        } document.querySelectorAll('.mb-armed').forEach(option => option.classList.remove('mb-armed')); const label = input.closest('label'); armed = label?.classList.contains('mb-queued') ? null : input; if (armed)
            label.classList.add('mb-armed'); }));
        // The first list after a load only restores the marks; later changes are also said to screen readers.
        let marksRestored = false;
        window.addEventListener('message', event => { const message = event.data; if (event.source !== window.parent || !message || message.type !== 'lavish:queuedAnchors')
            return; const queued = new Set(Array.isArray(message.selectors) ? message.selectors.map(String) : []); document.querySelectorAll('[data-mb-question]').forEach(form => { let change = ''; form.querySelectorAll('input[name="choice"]').forEach(input => { const label = input.closest('label'); const on = queued.has(optionSelector(form, input)); if (!label || label.classList.contains('mb-queued') === on)
            return; label.classList.toggle('mb-queued', on); if (on) {
            label.classList.remove('mb-armed');
            if (armed === input)
                armed = null;
            change = 'Risposta «' + (label.querySelector('span')?.textContent || input.value) + '» in coda.';
        }
        else if (!change)
            change = 'Risposta tolta dalla coda.'; }); if (change && marksRestored)
            say(form, change); }); marksRestored = true; });
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
