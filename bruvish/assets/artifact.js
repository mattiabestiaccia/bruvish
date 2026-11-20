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
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); const values = new FormData(form); const answer = { choice: String(values.get('choice') || '') }; const status = form.querySelector('.queue-status'); if (!answer.choice) {
            status.textContent = 'Scegli una risposta.';
            return;
        } if (!window.lavish) {
            status.textContent = 'Apri la pagina con Lavish per accodare la risposta.';
            return;
        } window.lavish.queuePrompt('Risposta per ' + form.dataset.mbQuestion, { tag: 'choice', text: 'Risposta: ' + form.dataset.mbQuestion, element: form, queueKey: 'answer:' + form.dataset.mbQuestion, data: { question: form.dataset.mbQuestion, answer } }); status.textContent = 'Risposta aggiunta alla coda. Inviala dal pannello con «Invia all’agente».'; form.querySelector('.mb-armed')?.classList.remove('mb-armed'); armed = null; }));
        // Answer in two taps: the first tap on an option selects it, a second tap on the same option queues it
        // through requestSubmit(), without a submit button. Space on the selected option is the second tap.
        let armed = null;
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('click', event => { const input = event.target; if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked)
            return; if (armed === input) {
            form.requestSubmit();
            return;
        } document.querySelectorAll('.mb-armed').forEach(option => option.classList.remove('mb-armed')); armed = input; input.closest('label')?.classList.add('mb-armed'); }));
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
