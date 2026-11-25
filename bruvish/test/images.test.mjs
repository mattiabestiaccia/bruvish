// The images block of a card (Mattia, 25 November 2026): screenshots taken in the VM, each a file beside the page with a
// one-line caption. A grid of figures, lazy loading, alt from the caption, a click opens the image large in the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderDocument, cardFingerprint } from '../lib/document.mjs';
import { createDocument, createWindow } from '../test-helpers/mini-dom.mjs';

const scriptOf = html => /<\/style><script>([\s\S]*?)<\/script>/.exec(html)[1];
const styleOf = html => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const body = html => html.slice(html.indexOf('<body>'));
const card = images => ({ id: 'a', title: 'Prove nella VM', paragraphs: ['Testo.'], images });
const page = (images, extra = {}) => ({ title: 'Prova', guide: 'Leggi.', sections: [{ id: 's', title: 'Sezione', cards: [card(images)] }], ...extra });
const render = input => renderDocument(input, { id: 'fixture' });
function boot(html) {
    const document = createDocument(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''));
    Object.assign(document, { body: document.querySelector('body') });
    const window = createWindow(document);
    vm.runInNewContext(scriptOf(html), window);
    return { document, window };
}
const shots = [{ file: 'cattura-1.png', caption: 'La pagina dopo il clic su **Unisci**.' }, { file: 'Cattura_2.webp', caption: 'Il messaggio <di> errore & altro.' }];

test('images: a grid of figures with the caption under each, lazy loading, alt from the caption', async () => {
    const html = await render(page(shots));
    assert.match(body(html), /<div class="mb-images"><figure class="mb-image"><button type="button" class="mb-image-open" data-mb-image data-lavish-action aria-label="Apri l&#39;immagine grande: La pagina dopo il clic su \*\*Unisci\*\*\."><img src="cattura-1\.png" alt="La pagina dopo il clic su \*\*Unisci\*\*\." loading="lazy" decoding="async"><\/button><figcaption>La pagina dopo il clic su <strong>Unisci<\/strong>\.<\/figcaption><\/figure>/);
    assert.match(body(html), /<img src="Cattura_2\.webp" alt="Il messaggio &lt;di&gt; errore &amp; altro\." loading="lazy" decoding="async"><\/button><figcaption>Il messaggio &lt;di&gt; errore &amp; altro\.<\/figcaption>/);
    assert.doesNotMatch(body(html), /<di>/);
    // The block works in every theme: its rules are in the building-block stylesheet, which every page with it carries.
    for (const theme of ['B', 'F', 'revisione']) {
        const themed = await render(page(shots, { theme }));
        assert.match(styleOf(themed), /\.mb-images\{display:grid;/, theme);
        assert.match(styleOf(themed), /\.mb-lightbox\{/, theme);
    }
    assert.notEqual(cardFingerprint(card(shots)), cardFingerprint(card(undefined)), 'the images enter the fingerprint');
});

test('a click opens the image large inside the page; the close button, a click on the backdrop or Esc closes it', async () => {
    const { document } = boot(await render(page(shots)));
    const [first] = document.querySelectorAll('[data-mb-image]');
    first.click();
    const box = document.querySelector('.mb-lightbox');
    assert(box && !box.hidden, 'the large image opens');
    assert.equal(box.getAttribute('role'), 'dialog');
    assert.equal(box.getAttribute('aria-modal'), 'true');
    assert.equal(box.querySelector('img').getAttribute('src'), 'cattura-1.png');
    assert.equal(box.querySelector('img').getAttribute('alt'), 'La pagina dopo il clic su **Unisci**.');
    assert.equal(box.querySelector('.mb-lightbox-caption').textContent, 'La pagina dopo il clic su **Unisci**.');
    const close = box.querySelector('.mb-lightbox-close');
    assert.equal(document.activeElement, close, 'the close button takes the focus');
    close.click();
    assert.equal(box.hidden, true);
    assert.equal(document.activeElement, first, 'the focus goes back to the image');
    first.click();
    document.dispatch(box, 'click');
    assert.equal(box.hidden, true, 'a click on the backdrop closes');
    first.click();
    document.dispatch(box.querySelector('img'), 'click');
    assert.equal(box.hidden, false, 'a click on the image itself keeps it open');
    document.dispatch(document.querySelector('body'), 'keydown', { key: 'Escape' });
    assert.equal(box.hidden, true, 'Esc closes');
    assert.equal(document.querySelectorAll('.mb-lightbox').length, 1, 'one box for the page');
});

test('a file that is not a plain image name beside the page, or a missing caption, stops the render with cause and remedy', async () => {
    for (const file of ['https://x.org/a.png', '../a.png', 'sub/a.png', '/tmp/a.png', 'a..png', 'a.gif', 'a.svg', 'a', '.png', 'a.png?x=1', 'C:\\a.png', 'data:image/png;base64,AA', ' a.png', 3, undefined])
        await assert.rejects(render(page([{ file, caption: 'Una riga.' }])), /Card a: images\[0\]\.file .* is not the name of an image beside the page: write only the file name of a png, jpg, jpeg or webp in the same folder as the page, like "cattura-1\.png"/, String(file));
    for (const caption of [undefined, '', '  ', 'Due\nrighe.', 3])
        await assert.rejects(render(page([{ file: 'a.png', caption }])), /Card a: images\[0\]\.caption is missing or not one line: write one line that says what the image shows/, String(caption));
    for (const images of ['a.png', [], [null], ['a.png'], [{ file: 'a.png', caption: 'x', src: 'b.png' }]])
        await assert.rejects(render(page(images)), /Card a: images must be a non-empty array of \{ "file": "cattura-1\.png", "caption": "…" \}/, JSON.stringify(images));
    // jpg and jpeg, in any letter case, are accepted.
    for (const file of ['a.jpg', 'A.JPEG', 'b-1.Png'])
        assert.match(await render(page([{ file, caption: 'Una riga.' }])), new RegExp('src="' + file.replace('.', '\\.') + '"'));
});
