import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const asset = name => new URL('../assets/' + name, import.meta.url);
export const escape = value => String(value ?? '').replace(/[&<>"'\r]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;' }[c]));
export async function atomicJson(file, value) { const temporary = file + '.' + randomUUID() + '.tmp'; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, file); }
export function applyDelta(current, delta) {
    const next = structuredClone(current);
    next.revision = Number(current.revision || 0) + 1;
    next.answers = { ...(current.answers || {}) };
    for (const [id, value] of Object.entries(delta.answers || {})) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Answers require an object; use an explicit withdrawn marker to erase an answer');
        if (value.withdrawn === true)
            delete next.answers[id];
        else
            next.answers[id] = value;
    }
    next.comments = [...(current.comments || [])];
    for (const comment of delta.comments || []) {
        if (!comment.id)
            throw new Error('A comment requires a stable id');
        const i = next.comments.findIndex(c => c.id === comment.id);
        if (i < 0)
            next.comments.push(comment);
        else
            next.comments[i] = { ...next.comments[i], ...comment };
    }
    next.history = [...(current.history || []), { revision: next.revision, delta: structuredClone(delta) }];
    return next;
}
// Inline marks in agent text: `code`, **bold**, *italic*, ==highlight==. Every other character stays escaped: the marks
// become fixed tags and no HTML from the input ever reaches the page. An unmatched mark stays literal text.
// A code span is literal (no marks inside); bold may hold code and italic; italic may hold code; a highlight may hold
// code, bold and italic. Like the stars, == opens and closes only next to a non-space, so a == b and === stay literal.
const INLINE = /`([^`\n]+)`|\*\*(?=[^\s*])((?:`[^`\n]+`|[^`*]|\*(?!\*))+?)(?<=[^\s*])\*\*|\*(?=[^\s*])((?:`[^`\n]+`|[^`*])+?)(?<=[^\s*])\*|==(?=[^\s=])((?:`[^`\n]+`|[^`=\n]|=(?!=))+?)(?<=[^\s=])==/g;
export function inline(value) {
    const text = String(value ?? '');
    let html = '', last = 0;
    for (const match of text.matchAll(INLINE)) {
        html += escape(text.slice(last, match.index));
        if (match[1] !== undefined)
            html += '<code>' + escape(match[1]) + '</code>';
        else if (match[2] !== undefined)
            html += '<strong>' + inline(match[2]) + '</strong>';
        else if (match[3] !== undefined)
            html += '<em>' + inline(match[3]) + '</em>';
        else
            html += '<mark>' + inline(match[4]) + '</mark>';
        last = match.index + match[0].length;
    }
    return html + escape(text.slice(last));
}
// One sentence per line: the renderer splits every agent string at a sentence end, so a string with several
// sentences still shows one per line. A sentence end is . ! ? or … (closing quotes, brackets or inline marks may follow),
// then a space or a newline, then a capital letter, a digit, a backtick, an asterisk or == (an opening quote or
// bracket may come first). It is never a split point inside an inline mark, after a known abbreviation
// (es., cfr., dott. ...), after a number abbreviation followed by a digit (pag. 3, art. 5, 20 nov. 2026),
// or after a single letter (initials, S.p.A.). A list number (digits only) stays with the sentence it opens:
// at the start of a string it is never a split point, and after a colon or a semicolon the split comes before it
// when the next number opens a later sentence of the same string (1. ... 2. ...); otherwise it is a count that
// ends its sentence (Errori: 0. Avvisi: 2.).
// Decimals, versions and paths have no space after the point and never split.
// A non-breaking space (U+00A0) after the point keeps two parts on one line.
const ABBREVIATIONS = new Set(['es', 'p.es', 'p.e', 'cfr', 'dott', 'dott.ssa', 'sig', 'sigg', 'sig.ra', 'prof', 'ing', 'avv', 'arch', 'geom', 'rag', 'sen', 'ibid', 'cit', 'op', 'ed', 'trad', 'rif', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'e.g', 'i.e']);
const NUMBER_ABBREVIATIONS = new Set(['pag', 'pagg', 'pp', 'art', 'artt', 'cap', 'par', 'fig', 'figg', 'tab', 'vol', 'voll', 'nr', 'num', 'nn', 'tel', 'ca', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic', 'jan', 'jun', 'jul', 'aug', 'sep', 'oct', 'dec']);
const SENTENCE_END = /([.!?…]+)([»"”’')\]*`=]*)[ \t\r\n]+(?=[«"“‘(\[]?(?:[\p{Lu}\p{N}`*]|==))/gu;
export function splitSentences(value) {
    const text = String(value ?? '');
    const marks = [...text.matchAll(INLINE)].map(m => [m.index, m.index + m[0].length]);
    const inside = at => marks.some(([from, to]) => at > from && at < to);
    const parts = [];
    let start = 0;
    for (const match of text.matchAll(SENTENCE_END)) {
        const at = match.index, end = at + match[1].length + match[2].length, next = match.index + match[0].length;
        if (inside(end))
            continue;
        if (match[1] === '.') {
            const before = text.slice(start, at), word = /([^\s«"“‘(\[]*)$/.exec(before)[1];
            const bare = word.toLowerCase();
            if (ABBREVIATIONS.has(bare) || (NUMBER_ABBREVIATIONS.has(bare) && /^[«"“‘(\[]?\p{N}/u.test(text.slice(next))) || /^\p{L}$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word))
                continue;
            if (/^\d+$/.test(word)) {
                const lead = before.slice(0, -word.length).trim();
                if (!lead)
                    continue;
                if (/[:;]$/.test(lead) && !inside(at - word.length) && new RegExp('[.!?…][»"”’\')\\]*`=]*\\s+' + (Number(word) + 1) + '\\.\\s').test(text.slice(next))) {
                    parts.push(lead);
                    start = at - word.length;
                    continue;
                }
            }
        }
        parts.push(text.slice(start, end).trim());
        start = next;
    }
    parts.push(text.slice(start).trim());
    return parts.filter(Boolean);
}
// A sentence is a string or { text, highlight }; a paragraph is a sentence or an array of sentences; a text block
// (card paragraphs, field paragraphs, question reason) is a string or an array of paragraphs.
const block = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const sentencesOf = paragraph => (Array.isArray(paragraph) ? paragraph : [paragraph]).flatMap(sentence => {
    const object = sentence !== null && typeof sentence === 'object' && !Array.isArray(sentence);
    if (typeof (object ? sentence.text : sentence) !== 'string')
        throw new Error('A sentence is a string or { "text": "Una frase.", "highlight": true }, not ' + JSON.stringify(sentence));
    return splitSentences(object ? sentence.text : sentence).map(text => '<span class="sentence">' + (object && sentence.highlight ? '<mark>' + inline(text) + '</mark>' : inline(text)) + '</span>');
});
function paragraphs(value) { return block(value).map(p => '<p>' + sentencesOf(p).join('') + '</p>').join(''); }
function filledParagraphs(value, error) {
    const html = paragraphs(value);
    if (!html.includes('class="sentence"'))
        throw new Error(error);
    return html;
}
// Recurring entries of a card (for example Oggi, Proposta, Effetto pratico) as a two-column table: the label from
// the JSON, the content with the same sentence and paragraph rules as the card body.
function fieldsTable(rows, className = 'mb-fields') { return '<table class="' + className + '"><tbody>' + rows.map(([label, content]) => '<tr><th scope="row">' + label + '</th><td>' + content + '</td></tr>').join('') + '</tbody></table>'; }
function cardFields(card) {
    if (card.fields === undefined)
        return '';
    const shape = 'Card ' + card.id + ': fields must be an array of { "label": "Oggi", "paragraphs": ["Una frase."] }, each with a non-empty label and its text';
    if (!Array.isArray(card.fields) || card.fields.some(f => !f || typeof f !== 'object' || typeof f.label !== 'string' || !f.label.trim()))
        throw new Error(shape);
    return card.fields.length ? fieldsTable(card.fields.map(f => [inline(f.label), filledParagraphs(f.paragraphs, shape)])) : '';
}
// Colour categories of the building blocks: cards, badge, pills, labels, levels, events. blu informs, verde is a
// good outcome, giallo asks for attention, rosso blocks, decidi asks the reader for a decision (yellow is always intense), viola is
// a neutral accent.
export const TONES = ['blu', 'verde', 'giallo', 'rosso', 'decidi', 'viola'];
function toneOf(value, where) {
    if (!TONES.includes(value))
        throw new Error(where + ': tone must be one of ' + TONES.join(', ') + ' (got ' + JSON.stringify(value) + ')');
    return value;
}
// A list of { text, tone } items (labels, pills, events): the text carries inline marks, the tone is a category.
function taggedList(list, where) {
    if (!Array.isArray(list) || list.some(item => !item || typeof item !== 'object' || typeof item.text !== 'string' || !item.text.trim() || !TONES.includes(item.tone)))
        throw new Error(where + ' must be an array of { "text": "Bloccante", "tone": "rosso" }, each with a non-empty text and a tone among ' + TONES.join(', '));
    return list;
}
// Title row of a card: the title, then its labels on the same line, then the «?» that opens the help panel in the flow.
function cardHead(card, helpId) {
    const title = '<h3>' + inline(card.title) + '</h3>';
    const labels = card.labels === undefined ? [] : taggedList(card.labels, 'Card ' + card.id + ': labels');
    if (!labels.length && card.help === undefined && card.summary === undefined)
        return title;
    let toggle = '', help = '';
    // The bubble has a fixed part (what the card means, the same on every page) and a summary written for this card.
    if (card.help !== undefined || card.summary !== undefined) {
        const meaning = card.help === undefined ? '' : '<b class="mb-help-title">A cosa ti serve</b>' + filledParagraphs(card.help, 'Card ' + card.id + ': help is a text of one or more sentences, like "Serve a decidere se unire il ramo."');
        const summary = card.summary === undefined ? '' : '<div class="mb-help-summary"><b class="mb-help-title">Cosa notare qui</b>' + filledParagraphs(card.summary, 'Card ' + card.id + ': summary is a text of one or more sentences, like "Un solo file cambia: la riga 46 di src/cli.ts."') + '</div>';
        toggle = '<button class="mb-help-toggle" type="button" data-mb-help aria-expanded="false" aria-controls="' + helpId + '" aria-label="A cosa serve questa carta">?</button>';
        help = '<div class="mb-help" id="' + helpId + '" hidden>' + meaning + summary + '</div>';
    }
    return '<div class="mb-card-head">' + title + (labels.length ? '<span class="mb-labels">' + labels.map(l => '<span class="mb-label" data-tone="' + l.tone + '">' + inline(l.text) + '</span>').join('') + '</span>' : '') + toggle + '</div>' + help;
}
// The text the 🔊 reads: written for this card (its main facts, for listening); without it the button reads the card.
function voiceText(card) {
    if (card.voice === undefined)
        return '';
    if (typeof card.voice !== 'string' || !card.voice.trim())
        throw new Error('Card ' + card.id + ': voice must be a non-empty text to read aloud, like "La PR cambia un file e passa tutte le prove."');
    return ' data-mb-voice-text="' + escape(card.voice.trim()) + '"';
}
// Closed set of inline icons for the header badge: Octicons by GitHub, MIT licence (bruvish/licenses/Octicons-MIT.txt),
// 16 px paths of git-pull-request, git-merge, git-pull-request-closed, git-pull-request-draft, check, x and dot-fill.
const ICONS = {
    open: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
    merged: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
    closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
    draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
    check: 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
    x: 'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z',
    dot: 'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
};
const icon = name => '<svg class="mb-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="' + ICONS[name] + '"></path></svg>';
// Page header: a badge (text, tone, optional icon), the meta items on the same row above the title, the subtitle under it.
function headerParts(header) {
    if (header === undefined)
        return { notice: '', before: '', after: '' };
    if (!header || typeof header !== 'object' || Array.isArray(header))
        throw new Error('header must be an object like { "badge": { "text": "Aperta", "tone": "verde", "icon": "open" }, "subtitle": "...", "meta": ["..."] }');
    let badge = '';
    if (header.badge !== undefined) {
        const b = header.badge;
        if (!b || typeof b !== 'object' || typeof b.text !== 'string' || !b.text.trim())
            throw new Error('header.badge must be { "text": "Aperta", "tone": "verde", "icon": "open" } with a non-empty text');
        toneOf(b.tone, 'header.badge');
        if (b.icon !== undefined && !Object.hasOwn(ICONS, b.icon))
            throw new Error('header.badge.icon must be one of ' + Object.keys(ICONS).join(', ') + ' (got ' + JSON.stringify(b.icon) + ')');
        badge = '<span class="mb-badge" data-tone="' + b.tone + '">' + (b.icon === undefined ? '' : icon(b.icon)) + inline(b.text) + '</span>';
    }
    if (header.meta !== undefined && (!Array.isArray(header.meta) || header.meta.some(m => typeof m !== 'string')))
        throw new Error('header.meta must be an array of strings, like ["repo **bruvish**", "21 novembre 2026"]');
    if (header.subtitle !== undefined && typeof header.subtitle !== 'string')
        throw new Error('header.subtitle must be a string');
    if (header.notice !== undefined && (typeof header.notice !== 'string' || !header.notice.trim()))
        throw new Error('header.notice must be a non-empty string, like "Mockup su una PR già unita."');
    const count = n => Number.isInteger(n) && n >= 0;
    if (header.stat !== undefined && (!header.stat || typeof header.stat !== 'object' || Array.isArray(header.stat) || !count(header.stat.added) || !count(header.stat.removed)))
        throw new Error('header.stat must be { "added": 12, "removed": 1 }, two whole numbers from 0');
    const meta = (header.meta || []).map(m => '<span class="mb-meta-item">' + inline(m) + '</span>').join('');
    // The line count closes the subtitle, in the colours of the diff: added green, removed red.
    const stat = header.stat ? '<span class="mb-plus">+' + header.stat.added + '</span> <span class="mb-minus">−' + header.stat.removed + '</span>' : '';
    const subtitle = [header.subtitle ? inline(header.subtitle) : '', stat].filter(Boolean).join(' · ');
    return {
        notice: header.notice === undefined ? '' : '<p class="mb-notice">' + inline(header.notice) + '</p>',
        before: badge || meta ? '<div class="mb-header-meta">' + badge + meta + '</div>' : '',
        after: subtitle ? '<p class="mb-subtitle">' + subtitle + '</p>' : '',
    };
}
// A pill with "level": true is a level (risk, outcome): full semantic colour, like a level cell of a table.
function pillsOf(pills) {
    if (pills === undefined)
        return '';
    taggedList(pills, 'pills');
    if (pills.some(p => p.level !== undefined && typeof p.level !== 'boolean'))
        throw new Error('pills: level must be true or false, like { "text": "Rischio basso", "tone": "verde", "level": true }');
    return '<div class="mb-pills">' + pills.map(p => '<span class="' + (p.level ? 'mb-level' : 'mb-pill') + '" data-tone="' + p.tone + '">' + inline(p.text) + '</span>').join('') + '</div>';
}
// A table of several columns. A cell is a string with inline marks, where « · » separates two items that go on two
// lines (never two items on one line), or { text, tone } for a level or an outcome in its semantic colour.
function cardTable(card) {
    if (card.table === undefined)
        return '';
    const t = card.table, matrixShape = 'Card ' + card.id + ': a matrix needs column headers, row labels and cells with text, tone and detail, like { "variant": "matrix", "headers": ["Criterio", "Opzione A"], "rows": [["Costo", { "text": "+ basso", "tone": "verde", "detail": "perché" }]] }, with as many cells per row as headers';
    const shape = t?.variant === 'matrix' ? matrixShape : 'Card ' + card.id + ': table must be { "headers": ["File", "Rischio"], "rows": [["`a.js` · `b.js`", { "text": "alto", "tone": "rosso" }]] }, with as many cells per row as headers';
    const cellOk = c => typeof c === 'string' || (c && typeof c === 'object' && !Array.isArray(c) && typeof c.text === 'string' && TONES.includes(c.tone));
    if (!t || typeof t !== 'object' || Array.isArray(t) || !Array.isArray(t.rows) || (t.headers !== undefined && (!Array.isArray(t.headers) || t.headers.some(h => typeof h !== 'string')))
        || t.rows.some(row => !Array.isArray(row) || !row.every(cellOk) || (t.headers && row.length !== t.headers.length)))
        throw new Error(shape);
    if (t.variant !== undefined && t.variant !== 'matrix')
        throw new Error('Card ' + card.id + ': table.variant must be "matrix" or absent (got ' + JSON.stringify(t.variant) + ')');
    if (t.variant === 'matrix') {
        if (!t.headers || t.headers.length < 2 || t.headers.some(h => !h.trim()) || t.rows.length === 0 || t.rows.some(row =>
            typeof row[0] !== 'string' || !row[0].trim() || row.slice(1).some(c => typeof c === 'string' ||
                !c.text.trim() || typeof c.detail !== 'string' || !c.detail.trim())))
            throw new Error(matrixShape);
        // Form C of the lab (Mattia, 22 November 2026): criteria in rows, options in columns; the cells keep their size and
        // the reason of the tapped cell shows in one box under the table; a «Bilancio» row counts + − ~ per option; tapping
        // an option highlights its column. Under 700 px the same data becomes one card per option, with native disclosures.
        const options = t.headers.slice(1);
        const count = col => t.rows.reduce((n, row) => { const k = row[col].tone === 'verde' ? 'verde' : row[col].tone === 'rosso' ? 'rosso' : 'giallo'; n[k]++; return n; }, { verde: 0, rosso: 0, giallo: 0 });
        const counts = col => { const n = count(col); return '<span class="mb-matrix-counts"><span data-tone="verde">+ ' + n.verde + '</span><span data-tone="rosso">− ' + n.rosso + '</span><span data-tone="giallo">~ ' + n.giallo + '</span></span>'; };
        const cellButton = (c, option, criterion) => '<button type="button" class="mb-matrix-cell" data-tone="' + c.tone + '" aria-pressed="false" title="' + escape(c.detail) +
            '" data-mb-matrix-detail="' + escape('<b>' + inline(option) + ' · ' + inline(criterion) + ':</b> ' + inline(c.text) + (/[.!?…][»"”’')\]*`=]*$/.test(c.text.trimEnd()) ? ' ' : '. ') + inline(c.detail)) + '">' + inline(c.text) + '</button>';
        const table = '<div class="mb-matrix-scroll"><table class="mb-table mb-matrix-table"><thead><tr><th scope="col" class="mb-matrix-criterion">' + inline(t.headers[0]) + '</th>' +
            options.map((h, i) => '<th scope="col"><button type="button" class="mb-matrix-option" data-mb-matrix-col="' + (i + 1) + '" aria-pressed="false">' + inline(h) + '</button></th>').join('') + '</tr></thead><tbody>' +
            t.rows.map(([name, ...cells]) => '<tr><th scope="row" class="mb-matrix-criterion">' + inline(name) + '</th>' + cells.map((c, i) => '<td data-mb-matrix-col="' + (i + 1) + '">' + cellButton(c, options[i], name) + '</td>').join('') + '</tr>').join('') +
            '<tr class="mb-matrix-balance"><th scope="row" class="mb-matrix-criterion">Bilancio</th>' + options.map((_, i) => '<td data-mb-matrix-col="' + (i + 1) + '">' + counts(i + 1) + '</td>').join('') + '</tr></tbody></table></div>';
        const detail = '<div class="mb-matrix-detail" aria-live="polite"><span class="mb-matrix-hint">Tocca una casella: qui compare il motivo. Tocca un\'alternativa per metterla in risalto.</span></div>';
        const cards = '<div class="mb-matrix-cards">' + options.map((h, i) => '<section class="mb-matrix-card"><h4>' + inline(h) + '</h4>' + counts(i + 1) +
            t.rows.map(row => { const c = row[i + 1]; return '<details data-tone="' + c.tone + '"><summary><small>' + inline(row[0]) + '</small>' + inline(c.text) + '</summary><p>' + inline(c.detail) + '</p></details>'; }).join('') + '</section>').join('') + '</div>';
        return '<div class="mb-matrix" data-mb-matrix>' + table + detail + cards + '</div>';
    }
    const cell = c => typeof c === 'string' ? c.split(' · ').map(inline).join('<br>') : '<span class="mb-level" data-tone="' + c.tone + '">' + inline(c.text) + '</span>';
    return '<table class="mb-table">' + (t.headers?.length ? '<thead><tr>' + t.headers.map(h => '<th scope="col">' + inline(h) + '</th>').join('') + '</tr></thead>' : '') + '<tbody>' + t.rows.map(row => '<tr>' + row.map(c => '<td>' + cell(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
// Secondary notes of a card: grey italics under a dashed line, at the end of the card body.
function cardNotes(card) {
    if (card.notes === undefined)
        return '';
    const shape = 'Card ' + card.id + ': notes must be an array of texts, like ["Una nota secondaria."]';
    if (!Array.isArray(card.notes))
        throw new Error(shape);
    return card.notes.length ? '<div class="mb-notes">' + card.notes.map(n => filledParagraphs([n], shape)).join('') + '</div>' : '';
}
// A preformatted text a reader opens on demand (a command transcript, a log): closed by default, after the table and
// the events, before the secondary notes. The text keeps its spacing and is never read for marks.
function cardTranscript(card) {
    if (card.transcript === undefined)
        return '';
    const t = card.transcript;
    if (!t || typeof t !== 'object' || Array.isArray(t) || typeof t.summary !== 'string' || !t.summary.trim() || typeof t.text !== 'string' || !t.text.trim())
        throw new Error('Card ' + card.id + ': transcript must be { "summary": "Trascrizione: prima e dopo", "text": "$ comando\\nuscita" }');
    return '<details class="mb-transcript"><summary>' + inline(t.summary) + '</summary><pre>' + escape(t.text) + '</pre></details>';
}
// Events: one line each, with a dot in the colour of its tone.
const cardEvents = card => card.events === undefined ? '' : '<div class="mb-events">' + taggedList(card.events, 'Card ' + card.id + ': events').map(e => '<div class="mb-event"><span class="mb-dot" data-tone="' + e.tone + '"></span><span>' + inline(e.text) + '</span></div>').join('') + '</div>';
// A unified diff (git diff or diff -u), file by file: name, status, added and removed counts, and its lines with the
// numbers of the old and the new side. Hunk lines are counted from the @@ header, so a removed or added line that
// looks like a file header (--- or +++) stays a line of the hunk.
export function parseDiff(text) {
    const files = [];
    let file = null, previous = null, oldLine = 0, newLine = 0, oldLeft = 0, newLeft = 0, gitHeader = false;
    const start = name => { file = { name, status: 'modified', added: 0, removed: 0, lines: [] }; files.push(file); };
    const unquote = name => {
        if (!name.startsWith('"') || !name.endsWith('"'))
            return name;
        const text = name.slice(1, -1), chunks = [], escapes = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\\': '\\' };
        let last = 0;
        for (const match of text.matchAll(/\\([0-7]{1,3}|[abfnrtv"\\])/g)) {
            chunks.push(Buffer.from(text.slice(last, match.index)), /^[0-7]/.test(match[1]) ? Buffer.from([parseInt(match[1], 8)]) : Buffer.from(escapes[match[1]]));
            last = match.index + match[0].length;
        }
        return Buffer.concat([...chunks, Buffer.from(text.slice(last))]).toString('utf8');
    };
    for (const line of String(text).split('\n')) {
        if (file && (oldLeft > 0 || newLeft > 0)) {
            const sign = line[0], body = line.slice(1);
            if (sign === '+') {
                file.lines.push({ type: 'add', old: null, new: newLine++, text: body });
                file.added++;
                newLeft--;
                continue;
            }
            if (sign === '-') {
                file.lines.push({ type: 'del', old: oldLine++, new: null, text: body });
                file.removed++;
                oldLeft--;
                continue;
            }
            if (sign === ' ' || line === '') {
                file.lines.push({ type: 'context', old: oldLine++, new: newLine++, text: body });
                oldLeft--;
                newLeft--;
                continue;
            }
            if (sign !== '\\')
                oldLeft = newLeft = 0;
        }
        if (line.startsWith('\\')) {
            file?.lines.push({ type: 'meta', old: null, new: null, text: line });
            continue;
        }
        if (line.startsWith('diff --git ')) {
            const git = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*")$/.exec(line) || /^diff --git a\/(.+) (b\/\1)$/.exec(line);
            start(git ? unquote(git[2]).replace(/^b\//, '') : '');
            previous = null;
            gitHeader = true;
            continue;
        }
        if (line.startsWith('--- ') || line.startsWith('+++ ')) {
            const name = unquote(line.slice(4).replace(/\t.*$/, '')), none = name === '/dev/null';
            if (line[0] === '-') {
                previous = none ? null : name.replace(/^a\//, '');
                continue;
            }
            // Without a git header, the +++ line opens the next file.
            if (!gitHeader || !file || file.lines.length) {
                start(none ? previous : name.replace(/^b\//, ''));
            }
            else
                file.name = none ? previous : name.replace(/^b\//, '');
            if (previous === null)
                file.status = 'added';
            else if (none)
                file.status = 'deleted';
            gitHeader = false;
            continue;
        }
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (hunk && file) {
            [oldLine, oldLeft, newLine, newLeft] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2]), Number(hunk[3]), hunk[4] === undefined ? 1 : Number(hunk[4])];
            file.lines.push({ type: 'hunk', old: null, new: null, text: line });
            gitHeader = false;
            continue;
        }
        if (file && /^new file mode/.test(line))
            file.status = 'added';
        else if (file && /^deleted file mode/.test(line))
            file.status = 'deleted';
        else if (file && /^rename from /.test(line))
            file.status = 'renamed';
        else if (file && /^(?:rename|copy) to /.test(line))
            file.name = unquote(line.replace(/^(?:rename|copy) to /, ''));
    }
    return files;
}
const DIFF_STATUS = { added: 'nuovo', deleted: 'cancellato', renamed: 'rinominato', modified: 'modificato' };
// A diff in a card: one collapsible block per file (open), coloured lines, numbers of both sides, the reviewer's notes
// under the line they name ("<file>:<line of the new side>"). Every character of the diff is escaped. In the theme
// «revisione» the files sit in the column without a card around them, under one button that closes or opens them all.
function cardDiff(card, filesPage = false) {
    if (card.diff === undefined)
        return '';
    const d = card.diff, where = 'Card ' + card.id + ': diff';
    if (!d || typeof d !== 'object' || typeof d.text !== 'string' || (d.notes !== undefined && (!d.notes || typeof d.notes !== 'object' || Array.isArray(d.notes) || Object.values(d.notes).some(n => typeof n !== 'string'))))
        throw new Error(where + ' must be { "text": "<unified diff>", "notes": { "src/a.js:12": "A note under line 12 of the new side." } }');
    const files = parseDiff(d.text);
    if (!files.length)
        throw new Error(where + ' has no file: text must be a unified diff (diff --git or ---/+++ headers, then @@ hunks)');
    const notes = { ...(d.notes || {}) };
    const html = files.map(f => {
        const stat = [DIFF_STATUS[f.status], [f.added ? '<span class="mb-plus">+' + f.added + '</span>' : '', f.removed ? '<span class="mb-minus">−' + f.removed + '</span>' : ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
        const rows = f.lines.map(l => {
            if (l.type === 'hunk' || l.type === 'meta')
                return '<tr class="mb-' + l.type + '"><td class="mb-num"></td><td class="mb-num"></td><td class="mb-code">' + escape(l.text) + '</td><td class="mb-cmt"></td></tr>';
            const key = l.new === null ? null : f.name + ':' + l.new;
            const sign = { add: '+', del: '−', context: ' ' }[l.type];
            let row = '<tr class="mb-' + l.type + '"' + (key ? ' data-mb-line="' + escape(key) + '"' : '') + '><td class="mb-num">' + (l.old ?? '') + '</td><td class="mb-num">' + (l.new ?? '') + '</td><td class="mb-code"><span class="mb-sign">' + sign + '</span>' + escape(l.text) + '</td><td class="mb-cmt">' + (key ? '<button class="mb-comment-toggle" type="button" data-mb-comment aria-expanded="false" aria-label="Commenta la riga ' + l.new + ' di ' + escape(f.name) + '">commenta</button>' : '') + '</td></tr>';
            if (key && Object.hasOwn(notes, key)) {
                row += '<tr class="mb-note-row"><td colspan="4"><div class="mb-line-note">' + inline(notes[key]) + '</div></td></tr>';
                delete notes[key];
            }
            return row;
        }).join('');
        return '<details class="mb-diff-file" open><summary><span class="mb-diff-arrow" aria-hidden="true">▸</span><span class="mb-diff-name">' + escape(f.name) + '</span><span class="mb-diff-stat">' + stat + '</span></summary><div class="mb-diff-body"><table class="mb-diff-lines"><tbody>' + rows + '</tbody></table></div></details>';
    }).join('');
    const unmatched = Object.keys(notes)[0];
    if (unmatched !== undefined)
        throw new Error(where + ' note ' + JSON.stringify(unmatched) + ' matches no line of the new side; keys are "<file>:<line of the new side>"');
    return '<div class="mb-diff">' + (filesPage ? '<div class="mb-diff-tools"><button class="mb-diff-all" type="button" data-mb-diff-all>Chiudi tutti</button></div>' : '') + html + '</div>';
}
// A text field in an answer, under the options: always there, or only for the options listed in "for". A saved
// answer fills it back. artifact-blocks.js shows it, checks it and queues { choice, text }.
function questionText(card, q, answer) {
    if (q.text === undefined)
        return '';
    const t = q.text, values = q.options.map(o => o.value);
    if (!t || typeof t !== 'object' || Array.isArray(t) || (t.label !== undefined && typeof t.label !== 'string') || (t.placeholder !== undefined && typeof t.placeholder !== 'string')
        || (t.for !== undefined && (!Array.isArray(t.for) || !t.for.length || t.for.some(v => !values.includes(v)))))
        throw new Error('Card ' + card.id + ': question.text must be { "label": "Quali modifiche?", "placeholder": "...", "for": ["<value of an option>"] }; "for" lists values of the options and may be left out to show the text always');
    const shown = t.for === undefined || t.for.includes(answer?.choice);
    return '<div class="mb-answer-text"' + (t.for === undefined ? '' : ' data-mb-for="' + escape(JSON.stringify(t.for.map(String))) + '"') + (shown ? '' : ' hidden') + '><label><span class="mb-answer-label">' + inline(t.label ?? 'Il tuo testo') + '</span><textarea data-mb-field="' + card.id + ':text" name="text" rows="3"' + (t.placeholder ? ' placeholder="' + escape(t.placeholder) + '"' : '') + '>' + escape(typeof answer?.text === 'string' ? answer.text : '') + '</textarea></label></div>';
}
// The index of the sections. With tabs: true it is the tab bar: artifact-blocks.js shows one
// section at a time; without JS every section stays visible, one under the other. A section count shows beside its title.
function sectionIndex(input) {
    if (input.tabs !== undefined && typeof input.tabs !== 'boolean')
        throw new Error('tabs must be true or false');
    const tabs = input.tabs === true;
    return '<nav' + (tabs ? ' class="mb-tabs" aria-label="Schede"' : '') + '>' + input.sections.map(s => {
        if (s.count !== undefined && !(Number.isInteger(s.count) && s.count >= 0) && !(typeof s.count === 'string' && s.count.trim()))
            throw new Error('Section ' + s.id + ': count must be a whole number or a short text, like 3 or "2 nuove"');
        return '<a href="#' + s.id + '"' + (tabs ? ' data-mb-tab="' + s.id + '" data-lavish-action' : '') + '>' + escape(s.title) + (s.count === undefined ? '' : '<span class="mb-count">' + escape(s.count) + '</span>') + '</a>';
    }).join('') + '</nav>';
}
// Optional fields of a card and of a page that need the building-block assets. A page without any of them keeps the
// base assets only, so its bytes do not change.
const CARD_BLOCKS = ['tone', 'labels', 'help', 'summary', 'voice', 'table', 'notes', 'diff', 'events', 'transcript'];
const PAGE_BLOCKS = ['tabs', 'header', 'pills'];
const usesBlocks = (input, family) => NAMED_THEMES.includes(family) || PAGE_BLOCKS.some(k => input[k] !== undefined) || (input.sections || []).some(section => section.count !== undefined || (section.cards || []).some(card => card && (CARD_BLOCKS.some(k => card[k] !== undefined) || card.question?.text !== undefined)));
// Theme family (laboratorio-stile/lavish/DESIGN.md): drawn once per artifact and kept in every revision.
export const FAMILIES = ['B', 'F', 'E2', 'G2', 'D3'];
// Themes asked by name only, never drawn: «revisione» is the look of the approved review page (S53, 22 novembre 2026).
export const NAMED_THEMES = ['revisione'];
export function familyFor(seed) { return FAMILIES[createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % FAMILIES.length]; }
// Canonical JSON: key order in input.json never changes a fingerprint.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value ?? null);
// What the reader sees as written by the agent. The reader's own answers and unanswered comments are excluded.
export function cardFingerprint(card, comments = []) {
    const content = { title: card.title, status: card.status || 'info', paragraphs: card.paragraphs || [], fields: card.fields, metadata: card.metadata, clarification: card.clarification, question: card.question, ...Object.fromEntries(CARD_BLOCKS.map(k => [k, card[k]])), comments: comments.filter(c => c.response).map(c => ({ id: c.id, text: c.text, response: c.response })) };
    return createHash('sha256').update(canonical(content)).digest('hex').slice(0, 16);
}
// Reads the render record embedded by a previous render of the same artifact; null when absent or unreadable.
export function renderRecord(html) {
    const match = /<script type="application\/json" id="mb-render">([^<]*)<\/script>/.exec(String(html || ''));
    if (!match)
        return null;
    try {
        const record = JSON.parse(match[1]);
        return record && typeof record === 'object' && record.cards && typeof record.cards === 'object' ? record : null;
    }
    catch {
        return null;
    }
}
// How to answer is said once, in the usage guide, never in each card. Only pages with a question carry it.
const ANSWER_HELP = ['Tocca una risposta per sceglierla, toccala di nuovo per accodarla.', 'Con la tastiera, premi Spazio sull’opzione scelta per accodarla.'];
// The marks next to an option that is in the queue or was sent. They are hidden until artifact.js sees the option
// among the chrome's queued or delivered anchors; when shown, the mark's words become part of the option's accessible name.
const QUEUED_MARK = '<span class="mb-queued-mark"><span aria-hidden="true">✓ </span>in coda</span><span class="mb-sent-mark"><span aria-hidden="true">✓ </span>inviata</span>';
const sameCards = (a, b) => { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
export async function renderDocument(input, options = {}) {
    if (!input.title)
        throw new Error('title and a collapsible usage guide are required');
    const state = input.state || { revision: 0, answers: {}, comments: [] };
    const previous = typeof options.previous === 'string' ? renderRecord(options.previous) : (options.previous || null);
    if (input.theme !== undefined && !FAMILIES.includes(input.theme) && !NAMED_THEMES.includes(input.theme))
        throw new Error('Unknown theme family: ' + input.theme + ' (expected ' + FAMILIES.concat(NAMED_THEMES).join(', ') + ')');
    const family = input.theme || (FAMILIES.includes(previous?.theme) || NAMED_THEMES.includes(previous?.theme) ? previous.theme : familyFor(input.id ?? options.id ?? input.title));
    // The theme «revisione» has no usage guide, as on the approved review page (S3); every other theme requires it.
    const guided = family !== 'revisione';
    if (guided && !input.guide)
        throw new Error('title and a collapsible usage guide are required');
    const fingerprints = {};
    for (const section of input.sections || [])
        for (const card of section.cards || [])
            if (card && typeof card.id === 'string')
                fingerprints[card.id] = cardFingerprint(card, (state.comments || []).filter(c => c.card === card.id));
    // Novelty compares with the previous revision. A repeated render of the same content and state revision keeps
    // the same novelties; a new state revision (answers applied: a new round) compares with the page it replaces.
    const revision = Number(state.revision || 0);
    const repeated = previous && sameCards(previous.cards, fingerprints) && previous.revision === revision;
    const base = previous ? (repeated ? (previous.base ?? null) : previous.cards) : null;
    const novelty = id => !base ? '' : !(id in base) ? 'new' : base[id] !== fingerprints[id] ? 'changed' : '';
    const ids = new Set(['usage-guide', 'mb-state', 'mb-render']);
    const unique = id => { if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id || '') || ids.has(id))
        throw new Error('Every section/card needs a unique stable id: ' + id); ids.add(id); return id; };
    for (const section of input.sections || []) {
        unique(section.id);
        for (const card of section.cards)
            unique(card.id);
    }
    // In the theme «revisione» with tabs, the tab names the section: no heading repeats it.
    const review = family === 'revisione', tabTitled = review && input.tabs === true;
    const sections = (input.sections || []).map(section => {
        return '<section id="' + section.id + '"' + (tabTitled ? ' aria-label="' + escape(section.title) + '">' : '><h2>' + escape(section.title) + '</h2>') + section.cards.map(card => {
            let helpId;
            if (card.help !== undefined || card.summary !== undefined) {
                helpId = 'mb-help-' + card.id;
                while (ids.has(helpId))
                    helpId += '-';
                unique(helpId);
            }
            const answer = state.answers?.[card.id];
            const status = answer ? 'answered' : (card.status || 'info');
            if (!['waiting', 'answered', 'info', 'blocked'].includes(status))
                throw new Error('Unknown card status');
            const context = (card.metadata || card.clarification) ? '<details class="context" data-mb-field="' + card.id + ':context"><summary>Contesto e chiarimenti</summary>' + (card.metadata ? '<div class="meta">' + inline(card.metadata) + '</div>' : '') + paragraphs(card.clarification ? [card.clarification] : []) + '</details>' : '';
            let question = '';
            if (card.question) {
                const q = card.question;
                // The reason for the recommended option sits right under the answers, in the card body style.
                let reason = '';
                if (q.reason !== undefined) {
                    if (!q.options.some(o => o.recommended === true))
                        throw new Error('Card ' + card.id + ': question.reason explains the recommended option; mark that option with "recommended": true or drop the reason');
                    reason = fieldsTable([['Motivazione', filledParagraphs(q.reason, 'Card ' + card.id + ': question.reason is empty; write the reason in one or two sentences')]], 'mb-fields mb-reason');
                }
                question = '<form data-mb-question="' + card.id + '"><fieldset><legend>' + inline(q.label || 'La tua risposta') + '</legend>' + q.options.map(o => '<label class="option' + (o.recommended === true ? ' mb-recommended' : '') + '"><input data-mb-field="' + card.id + ':choice' + '" name="choice" type="radio" value="' + escape(o.value) + '"' + (answer?.choice === o.value ? ' checked' : '') + '><span>' + inline(o.label) + '</span>' + QUEUED_MARK + '</label>').join('') + questionText(card, q, answer) + reason + '<span class="queue-status" role="status"></span></fieldset></form>';
            }
            const comments = (state.comments || []).filter(c => c.card === card.id);
            const follow = comments.length ? '<details class="followup"><summary>Commenti e seguito (' + comments.length + ')</summary>' + comments.map(c => fieldsTable([['Commento', '<p><span class="sentence">' + escape(c.text) + '</span></p>'], ...(c.response ? [['Risposta', paragraphs(c.response)]] : [])], 'mb-fields mb-comment')).join('') + '</details>' : '';
            const fresh = novelty(card.id), filesPage = review && card.diff !== undefined;
            return '<article class="card" id="' + card.id + '" data-mb-state="' + status + '"' + (card.tone !== undefined ? ' data-mb-tone="' + toneOf(card.tone, 'Card ' + card.id) + '"' : '') + (fresh ? ' data-mb-new="' + fresh + '"' : '') + (filesPage ? ' data-mb-files' : '') + '><button class="voice" type="button" data-mb-voice' + voiceText(card) + ' aria-label="Leggi questa scheda">🔊</button>' + cardHead(card, helpId) + paragraphs(card.paragraphs) + cardFields(card) + cardTable(card) + cardEvents(card) + cardTranscript(card) + cardDiff(card, filesPage) + context + question + cardNotes(card) + follow + '</article>';
        }).join('') + '</section>';
    }).join('');
    const asks = (input.sections || []).some(section => (section.cards || []).some(card => card?.question));
    const blocks = usesBlocks(input, family), head = headerParts(input.header);
    // In the theme «revisione» a title ending in « #<number> » (the PR) shows the number muted, as on the review page.
    const number = review ? / #\d+$/.exec(input.title) : null;
    const title = number ? escape(input.title.slice(0, number.index)) + ' <span class="mb-number">' + escape(number[0].slice(1)) + '</span>' : escape(input.title);
    const css = (await Promise.all(['fonts.css', 'artifact.css', ...(blocks ? ['artifact-blocks.css'] : [])].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const js = (await Promise.all(['artifact.js', ...(blocks ? ['artifact-blocks.js'] : [])].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const record = { version: 1, theme: family, revision, cards: fingerprints, base };
    return '<!doctype html>\n<html lang="it" data-mb-theme="dark" data-mb-family="' + family + '" data-mb-state-version="' + Number(state.revision || 0) + '" data-lavish-annotate="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(input.title) + '</title><style>' + css + '</style><script>' + js + '</script></head><body><main>' + head.notice + '<header>' + head.before + '<h1>' + title + '</h1>' + head.after + paragraphs(input.intro ? [input.intro] : []) + pillsOf(input.pills) + '</header>' + (guided ? '<details class="guide" id="usage-guide"><summary>Come usare questa pagina</summary>' + filledParagraphs([input.guide], 'title and a collapsible usage guide are required') + (asks ? paragraphs([ANSWER_HELP]).replace('<p>', '<p class="mb-answer-help">') : '') + '</details>' : '') + sectionIndex(input) + sections + '</main><script type="application/json" id="mb-state">' + JSON.stringify(state).replaceAll('<', '\\u003c') + '</script><script type="application/json" id="mb-render">' + JSON.stringify(record).replaceAll('<', '\\u003c') + '</script></body></html>\n';
}
