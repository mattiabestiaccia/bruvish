(() => {
    // Backdrop mode: dark (full #1f2023) or transparent. Applied before the body renders.
    // The choice is remembered on the device: here when storage works, otherwise through the
    // Lavish runtime bridge, which forwards it to the host page (the artifact iframe is sandboxed).
    // Only a pointer-fine device honours a saved choice: without the switch (phone), the default applies.
    const KEY = 'lavish-mb:mode', MODES = ['dark', 'transparent'], root = document.documentElement;
    const stored = () => { try {
        return matchMedia('(pointer: fine)').matches ? localStorage.getItem(KEY) : null;
    }
    catch {
        return null;
    } };
    const fallback = () => { const ua = navigator.userAgent || ''; return /\bElectron\//.test(ua) && /Macintosh|Mac OS X/.test(ua) ? 'transparent' : 'dark'; };
    if (!MODES.includes(root.dataset.mbMode)) {
        const saved = stored();
        root.dataset.mbMode = MODES.includes(saved) ? saved : fallback();
    }
    const setMode = mode => { if (!MODES.includes(mode))
        return; root.dataset.mbMode = mode; try {
        localStorage.setItem(KEY, mode);
    }
    catch { } document.dispatchEvent(new CustomEvent('lavish-mb:mode-change', { detail: { mode } })); };
    const init = () => {
        // One switch, shown on pointer-fine devices only: on = transparent, off = dark.
        const switches = [...document.querySelectorAll('[data-mb-mode-switch]')];
        const sync = () => switches.forEach(item => item.setAttribute('aria-checked', String(root.dataset.mbMode === 'transparent')));
        switches.forEach(item => item.addEventListener('click', () => setMode(root.dataset.mbMode === 'transparent' ? 'dark' : 'transparent')));
        new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-mb-mode'] });
        sync();
        document.querySelectorAll('[data-mb-voice]').forEach(button => button.addEventListener('click', () => { if (!('speechSynthesis' in window))
            return; if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            return;
        } const card = button.closest('.card'); const text = [card.querySelector('h3')?.textContent, ...[...card.querySelectorAll(':scope>p')].map(p => p.textContent)].join(' '); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'it-IT'; speechSynthesis.speak(utterance); }));
        document.querySelectorAll('[data-mb-question]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); const values = new FormData(form); const answer = { choice: String(values.get('choice') || ''), note: String(values.get('note') || '') }; const status = form.querySelector('.queue-status'); if (!answer.choice && !answer.note) {
            status.textContent = 'Scegli una risposta o scrivi una nota.';
            return;
        } if (!window.lavish) {
            status.textContent = 'Apri la pagina con Lavish per accodare la risposta.';
            return;
        } window.lavish.queuePrompt('Risposta per ' + form.dataset.mbQuestion, { tag: 'choice', text: 'Risposta: ' + form.dataset.mbQuestion, element: form, queueKey: 'answer:' + form.dataset.mbQuestion, data: { question: form.dataset.mbQuestion, answer } }); status.textContent = 'Risposta aggiunta alla coda. Usa Send to Agent nel pannello Lavish.'; }));
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
