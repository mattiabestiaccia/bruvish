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
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
