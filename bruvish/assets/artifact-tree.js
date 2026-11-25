(() => {
    // Pages with the tree bar (tabs: "tree"). Embedded only in tree pages, after artifact.js and artifact-blocks.js, which
    // keep the bar, the tabs, the help, the voice and the line comments. «A capo» switches the wrap of every diff line of
    // the page: pressed (the start), lines wrap inside the card; not pressed, main carries data-mb-wrap="off" and the
    // stylesheet keeps each line on one line, the block scrolling sideways. No markup is built here.
    const init = () => {
        const main = document.querySelector('main');
        const buttons = [...document.querySelectorAll('button[data-mb-diff-wrap]')];
        if (!main || !buttons.length)
            return;
        const set = on => {
            if (on)
                main.removeAttribute('data-mb-wrap');
            else
                main.setAttribute('data-mb-wrap', 'off');
            buttons.forEach(button => button.setAttribute('aria-pressed', String(on)));
        };
        buttons.forEach(button => button.addEventListener('click', () => set(button.getAttribute('aria-pressed') !== 'true')));
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
