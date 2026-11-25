(() => {
    // Theme «vibe» (B2 arricchito, 25 novembre 2026): rounds as tabs, the intent column rewritten while the reader
    // answers, the reason of the recommended answer on hover, keyboard focus or long press. Embedded only in vibe pages,
    // after artifact.js and artifact-blocks.js: answering, queue, marks, help and voice stay theirs. No markup is built
    // from text here: every text the page can show was rendered (and escaped) by the renderer and is only shown or hidden.
    const init = () => {
        const grid = document.querySelector('.mb-vibe');
        if (!grid)
            return;
        const tabs = [...document.querySelectorAll('[data-mb-round]')];
        const rounds = [...document.querySelectorAll('.mb-vibe-round')];
        const restart = (el, name) => { el.classList.remove(name); void el.offsetWidth; el.classList.add(name); };
        // One round at a time; on a phone the intent is a tab of its own (the CSS hides the other column by view).
        const show = id => {
            const intent = id === 'intent';
            if (!intent && !rounds.some(round => round.id === id))
                return;
            grid.dataset.mbVibeView = intent ? 'intent' : 'round';
            if (!intent)
                rounds.forEach(round => { round.hidden = round.id !== id; });
            tabs.forEach(tab => { if (tab.dataset.mbRound === id)
                tab.setAttribute('aria-current', 'page');
            else
                tab.removeAttribute('aria-current'); });
        };
        const roundOf = el => rounds.find(round => round === el || round.contains(el)) || null;
        const reveal = el => { const round = roundOf(el); if (round)
            show(round.id);
        else if (el && document.getElementById('intent')?.contains(el))
            show('intent'); };
        const byHash = () => { let id = ''; try {
            id = decodeURIComponent(String(location.hash || '').slice(1));
        }
        catch { } return id ? document.getElementById(id) : null; };
        // At opening: the point in progress, the open round (S9), unless the hash names a card or a round.
        const opened = byHash();
        show(roundOf(opened)?.id || grid.dataset.mbVibeOpen || rounds[0]?.id);
        tabs.forEach(tab => tab.addEventListener('click', event => {
            event.preventDefault();
            show(tab.dataset.mbRound);
            try {
                history.replaceState(null, '', '#' + tab.dataset.mbRound);
            }
            catch { }
        }));
        window.addEventListener('hashchange', () => { const el = byHash(); if (el) {
            reveal(el);
            el.scrollIntoView({ block: 'start' });
        } });
        window.addEventListener('message', event => {
            const m = event.data || {};
            if (event.source !== window.parent || !['lavish:revealElement', 'lavish:annotateElement'].includes(m.type) || typeof m.selector !== 'string')
                return;
            let el = null;
            try {
                el = document.querySelector(m.selector);
            }
            catch { }
            if (el)
                reveal(el);
        });
        // A row of the intent that leads to an unanswered card of the open round (the only rows rendered as links): opens
        // the round, scrolls to the card and flashes it.
        document.querySelectorAll('a.mb-vibe-row').forEach(row => row.addEventListener('click', event => {
            const card = document.getElementById(decodeURIComponent(row.getAttribute('href').slice(1)));
            if (!card)
                return;
            event.preventDefault();
            reveal(card);
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            restart(card, 'mb-vibe-flash');
        }));
        // The queue: artifact.js marks the queued and the sent option of each question (mb-queued, mb-sent) from the
        // chrome's anchor lists; here each open intent row follows its card, the card turns green and the counters move.
        // A sent answer is neither waiting nor in the queue. Without a voice written by the agent, the 🔊 of the intent
        // reads the rows as they are shown.
        const status = document.querySelector('[data-mb-vibe-status]'), counter = document.querySelector('[data-mb-round-count]');
        const voice = document.querySelector('[data-mb-voice-rows]');
        const openRound = rounds.find(round => round.id === grid.dataset.mbVibeOpen) || rounds[0];
        const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
        const marked = form => form && [...form.querySelectorAll('label.option')].find(label => label.classList.contains('mb-queued') || label.classList.contains('mb-sent')) || null;
        const update = () => {
            document.querySelectorAll('[data-mb-row-card]').forEach(row => {
                const form = document.querySelector('form[data-mb-question="' + row.dataset.mbRowCard + '"]'), label = marked(form);
                const input = label?.querySelector('input'), value = input ? String(input.value) : null;
                const state = label ? 'queued' : 'open', where = !label ? 'open' : label.classList.contains('mb-queued') ? 'queued' : 'sent';
                const texts = [...row.querySelectorAll('.mb-vibe-text')];
                const chosen = texts.find(text => text.dataset.mbOption === value) || texts[0];
                const was = row.dataset.mbRowState, before = texts.find(text => !text.hidden);
                texts.forEach(text => { text.hidden = text !== chosen; });
                row.querySelectorAll('.mb-vibe-where').forEach(small => { small.hidden = small.dataset.mbWhere !== where; });
                row.dataset.mbRowState = state;
                if (state === 'queued' && (was !== 'queued' || before !== chosen))
                    restart(row, 'mb-vibe-changed');
            });
            let waiting = 0, queued = 0;
            (openRound ? [...openRound.querySelectorAll('article.card')] : []).forEach(card => {
                const form = card.querySelector('form[data-mb-question]');
                if (!form)
                    return;
                const label = marked(form);
                card.classList.toggle('mb-vibe-queued', !!label);
                if (label?.classList.contains('mb-queued'))
                    queued++;
                else if (!label && card.dataset.mbState === 'waiting')
                    waiting++;
            });
            if (counter)
                counter.textContent = waiting ? plural(waiting, 'aperta', 'aperte') : queued ? 'tutte in coda' : 'nessuna aperta';
            if (status)
                status.textContent = plural(waiting, 'domanda', 'domande') + ' in attesa · ' + plural(queued, 'risposta', 'risposte') + ' in coda';
            if (voice)
                voice.dataset.mbVoiceText = [document.querySelector('.mb-vibe-intent h2')?.textContent, ...[...document.querySelectorAll('.mb-vibe-row')].map(row => row.querySelector('.mb-vibe-key').textContent + ': ' + ([...row.querySelectorAll('.mb-vibe-text')].find(text => !text.hidden)?.textContent ?? ''))].join('. ');
        };
        window.addEventListener('message', event => {
            const m = event.data;
            if (event.source === window.parent && m && (m.type === 'lavish:queuedAnchors' || m.type === 'lavish:deliveredAnchors'))
                update();
        });
        // The reason of the recommended answer: never in the card. It shows while the mouse is over the answer, while the
        // answer has the keyboard focus, and after a long press (half a second) on a touch screen; that press does not
        // choose the answer: the click its release would send is cancelled.
        document.querySelectorAll('.mb-vibe-tip').forEach(tip => {
            const input = document.querySelector('[aria-describedby="' + tip.id + '"]'), label = input?.closest('label'), form = input?.closest('form');
            if (!label)
                return;
            let timer = null, long = false;
            const open = () => { tip.hidden = false; }, close = () => { tip.hidden = true; };
            label.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse')
                open(); });
            label.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse')
                close(); });
            label.addEventListener('focusin', event => { let keyboard = true; try {
                keyboard = event.target.matches(':focus-visible');
            }
            catch { } if (keyboard)
                open(); });
            label.addEventListener('focusout', close);
            label.addEventListener('touchstart', () => { long = false; clearTimeout(timer); timer = setTimeout(() => { long = true; open(); }, 500); }, { passive: true });
            label.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
            label.addEventListener('touchcancel', () => clearTimeout(timer), { passive: true });
            label.addEventListener('touchend', event => { clearTimeout(timer); if (long)
                event.preventDefault(); });
            label.addEventListener('contextmenu', event => event.preventDefault());
            // If a browser still sends the click after a long press, it neither selects nor arms the answer.
            form.addEventListener('click', event => { if (!long || !label.contains(event.target))
                return; long = false; event.preventDefault(); event.stopImmediatePropagation(); }, true);
            document.addEventListener('touchstart', event => { if (!label.contains(event.target))
                close(); }, { passive: true });
        });
    };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();
})();
