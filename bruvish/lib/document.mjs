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
const plain = value => inline(value).replace(/<[^>]*>/g, '');
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
// The theme «vibe» names the fixed half after the genre of the card and titles the intent column with an h2.
function cardHead(card, helpId, { meaning: meaningTitle = 'A cosa ti serve', tag = 'h3' } = {}) {
    const title = '<' + tag + '>' + inline(card.title) + '</' + tag + '>';
    const labels = card.labels === undefined ? [] : taggedList(card.labels, 'Card ' + card.id + ': labels');
    if (!labels.length && card.help === undefined && card.summary === undefined)
        return title;
    let toggle = '', help = '';
    // The bubble has a fixed part (what the card means, the same on every page) and a summary written for this card.
    if (card.help !== undefined || card.summary !== undefined) {
        const meaning = card.help === undefined ? '' : '<b class="mb-help-title">' + escape(meaningTitle) + '</b>' + filledParagraphs(card.help, 'Card ' + card.id + ': help is a text of one or more sentences, like "Serve a decidere se unire il ramo."');
        const summary = card.summary === undefined ? '' : '<div class="mb-help-summary"><b class="mb-help-title">Cosa notare qui</b>' + filledParagraphs(card.summary, 'Card ' + card.id + ': summary is a text of one or more sentences, like "Un solo file cambia: la riga 46 di src/cli.ts."') + '</div>';
        toggle = '<button class="mb-help-toggle" type="button" data-mb-help aria-expanded="false" aria-controls="' + helpId + '" aria-label="A cosa serve questa carta">?</button>';
        help = '<div class="mb-help" id="' + helpId + '" hidden>' + meaning + summary + '</div>';
    }
    return '<div class="mb-card-head">' + title + (labels.length ? '<span class="mb-labels">' + labels.map(l => '<span class="mb-label" data-tone="' + l.tone + '">' + inline(l.text) + '</span>').join('') + '</span>' : '') + toggle + '</div>' + help;
}
// Operations of the page (Mattia, 23 November 2026, S20): no «Operazioni» section. The header carries the main operation
// for the state (alternatives side by side) and a «⋯» menu; a click opens a confirmation dropdown that says what happens.
// Cards carry their own operation with a text field (comment, review, reviewer). Every operation is queued for the agent
// as { tag: "operation", data: { view, operation, text } }, bound to the view id of the page.
const OP_ID = /^[a-z][a-z0-9-]{0,39}$/;
// Icons of the header operations (header D, Mattia, 25 November 2026): a closed set drawn in the approved mockup
// (laboratorio-stile/lavish/revisione-pr/intestazione-D.html), never SVG from the JSON. «altre» (three dots) is the
// icon of the «⋯» menu, never of an operation.
const OP_ICONS = {
    unisci: '<circle cx="4" cy="3.25" r="1.75"/><circle cx="4" cy="12.75" r="1.75"/><circle cx="12" cy="8" r="1.75"/><path d="M4 5v6M4 5c0 3 3 3 6.25 3"/>',
    pronta: '<circle cx="8" cy="8" r="6.5"/><path d="M5 8.3l2.1 2.1L11.2 6"/>',
    revisore: '<circle cx="6" cy="5" r="2.5"/><path d="M1.5 14c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5M12.5 3.5v4M10.5 5.5h4"/>',
    chiudi: '<circle cx="4" cy="3.25" r="1.75"/><circle cx="4" cy="12.75" r="1.75"/><circle cx="12" cy="12.75" r="1.75"/><path d="M4 5v6M12 7.2v3.8M10.3 1.6l3.4 3.4M13.7 1.6l-3.4 3.4"/>',
    altre: '<circle cx="3" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="13" cy="8" r="1.1" fill="currentColor"/>',
};
export const OPERATION_ICONS = ['unisci', 'pronta', 'revisore', 'chiudi'];
const opIcon = name => '<svg class="mb-op-icon" viewBox="0 0 16 16" aria-hidden="true">' + OP_ICONS[name] + '</svg>';
function headerActions(actions) {
    if (actions === undefined)
        return '';
    const shape = 'actions must be { "view": "<id of this page>", "primary": [{ "operation": "unisci", "label": "Unisci", "confirm": "What happens.", "icon": "unisci" }], "menu": [{ "operation": "chiudi", "label": "Chiudi", "hint": "...", "confirm": "...", "danger": true, "icon": "chiudi" }], "fixed": [{ "operation": "revisore", "label": "Assegna un revisore", "confirm": "...", "field": "line", "placeholder": "...", "required": true, "icon": "revisore" }] }; icon is one of ' + OPERATION_ICONS.join(', ') + ' or absent';
    const item = o => o && typeof o === 'object' && !Array.isArray(o) && OP_ID.test(o.operation || '') && typeof o.label === 'string' && o.label.trim()
        && typeof o.confirm === 'string' && o.confirm.trim() && (o.hint === undefined || typeof o.hint === 'string') && (o.danger === undefined || typeof o.danger === 'boolean')
        && (o.icon === undefined || OPERATION_ICONS.includes(o.icon));
    // A fixed operation may ask for a text in its confirmation dropdown: a single line (a login).
    const fixedItem = o => item(o) && (o.field === undefined || o.field === 'line') && (o.placeholder === undefined || typeof o.placeholder === 'string')
        && (o.required === undefined || typeof o.required === 'boolean') && !(o.required && o.field === undefined) && o.danger === undefined;
    if (!actions || typeof actions !== 'object' || Array.isArray(actions) || typeof actions.view !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(actions.view)
        || (actions.primary !== undefined && !Array.isArray(actions.primary)) || (actions.menu !== undefined && !Array.isArray(actions.menu)) || (actions.fixed !== undefined && !Array.isArray(actions.fixed))
        || ![...(actions.primary || []), ...(actions.menu || [])].every(item) || !(actions.fixed || []).every(fixedItem))
        throw new Error(shape);
    const attrs = o => ' data-mb-op="' + o.operation + '" data-mb-confirm-title="' + escape(o.label) + '" data-mb-confirm="' + escape(inline(o.confirm)) + '"';
    const fieldAttrs = o => o.field === undefined ? '' : ' data-mb-field-kind="' + o.field + '"' + (o.placeholder ? ' data-mb-placeholder="' + escape(o.placeholder) + '"' : '') + (o.required ? ' data-mb-required' : '');
    const all = [...(actions.primary || []), ...(actions.fixed || []), ...(actions.menu || [])];
    if (all.some(o => o.icon !== undefined))
        return iconActions(actions, attrs, fieldAttrs);
    const primary = (actions.primary || []).length ? '<div class="mb-actions-primary">' + actions.primary.map((o, i) => '<button type="button" class="mb-action' + (i === 0 ? ' mb-action-main' : '') + '"' + attrs(o) + '>' + inline(o.label) + '</button>').join('') + '</div>' : '';
    // Fixed operations are always visible beside the main ones, whatever the state of the page; they never become the
    // main alternative. Without them the header keeps the markup it had before.
    const fixed = (actions.fixed || []).length ? '<div class="mb-actions-fixed">' + actions.fixed.map(o => '<button type="button" class="mb-action-fixed"' + attrs(o) + fieldAttrs(o) + '>' + inline(o.label) + '</button>').join('') + '</div>' : '';
    const menu = (actions.menu || []).length ? '<details class="mb-actions-menu"><summary>Altre operazioni ⋯</summary><div class="mb-actions-items">' +
        actions.menu.map(o => '<button type="button" class="mb-action-item' + (o.danger ? ' mb-danger' : '') + '"' + attrs(o) + '>' + inline(o.label) + (o.hint ? '<small>' + inline(o.hint) + '</small>' : '') + '</button>').join('') + '</div></details>' : '';
    return '<div class="mb-actions" data-mb-actions>' + (fixed ? '<div class="mb-actions-row">' + primary + fixed + '</div>' : primary) + menu + '<div class="mb-confirm" role="dialog" aria-label="Conferma" hidden></div></div>';
}
// Header operations as icon buttons (header D): one row, in a fixed place top right. Every button keeps the classes and
// the attributes of its text form (data-mb-op, confirmation, field, required), so a click opens the same confirmation
// and sends the same message; the name moves to aria-label and to the tooltip (data-mb-name). An operation without an
// icon stays a text button. A menu operation with an icon stands beside the menu (red when dangerous); the menu keeps
// the others, behind the three-dots icon.
function iconActions(actions, attrs, fieldAttrs) {
    const icon = o => o.icon === undefined ? '' : ' mb-icon-button';
    // The name of an icon is the whole label of the operation, with its hint («Chiudi la PR senza unirla»).
    const name = o => plain(o.hint ? o.label + ' ' + o.hint : o.label);
    const named = o => o.icon === undefined ? '' : ' data-mb-icon="' + o.icon + '" aria-label="' + name(o) + '" data-mb-name="' + name(o) + '"';
    const content = o => o.icon === undefined ? inline(o.label) : opIcon(o.icon);
    const primary = (actions.primary || []).length ? '<div class="mb-actions-primary">' + actions.primary.map((o, i) => '<button type="button" class="mb-action' + (i === 0 ? ' mb-action-main' : '') + icon(o) + '"' + attrs(o) + named(o) + '>' + content(o) + '</button>').join('') + '</div>' : '';
    const fixed = (actions.fixed || []).length ? '<div class="mb-actions-fixed">' + actions.fixed.map(o => '<button type="button" class="mb-action-fixed' + icon(o) + '"' + attrs(o) + fieldAttrs(o) + named(o) + '>' + content(o) + '</button>').join('') + '</div>' : '';
    const menuItems = actions.menu || [], out = menuItems.filter(o => o.icon !== undefined), kept = menuItems.filter(o => o.icon === undefined);
    const beside = out.map(o => '<button type="button" class="mb-action-item' + (o.danger ? ' mb-danger' : '') + ' mb-icon-button"' + attrs(o) + named(o) + '>' + opIcon(o.icon) + '</button>').join('');
    const menu = kept.length ? '<details class="mb-actions-menu"><summary class="mb-icon-button" aria-label="Altre operazioni" data-mb-name="Altre operazioni">' + opIcon('altre') + '</summary><div class="mb-actions-items">' +
        kept.map(o => '<button type="button" class="mb-action-item' + (o.danger ? ' mb-danger' : '') + '"' + attrs(o) + '>' + inline(o.label) + (o.hint ? '<small>' + inline(o.hint) + '</small>' : '') + '</button>').join('') + '</div></details>' : '';
    return '<div class="mb-actions mb-actions-icons" data-mb-actions><div class="mb-actions-row">' + primary + fixed + beside + menu + '</div><div class="mb-confirm" role="dialog" aria-label="Conferma" hidden></div></div>';
}
// A card operation: a text field (comment), a single-line field (login), or a choice among review outcomes with a text.
function cardAction(card) {
    if (card.action === undefined)
        return '';
    const a = card.action, where = 'Card ' + card.id + ': action';
    const shape = where + ' must be { "operation": "commento", "submit": "Pubblica", "field": "text" | "line", "placeholder": "...", "required": true } or, with choices, { "choices": [{ "operation": "approva", "label": "Approva", "hint": "...", "disabled": false, "required": false }], "submit": "Invia" }';
    if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.submit !== 'string' || !a.submit.trim() || (a.placeholder !== undefined && typeof a.placeholder !== 'string'))
        throw new Error(shape);
    const choices = a.choices;
    if (choices !== undefined && (!Array.isArray(choices) || !choices.length || !choices.every(c => c && OP_ID.test(c.operation || '') && typeof c.label === 'string' && c.label.trim() && (c.hint === undefined || typeof c.hint === 'string')) || choices.every(c => c.disabled)))
        throw new Error(shape);
    if (choices === undefined && (!OP_ID.test(a.operation || '') || !['text', 'line'].includes(a.field)))
        throw new Error(shape);
    const name = 'mb-op-' + card.id, first = choices ? choices.findIndex(x => !x.disabled) : -1;
    const radios = choices ? '<div class="mb-op-choices">' + choices.map((c, i) => '<label' + (c.disabled ? ' class="mb-op-off"' : '') + '><input type="radio" name="' + escape(name) + '" value="' + c.operation + '"' + (c.required ? ' data-mb-required' : '') +
        (c.disabled ? ' disabled' : (i === first ? ' checked' : '')) + '><span>' + inline(c.label) + (c.hint ? '<small>' + inline(c.hint) + '</small>' : '') + '</span></label>').join('') + '</div>' : '';
    const ph = escape(a.placeholder || '');
    const field = choices || a.field === 'text' ? '<textarea class="mb-op-text" placeholder="' + ph + '"></textarea>' : '<input type="text" class="mb-op-text" placeholder="' + ph + '">';
    return '<form class="mb-op-form" data-mb-op-form' + (choices ? '' : ' data-mb-op="' + a.operation + '"' + (a.required ? ' data-mb-required' : '')) + '>' + radios + field +
        '<div class="mb-op-row"><span class="mb-op-status" role="status"></span><button type="submit" class="mb-op-submit">' + inline(a.submit) + '</button></div></form>';
}
// Card variant. "flusso": a review that goes through a flow of its own (each choice starts a sequence of steps, said in
// its hint and in the card paragraphs). The choices become tiles, label and what happens, with the chosen one framed.
const VARIANTS = ['flusso'];
function cardVariant(card) {
    if (card.variant === undefined)
        return '';
    if (!VARIANTS.includes(card.variant))
        throw new Error('Card ' + card.id + ': variant must be one of ' + VARIANTS.join(', ') + ' or absent (got ' + JSON.stringify(card.variant) + ')');
    if (!card.action || !Array.isArray(card.action.choices))
        throw new Error('Card ' + card.id + ': variant "flusso" needs an action with choices, like { "submit": "Invia", "choices": [{ "operation": "approva", "label": "Approva", "hint": "What happens." }] }');
    return ' data-mb-variant="' + card.variant + '"';
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
const STATES = { bozza: ['Bozza', 'draft'], aperta: ['Aperta', 'open'], unita: ['Unita', 'merged'], chiusa: ['Chiusa', 'closed'] };
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
    // The state of a PR (Mattia, 25 November 2026): four values, each with its colour and icon, so the page says the outcome
    // after a merge or a close in the header. It is not a tone: the colours of the other blocks do not change.
    if (header.state !== undefined) {
        if (!Object.hasOwn(STATES, header.state))
            throw new Error('header.state must be one of ' + Object.keys(STATES).join(', ') + ' (got ' + JSON.stringify(header.state) + ')');
        if (header.badge !== undefined)
            throw new Error('header.state replaces header.badge: give one of the two');
        const [text, name] = STATES[header.state];
        badge = '<span class="mb-badge" data-state="' + header.state + '">' + icon(name) + text + '</span>';
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
    const facts = headerFacts(header);
    const meta = (header.meta || []).map(m => '<span class="mb-meta-item">' + inline(m) + '</span>').join('');
    // The line count closes the subtitle, in the colours of the diff: added green, removed red.
    const stat = header.stat ? '<span class="mb-plus">+' + header.stat.added + '</span> <span class="mb-minus">−' + header.stat.removed + '</span>' : '';
    const subtitle = [header.subtitle ? inline(header.subtitle) : '', stat].filter(Boolean).join(' · ');
    return {
        notice: header.notice === undefined ? '' : '<p class="mb-notice">' + inline(header.notice) + '</p>',
        before: badge || meta ? '<div class="mb-header-meta">' + badge + meta + '</div>' : '',
        after: subtitle ? '<p class="mb-subtitle">' + subtitle + '</p>' : '',
        badge, facts,
    };
}
// Facts table of header D (Mattia, 25 November 2026): the data of the page as columns, label over value, given by the
// JSON as a list (PR, Repository, Aperta da, … on a review page; any other list elsewhere). A value is a text with
// inline marks, a link (https only, opens in a new tab) or a delta (+added green, −removed red, after an optional text).
// The facts replace meta, subtitle and stat of the classic header.
const FACT_TYPES = ['link', 'delta'];
function headerFacts(header) {
    if (header.facts === undefined)
        return '';
    const shape = 'header.facts must be a non-empty array of { "label": "Repository", "text": "`owner/repo`" }, { "label": "PR", "text": "#16", "type": "link", "href": "https://…" } or { "label": "Modifiche", "text": "1 commit · 1 file", "type": "delta", "added": 6, "removed": 0 }';
    const count = n => Number.isInteger(n) && n >= 0, text = t => typeof t === 'string' && t.trim();
    const ok = f => f && typeof f === 'object' && !Array.isArray(f) && text(f.label) && (f.type === undefined || FACT_TYPES.includes(f.type))
        && (f.type === 'delta' ? (f.text === undefined || text(f.text)) && count(f.added) && count(f.removed) : text(f.text))
        && (f.type === 'link' ? typeof f.href === 'string' && /^https:\/\/[^\s]+$/.test(f.href) : f.href === undefined);
    if (!Array.isArray(header.facts) || !header.facts.length || !header.facts.every(ok))
        throw new Error(shape);
    if (header.meta !== undefined || header.subtitle !== undefined || header.stat !== undefined)
        throw new Error('header.facts replaces meta, subtitle and stat: give the same data as facts');
    const value = f => f.type === 'link' ? '<a class="mb-fact-link" href="' + escape(f.href) + '" target="_blank" rel="noopener noreferrer" data-lavish-action>' + inline(f.text) + ' ↗</a>'
        : f.type === 'delta' ? (f.text === undefined ? '' : inline(f.text) + ' · ') + '<span class="mb-plus">+' + f.added + '</span> <span class="mb-minus">−' + f.removed + '</span>' : inline(f.text);
    return '<table class="mb-facts"><thead><tr>' + header.facts.map(f => '<th scope="col">' + escape(f.label) + '</th>').join('') + '</tr></thead><tbody><tr>' +
        header.facts.map(f => '<td data-label="' + escape(f.label) + '"><span class="mb-fact">' + value(f) + '</span></td>').join('') + '</tr></tbody></table>';
}
// A pill with "level": true is a level (risk, outcome): full semantic colour, like a level cell of a table.
// A pill with "section": "<id>" leads to that section (its tab, on a page with tabs), like «1 problema» to the diagnostics.
function pillsOf(pills, sectionIds = []) {
    if (pills === undefined)
        return '';
    taggedList(pills, 'pills');
    if (pills.some(p => p.level !== undefined && typeof p.level !== 'boolean'))
        throw new Error('pills: level must be true or false, like { "text": "Rischio basso", "tone": "verde", "level": true }');
    const wrong = pills.find(p => p.section !== undefined && !sectionIds.includes(p.section));
    if (wrong)
        throw new Error('pills: section must be the id of a section of this page, like { "text": "1 problema", "tone": "rosso", "section": "' + (sectionIds.at(-1) || 'diagnostica') + '" } (got ' + JSON.stringify(wrong.section) + ')');
    return '<div class="mb-pills">' + pills.map(p => {
        const kind = p.level ? 'mb-level' : 'mb-pill';
        return p.section === undefined ? '<span class="' + kind + '" data-tone="' + p.tone + '">' + inline(p.text) + '</span>'
            : '<a class="' + kind + '" data-tone="' + p.tone + '" href="#' + p.section + '" data-mb-goto="' + p.section + '" data-lavish-action>' + inline(p.text) + '</a>';
    }).join('') + '</div>';
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
// Images of a card (Mattia, 25 November 2026: screenshots taken in the VM): each a file beside the page, by name only
// (png, jpg, jpeg, webp; no URL, no path, no ..), with a one-line caption. A grid of figures, the caption under each,
// lazy loading, alt from the caption; a click opens the image large in the page (artifact-blocks.js).
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:png|jpe?g|webp)$/i;
function cardImages(card) {
    if (card.images === undefined)
        return '';
    const where = 'Card ' + card.id + ': images';
    if (!Array.isArray(card.images) || !card.images.length || card.images.some(i => !i || typeof i !== 'object' || Array.isArray(i) || Object.keys(i).some(k => k !== 'file' && k !== 'caption')))
        throw new Error(where + ' must be a non-empty array of { "file": "cattura-1.png", "caption": "…" }, with no other field');
    card.images.forEach((image, n) => {
        if (typeof image.file !== 'string' || !IMAGE_FILE.test(image.file))
            throw new Error(where + '[' + n + '].file ' + JSON.stringify(image.file ?? null) + ' is not the name of an image beside the page: write only the file name of a png, jpg, jpeg or webp in the same folder as the page, like "cattura-1.png"');
        if (typeof image.caption !== 'string' || !image.caption.trim() || /[\r\n]/.test(image.caption))
            throw new Error(where + '[' + n + '].caption is missing or not one line: write one line that says what the image shows');
    });
    return '<div class="mb-images">' + card.images.map(i => { const caption = inline(i.caption.trim()), alt = plain(i.caption.trim());
        return '<figure class="mb-image"><button type="button" class="mb-image-open" data-mb-image data-lavish-action aria-label="' + escape('Apri l\'immagine grande: ') + alt + '"><img src="' + escape(i.file) + '" alt="' + alt + '" loading="lazy" decoding="async"></button><figcaption>' + caption + '</figcaption></figure>'; }).join('') + '</div>';
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
// Diagnostics of an operation executor (diagnostics in the page JSON): what the executor did with each operation the page
// or the chat sent. In the section «diagnostica» Bruvish renders two cards in place of the producer's cards with the same
// roles, in the producer's card order: the table of the attempts, most recent first, in place of carta-diagnostica-3, and
// the last problem, framed in its colour, in place of carta-diagnostica-4. A page without that section keeps its sections.
// The executor writes these facts, never the agent; times are Unix seconds, shown in the local time of the renderer.
const OUTCOMES = { fatto: ['Fatto', 'verde'], parziale: ['Fatto a metà', 'giallo'], rimandato: ['Rimandato', 'giallo'], rifiutato: ['Rifiutato', 'rosso'], incerto: ['Incerto', 'rosso'], scartato: ['Scartato', 'blu'] };
const outcomeOf = value => value === undefined || value === null || value === '' ? ['In corso', 'giallo'] : OUTCOMES[value] || [String(value), 'blu'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const two = n => String(n).padStart(2, '0');
const localTime = t => { if (typeof t !== 'number' || !Number.isFinite(t)) return '—'; const d = new Date(t * 1000); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + two(d.getHours()) + ':' + two(d.getMinutes()); };
const ATTEMPT_TEXTS = ['id', 'operazione', 'fonte', 'esito', 'motivo', 'passo', 'dettaglio', 'frase'];
// An operation name shows as code when it is a plain identifier; anything else stays text, escaped like every other.
const operationText = op => typeof op === 'string' && OP_ID.test(op) ? '`' + op + '`' : (op ? String(op) : '?');
function withDiagnostics(input) {
    const d = input.diagnostics;
    if (d === undefined)
        return input;
    const shape = 'diagnostics must be { "attempts": [{ "ora": 1795435566, "operazione": "unisci", "fonte": "pagina", "esito": "rifiutato", "motivo": "...", "passo": "...", "dettaglio": "...", "frase": "..." }], "total": 1, "problem": { ...the last attempt that did not succeed } | null }';
    const attemptOk = a => a && typeof a === 'object' && !Array.isArray(a) && ATTEMPT_TEXTS.every(k => a[k] === undefined || a[k] === null || typeof a[k] === 'string')
        && (a.ora === undefined || a.ora === null || (typeof a.ora === 'number' && Number.isFinite(a.ora)));
    if (!d || typeof d !== 'object' || Array.isArray(d) || (d.attempts !== undefined && (!Array.isArray(d.attempts) || !d.attempts.every(attemptOk)))
        || (d.total !== undefined && !(Number.isInteger(d.total) && d.total >= 0)) || (d.problem !== undefined && d.problem !== null && !attemptOk(d.problem)))
        throw new Error(shape);
    const attempts = d.attempts || [], total = Math.max(d.total ?? attempts.length, attempts.length);
    let problem = null;
    if (d.problem) {
        const p = d.problem, [label, tone] = outcomeOf(p.esito), serious = tone === 'rosso';
        const fields = [{ label: 'Operazione', paragraphs: [[operationText(p.operazione), localTime(p.ora), p.fonte].filter(Boolean).join(' · ')] },
            { label: 'Causa', paragraphs: [p.motivo || '—'] }, { label: 'Cosa fare', paragraphs: [p.passo || '—'] }, ...(p.frase ? [{ label: 'Frase', paragraphs: ['«' + p.frase + '»'] }] : [])];
        problem = { id: 'mb-diag-problem', title: 'Ultimo problema', tone, ...(serious ? { status: 'blocked' } : {}), labels: [{ text: label, tone }], fields,
            ...(p.dettaglio ? { transcript: { summary: 'Dettaglio tecnico', text: p.dettaglio } } : {}) };
    }
    const help = 'Il registro dell\'esecutore delle operazioni, scritto dall\'esecutore e non dall\'agente. **Rifiutato** vuol dire che l\'operazione non è partita; **Incerto** vuol dire: controlla a mano prima di riprovare.';
    const tried = attempts.length ? {
        id: 'mb-diag-attempts', title: 'Tentativi', help,
        table: { headers: ['Ora', 'Operazione', 'Fonte', 'Esito', 'Motivo', 'Cosa fare'], rows: attempts.map(a => {
            const [label, tone] = outcomeOf(a.esito);
            return [localTime(a.ora), operationText(a.operazione), a.fonte || '—', { text: label, tone }, (a.motivo || '—') + (a.frase ? ' · Frase: «' + a.frase + '»' : ''), a.passo || '—'];
        }) },
        notes: [attempts.length + ' di ' + total + ', dal più recente.'],
    } : { id: 'mb-diag-attempts', title: 'Tentativi', help, paragraphs: ['Nessun tentativo.'] };
    const replaced = { 'carta-diagnostica-3': tried, 'carta-diagnostica-4': problem };
    return { ...input, sections: (input.sections || []).map(s => s && s.id === 'diagnostica'
            ? { ...s, cards: (s.cards || []).flatMap(c => c && Object.hasOwn(replaced, c.id) ? (replaced[c.id] ? [replaced[c.id]] : []) : [c]) } : s) };
}
// The index of the sections. With tabs: true it is the tab bar: artifact-blocks.js shows one
// section at a time; without JS every section stays visible, one under the other. A section count shows beside its title.
const countOk = n => (Number.isInteger(n) && n >= 0) || (typeof n === 'string' && n.trim());
function sectionIndex(input) {
    if (input.tabs !== undefined && typeof input.tabs !== 'boolean' && input.tabs !== 'tree')
        throw new Error('tabs must be true or false, or "tree" for the tree bar');
    if (input.tabs === 'tree')
        return treeIndex(input);
    const tabs = input.tabs === true;
    return '<nav' + (tabs ? ' class="mb-tabs" aria-label="Schede"' : '') + '>' + input.sections.map(s => {
        if (s.count !== undefined && !countOk(s.count))
            throw new Error('Section ' + s.id + ': count must be a whole number or a short text, like 3 or "2 nuove"');
        return '<a href="#' + s.id + '"' + (tabs ? ' data-mb-tab="' + s.id + '" data-lavish-action' : '') + '>' + escape(s.title) + (s.count === undefined ? '' : '<span class="mb-count">' + escape(s.count) + '</span>') + '</a>';
    }).join('') + '</nav>';
}
// Tree navigation bar (tabs: "tree", Mattia, 25 November 2026, laboratorio-stile/lavish/revisione-pr/
// barra-di-navigazione-albero.html): top items and groups, in the order of the JSON; a group sits where its first section
// is and lists its sections as its parts. Beside an item: a status dot and a count or a short note. Wide, the bar is
// vertical on the left and stays put while the cards scroll; up to 820px it is horizontal on two rows (top items, then the
// parts of the open group). The renderer knows nothing of a gate: groups, dots and counts come from the JSON.
export const DOTS = ['verde', 'giallo', 'rosso', 'vuoto'];
function checkTree(input, unique) {
    if (input.tabs !== undefined && typeof input.tabs !== 'boolean' && input.tabs !== 'tree')
        throw new Error('tabs must be true or false, or "tree" for the tree bar');
    const tree = input.tabs === 'tree', sections = input.sections || [];
    if (!tree && (input.groups !== undefined || sections.some(s => s && (s.group !== undefined || s.dot !== undefined))))
        throw new Error('groups and section groups need "tabs": "tree"; so does a section dot');
    if (!tree)
        return;
    const groups = input.groups ?? [];
    const shape = 'groups must be an array of { "id": "gate", "title": "Gate", "dot": "verde", "count": "9 su 9" }, with dot and count optional';
    if (!Array.isArray(groups) || groups.some(g => !g || typeof g !== 'object' || Array.isArray(g) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(g.id || '') || typeof g.title !== 'string' || !g.title.trim()))
        throw new Error(shape);
    const dotOf = (dot, where) => { if (dot !== undefined && !DOTS.includes(dot))
        throw new Error(where + ': dot must be one of ' + DOTS.join(', ') + ' (got ' + JSON.stringify(dot) + ')'); };
    for (const g of groups) {
        unique('mb-group-' + g.id);
        dotOf(g.dot, 'Group ' + g.id);
        if (g.count !== undefined && !countOk(g.count))
            throw new Error('Group ' + g.id + ': count must be a whole number or a short text, like 3 or "9 su 9"');
    }
    const ids = groups.map(g => g.id);
    for (const s of sections) {
        dotOf(s.dot, 'Section ' + s.id);
        if (s.group !== undefined && !ids.includes(s.group))
            throw new Error('Section ' + s.id + ': group must be the id of one of the groups, like ' + JSON.stringify(ids[0] || 'gate') + ' (got ' + JSON.stringify(s.group) + ')');
    }
    const empty = groups.find(g => !sections.some(s => s.group === g.id));
    if (empty)
        throw new Error('Group ' + empty.id + ' has no section: give it at least one section with "group": ' + JSON.stringify(empty.id) + ', or drop it');
}
function treeIndex(input) {
    const dot = d => d === undefined ? '' : '<span class="mb-tree-dot" data-dot="' + d + '" aria-hidden="true"></span>';
    const count = n => n === undefined ? '' : '<span class="mb-count">' + escape(n) + '</span>';
    const item = s => {
        if (s.count !== undefined && !countOk(s.count))
            throw new Error('Section ' + s.id + ': count must be a whole number or a short text, like 3 or "2 nuove"');
        return '<a href="#' + s.id + '" data-mb-tab="' + s.id + '" data-lavish-action>' + dot(s.dot) + '<span class="mb-tree-name">' + escape(s.title) + '</span>' + count(s.count) + '</a>';
    };
    const groups = new Map((input.groups || []).map(g => [g.id, g])), done = new Set();
    // Groups start open: without the script every part stays reachable; the script closes the ones not in use.
    return '<nav class="mb-tabs mb-tree" aria-label="Schede">' + input.sections.map(s => {
        if (s.group === undefined)
            return item(s);
        if (done.has(s.group))
            return '';
        done.add(s.group);
        const g = groups.get(s.group);
        return '<div class="mb-tree-group" data-mb-group="' + g.id + '"><button type="button" class="mb-tree-branch" data-mb-branch aria-expanded="true" aria-controls="mb-group-' + g.id + '" data-lavish-action><span class="mb-tree-arrow" aria-hidden="true">▸</span>' +
            dot(g.dot) + '<span class="mb-tree-name">' + escape(g.title) + '</span>' + count(g.count) + '</button><div class="mb-tree-children" id="mb-group-' + g.id + '" role="group" aria-label="' + escape(g.title) + '">' +
            input.sections.filter(x => x.group === g.id).map(item).join('') + '</div></div>';
    }).join('') + '</nav>';
}
// Theme «vibe» (Mattia, 25 novembre 2026: «approvato b2 arricchito»; laboratorio-stile/lavish/consolidamento/
// vibe-B2-arricchito.html): the scaffold of the round interview. Rounds are the sections, shown as tabs, one at a time;
// the intent is a column on the right, always visible, whose rows change while the reader answers; who speaks is a
// two-column table, the question is a row of that table; the reason of the recommended answer shows on hover, long
// press or keyboard focus, never in the card; there is no note field (a note is a Lavish annotation).
// Every text goes through the escape above: no HTML from the JSON reaches the page.
const VIBE = 'vibe';
// Who speaks (S13 of 22 novembre 2026): one word each, a colour each (Ipotesi orange: yellow stays for the cards that
// wait for an answer).
const SPEAKERS = ['Tuo', 'Proposta', 'Verificato', 'Ipotesi', 'Dubbio'];
// Genre of a card: its colour and the fixed upper half of its «?» (texts of the approved mockup). A card help replaces
// the fixed text; the lower half, «Cosa notare qui», is the summary written for the card.
const GENRES = {
    ripasso: { name: 'Ripasso', help: 'Dice che cosa ho capito finora, e da dove viene ogni frase. Se una riga è sbagliata, correggila con l\'annotazione prima di rispondere alle domande.' },
    domanda: { name: 'Domanda', help: 'Aspetta una tua scelta. La consigliata è la prima, evidenziata: un tocco sceglie, il secondo mette in coda. Per leggere perché la consiglio passa il mouse sulla risposta evidenziata; sul telefono tienila premuta. Se non rispondi, vale la consigliata. Una nota si scrive con l\'annotazione di Lavish.' },
    ipotesi: { name: 'Ipotesi', help: 'Non è una domanda: è una cosa che do per buona senza la tua conferma. Resta arancione finché non la confermi o la correggi.' },
    schizzo: { name: 'Schizzo', help: 'Mostra con un disegno una cosa che ha una forma. Non chiede niente.' },
    chiuso: { name: 'Giro chiuso', help: 'È una carta di un giro già chiuso. La rileggi; per cambiarla usa l\'annotazione.' },
};
const INTENT_HELP = 'È il riassunto che si scrive mentre rispondi, sempre visibile. Verde: confermato. Giallo: in discussione nel giro aperto. Arancione: ipotesi.';
// Card and page fields that exist only in this theme; elsewhere they stop the render.
const VIBE_CARD_FIELDS = ['speakers', 'genre', 'outcome'];
const onlyHere = where => where + ' exists only in the theme "vibe"; add "theme": "vibe" to the page or drop it';
function rejectOutsideVibe(input) {
    if (input.intent !== undefined)
        throw new Error(onlyHere('intent'));
    for (const section of input.sections || []) {
        if (section && section.open !== undefined)
            throw new Error(onlyHere('Section ' + section.id + ': open'));
        for (const card of section?.cards || [])
            for (const key of VIBE_CARD_FIELDS)
                if (card && card[key] !== undefined)
                    throw new Error(onlyHere('Card ' + card.id + ': ' + key));
    }
}
// The tab of a round names it with the part of its title before « · » (Giro 1 · il traguardo → Giro 1).
const roundName = title => String(title ?? '').split(' · ')[0].trim();
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
// Checks the page and returns what the renderer needs: the open round, card genres and statuses.
function prepareVibe(input) {
    if (input.tabs !== undefined)
        throw new Error('The theme "vibe" always shows the rounds as tabs: drop tabs');
    if (!input.intent || typeof input.intent !== 'object' || Array.isArray(input.intent))
        throw new Error('The theme "vibe" needs an intent: { "rows": [{ "key": "Decisioni", "state": "open", "card": "<id of a card with a question>" }], "question": { ... } }');
    const sections = input.sections || [];
    const opened = sections.filter(s => s && s.open !== undefined);
    if (opened.some(s => s.open !== true))
        throw new Error('Section open must be true or absent');
    if (opened.length > 1)
        throw new Error('In the theme "vibe" only one section may be open (the round in progress): ' + opened.map(s => s.id).join(', '));
    const open = opened[0] || sections[0] || null;
    const cards = new Map();
    for (const section of sections)
        for (const card of section.cards || [])
            if (card && typeof card.id === 'string')
                cards.set(card.id, { card, section });
    return { open, cards };
}
const genreOf = card => {
    const genre = card.genre ?? (card.question ? 'domanda' : 'ripasso');
    if (!Object.hasOwn(GENRES, genre))
        throw new Error('Card ' + card.id + ': genre must be one of ' + Object.keys(GENRES).join(', ') + ' (got ' + JSON.stringify(card.genre) + ')');
    return genre;
};
// A card of the theme: the checks of the fields the theme changes, before the shared rendering.
function checkVibeCard(card) {
    if (card.tone !== undefined)
        throw new Error('Card ' + card.id + ': in the theme "vibe" the genre gives the colour: drop tone and use genre');
    if (card.outcome !== undefined && (typeof card.outcome !== 'string' || !card.outcome.trim()))
        throw new Error('Card ' + card.id + ': outcome is a short text for the list of a closed round, like "risposta nella nota"');
    const q = card.question;
    if (q) {
        if (q.text !== undefined)
            throw new Error('Card ' + card.id + ': the theme "vibe" has no note field: drop question.text (a note is a Lavish annotation)');
        checkOptions(q, 'Card ' + card.id);
        if (q.differ !== undefined && (typeof q.differ !== 'string' || !q.differ.trim()))
            throw new Error('Card ' + card.id + ': question.differ says in a few words what the options differ in, like "quanto è largo l\'oggetto."');
    }
}
function checkOptions(q, where) {
    const shape = where + ': question.options is a list of { "value": "a", "label": "Risposta", "intent": "Text for the intent row" }; the first option is the recommended one, with "recommended": true, and no other';
    if (!Array.isArray(q.options) || !q.options.length || q.options.some(o => !o || typeof o !== 'object' || typeof o.label !== 'string' || !o.label.trim() || (typeof o.value !== 'string' && typeof o.value !== 'number')
        || (o.intent !== undefined && (typeof o.intent !== 'string' || !o.intent.trim()))))
        throw new Error(shape);
    if (q.options[0].recommended !== true || q.options.slice(1).some(o => o.recommended !== undefined && o.recommended !== false))
        throw new Error(shape);
    if (q.label !== undefined && typeof q.label !== 'string')
        throw new Error(where + ': question.label is the question, a text');
}
// Who speaks, as a two-column table: an entry without who continues the cell above with a new paragraph.
function speakerRows(card) {
    if (card.speakers === undefined)
        return [];
    const shape = 'Card ' + card.id + ': speakers must be a list of { "who": "Tuo", "text": "Una frase." }, who one of ' + SPEAKERS.join(', ') + '; an entry without who continues the cell above';
    if (!Array.isArray(card.speakers) || card.speakers.some(s => !s || typeof s !== 'object' || Array.isArray(s)))
        throw new Error(shape);
    const rows = [];
    card.speakers.forEach((s, i) => {
        if (s.who === undefined && i === 0)
            throw new Error('Card ' + card.id + ': the first entry of speakers needs who (' + SPEAKERS.join(', ') + ')');
        if (s.who !== undefined && !SPEAKERS.includes(s.who))
            throw new Error('Card ' + card.id + ': who must be one of ' + SPEAKERS.join(', ') + ' (got ' + JSON.stringify(s.who) + ')');
        const paragraph = filledParagraphs([s.text], shape);
        if (s.who === undefined)
            rows.at(-1).content += paragraph;
        else
            rows.push({ who: s.who, content: paragraph });
    });
    return rows;
}
const speakersTable = rows => '<table class="mb-fields mb-vibe-speakers"><tbody>' + rows.map(r => '<tr' + (r.question ? ' class="mb-vibe-question"' : '') + ' data-mb-who="' + r.who.toLowerCase() + '"><th scope="row">' + r.who + '</th><td>' + r.content + '</td></tr>').join('') + '</tbody></table>';
// The answers under the table: tiles, the recommended first and highlighted, with no label. The markup of the options
// is the one of every Bruvish question (radio, two taps and queue in artifact.js, marks, drafts), so the queue works as
// on every page; the reason is a hidden tooltip that artifact-vibe.js shows on hover, keyboard focus or long press.
function answers(id, q, answer, labelId, tipId, columns = q.options.some(o => o.label.length > 34) ? 1 : Math.min(q.options.length, 3)) {
    const tip = tipId ? '<div class="mb-vibe-tip" id="' + tipId + '" role="tooltip" hidden><b>Perché la consiglio</b>' + filledParagraphs(q.reason, 'Card ' + id + ': question.reason is the reason of the recommended answer, one or two sentences') + paragraphs(['Se non rispondi, vale questa.']) + '</div>' : '';
    return '<form data-mb-question="' + id + '" class="mb-vibe-answers"><fieldset aria-labelledby="' + labelId + '"><div class="mb-vibe-options mb-vibe-cols-' + columns + '">' +
        q.options.map((o, i) => '<label class="option' + (i === 0 ? ' mb-recommended' : '') + '"><input data-mb-field="' + id + ':choice" name="choice" type="radio" value="' + escape(o.value) + '"' + (answer?.choice === o.value ? ' checked' : '') + (i === 0 && tipId ? ' aria-describedby="' + tipId + '"' : '') + '><span>' + inline(o.label) + '</span>' + QUEUED_MARK + '</label>').join('') +
        tip + '</div><span class="queue-status" role="status"></span></fieldset></form>';
}
// The body of a card in the theme, after the title row: speakers table, the card paragraphs (where a figure placeholder
// of artefatto-ai stays a plain sentence: the drawing replaces it after the render), then the question as a row of the
// same table (of a second table when paragraphs came between), the answers and the remaining shared blocks.
function vibeCardBody(card, answer, unique) {
    const rows = speakerRows(card);
    const body = paragraphs(card.paragraphs);
    let question = '';
    if (card.question) {
        const q = card.question, labelId = unique('mb-q-' + card.id), tipId = q.reason !== undefined ? unique('mb-tip-' + card.id) : null;
        const row = { who: 'Domanda', question: true, content: '<p class="mb-vibe-q" id="' + labelId + '">' + inline(q.label || 'La tua risposta') + '</p>' + (q.differ ? '<p class="mb-vibe-differ">Le opzioni differiscono per: ' + inline(q.differ) + '</p>' : '') };
        if (body || !rows.length)
            question = speakersTable([row]);
        else
            rows.push(row);
        question += answers(card.id, q, answer, labelId, tipId);
    }
    return (rows.length ? speakersTable(rows) : '') + body + question;
}
// The list at the top of a closed round: each card with its answer (the chosen option, or the outcome written for it).
function closedList(section, state) {
    return '<div class="mb-vibe-closed-list">' + (section.cards || []).map(card => {
        const choice = state.answers?.[card.id]?.choice, option = card.question?.options?.find(o => o.value === choice);
        const answer = option ? inline(option.label) : card.outcome ? inline(card.outcome) : '';
        return '<div class="mb-vibe-closed-item"><span>' + inline(card.title) + '</span><span class="mb-vibe-closed-answer">' + answer + '</span></div>';
    }).join('') + '</div>';
}
// The bar of the rounds: on a phone the intent is the first tab; the open round is the current one; its counter says
// how many questions still wait (artifact-vibe.js keeps it in step with the queue).
function roundTabs(input, open, state) {
    const waiting = open ? waitingIn(open, state) : 0;
    return '<nav class="mb-vibe-tabs" aria-label="Giri"><a href="#intent" class="mb-vibe-tab mb-vibe-phone" data-mb-round="intent" data-lavish-action>Intent <small>in costruzione</small></a>' +
        (input.sections || []).map(s => '<a href="#' + s.id + '" class="mb-vibe-tab" data-mb-round="' + s.id + '" data-lavish-action' + (s === open ? ' aria-current="page"' : '') + '>' + escape(roundName(s.title)) + ' ' +
            (s === open ? '<small data-mb-round-count>' + (waiting ? plural(waiting, 'aperta', 'aperte') : 'nessuna aperta') + '</small>' : '<small>chiuso</small>') + '</a>').join('') + '</nav>';
}
const vibeStatus = (card, state) => state.answers?.[card.id] ? 'answered' : (card.status || (card.question ? 'waiting' : 'info'));
const waitingIn = (section, state) => (section.cards || []).filter(c => c?.question && vibeStatus(c, state) === 'waiting').length;
// Header additions: the live status line and the legend of the colours.
function headerStatus(open, state) {
    const waiting = open ? waitingIn(open, state) : 0;
    return '<p class="mb-vibe-status">' + (open ? '<span>' + escape(roundName(open.title)) + ' aperto · </span>' : '') + '<span data-mb-vibe-status>' + plural(waiting, 'domanda', 'domande') + ' in attesa · 0 risposte in coda</span></p>' +
        '<p class="mb-vibe-colours" aria-label="Che cosa dicono i colori"><span data-mb-colour="giallo">aspetta te</span><span data-mb-colour="verde">risposta o confermato</span><span data-mb-colour="blu">fatti e ripasso</span><span data-mb-colour="viola">proposta o schizzo</span><span data-mb-colour="arancione">ipotesi, non verificato</span></p>';
}
// The intent column: rows in three states, the legend, the output, «Dice ciò che vuoi?», the grey zones. Only a row that
// leads to an unanswered card of the open round is a link (a plain link, not a Lavish action, so the reader can still
// annotate it to correct the intent); a confirmed row is text with the round that confirmed it (S10, 23 novembre 2026).
function intentColumn(input, prep, state, unique) {
    const it = input.intent;
    for (const key of ['title', 'output'])
        if (it[key] !== undefined && (typeof it[key] !== 'string' || !it[key].trim()))
            throw new Error('intent.' + key + ' must be a non-empty text');
    if (it.voice !== undefined && (typeof it.voice !== 'string' || !it.voice.trim()))
        throw new Error('intent.voice must be a non-empty text to read aloud');
    if (!Array.isArray(it.rows))
        throw new Error('intent.rows must be a list of { "key": "Decisioni", "state": "confirmed" | "open" | "hypothesis", ... }');
    if (it.grey !== undefined && (!Array.isArray(it.grey) || it.grey.some(g => typeof g !== 'string' || !g.trim())))
        throw new Error('intent.grey must be a list of texts, one per grey zone');
    const linked = card => {
        if (card === undefined)
            return null;
        if (!prep.cards.has(card))
            throw new Error('intent.rows: card must be the id of a card of this page (got ' + JSON.stringify(card) + ')');
        return prep.cards.get(card);
    };
    const goTo = found => found && found.section === prep.open && vibeStatus(found.card, state) !== 'answered' ? found.card.id : null;
    const rowHtml = (r, attrs, href, value) => (href ? '<a class="mb-vibe-row" href="#' + href + '"' : '<div class="mb-vibe-row"') + attrs + '><span class="mb-vibe-key"><span class="mb-vibe-dot"></span>' + inline(r.key) + '</span><span class="mb-vibe-value">' + value + '</span>' + (href ? '</a>' : '</div>');
    const built = it.rows.map(r => {
        if (!r || typeof r !== 'object' || typeof r.key !== 'string' || !r.key.trim())
            throw new Error('intent.rows: every row needs a key, like { "key": "Decisioni", "state": "open", "card": "g1-decisioni" }');
        if (!['confirmed', 'open', 'hypothesis'].includes(r.state))
            throw new Error('intent.rows: state must be confirmed, open or hypothesis (row ' + JSON.stringify(r.key) + ')');
        const text = t => '<span class="mb-vibe-text">' + inline(t) + '</span>';
        const where = t => '<small class="mb-vibe-where">' + t + '</small>';
        if (r.state === 'open') {
            const found = linked(r.card);
            if (!found || !found.card.question)
                throw new Error('intent.rows: an open row needs the id of a card with a question, like { "key": "Decisioni", "state": "open", "card": "g1-decisioni" } (row ' + JSON.stringify(r.key) + ')');
            const { card, section } = found, options = card.question.options, round = escape(roundName(section.title));
            const say = o => o.intent ?? o.label;
            const answer = state.answers?.[card.id], chosen = answer && options.find(o => o.value === answer.choice);
            if (chosen)
                return [rowHtml(r, ' data-mb-row-state="confirmed"', null, text(say(chosen)) + where('confermato · ' + round)), say(chosen)];
            const go = goTo(found);
            return [rowHtml(r, ' data-mb-row-state="open" data-mb-row-card="' + card.id + '" data-mb-row-round="' + round + '"', go,
                options.map((o, i) => '<span class="mb-vibe-text" data-mb-option="' + escape(o.value) + '"' + (i ? ' hidden' : '') + '>' + inline(say(o)) + '</span>').join('') +
                '<small class="mb-vibe-where" data-mb-where="open">in discussione · se non rispondi vale questa' + (go ? ' · vai alla carta ›' : '') + '</small><small class="mb-vibe-where" data-mb-where="queued" hidden>risposta in coda · ' + round + '</small><small class="mb-vibe-where" data-mb-where="sent" hidden>risposta inviata · ' + round + '</small>'), say(options[0])];
        }
        const found = linked(r.card);
        if (r.state === 'confirmed') {
            if (typeof r.text !== 'string' || !r.text.trim() || typeof r.round !== 'string' || !r.round.trim())
                throw new Error('intent.rows: a confirmed row needs text and round, like { "key": "Perché", "state": "confirmed", "round": "giro 0", "text": "..." }');
            return [rowHtml(r, ' data-mb-row-state="confirmed"', null, text(r.text) + where('confermato · ' + inline(r.round))), r.text];
        }
        if (typeof r.text !== 'string' || !r.text.trim() || (r.note !== undefined && (typeof r.note !== 'string' || !r.note.trim())))
            throw new Error('intent.rows: a hypothesis row needs text (and may have a note), like { "key": "Perimetro", "state": "hypothesis", "text": "...", "note": "si sceglie al passo 1" }');
        const go = goTo(found);
        return [rowHtml(r, ' data-mb-row-state="hypothesis"', go, text(r.text) + where(['ipotesi', r.note ? inline(r.note) : '', go ? 'vai alla carta ›' : ''].filter(Boolean).join(' · '))), r.text];
    });
    const rows = built.map(([html]) => html).join('');
    const helpId = unique('mb-help-intent');
    const head = cardHead({ id: 'intent', title: it.title || 'Intent in costruzione', help: it.help ?? INTENT_HELP, summary: it.summary }, helpId, { meaning: 'Intent · a cosa serve', tag: 'h2' });
    const spoken = it.voice ? it.voice.trim() : [it.title || 'Intent in costruzione', ...it.rows.map((r, i) => r.key + ': ' + built[i][1])].join('. ');
    let close = '';
    if (it.question !== undefined) {
        const q = it.question;
        if (!q || typeof q !== 'object' || Array.isArray(q))
            throw new Error('intent.question must be { "label": "Dice ciò che vuoi?", "options": [{ "value": "si", "label": "Sì", "recommended": true }] }');
        if (q.text !== undefined)
            throw new Error('intent.question: the theme "vibe" has no note field: drop text (a note is a Lavish annotation)');
        checkOptions(q, 'intent');
        const labelId = unique('mb-q-intent'), tipId = q.reason !== undefined ? unique('mb-tip-intent') : null;
        close = '<div class="mb-vibe-close"><p class="mb-vibe-q" id="' + labelId + '">' + inline(q.label || 'Dice ciò che vuoi?') + '</p>' + answers('intent', q, state.answers?.intent, labelId, tipId, 1) + '</div>';
    }
    return '<aside class="mb-vibe-intent" id="intent" aria-label="Intent"><div class="mb-vibe-intent-box"><button class="voice" type="button" data-mb-voice data-mb-voice-text="' + escape(spoken) + '"' + (it.voice ? '' : ' data-mb-voice-rows') + ' aria-label="Leggi l&#39;intent">🔊</button>' + head +
        '<div class="mb-vibe-rows">' + rows + '</div>' +
        '<p class="mb-vibe-legend"><span class="mb-vibe-dot" data-mb-dot="confirmed"></span>confermato · <span class="mb-vibe-dot" data-mb-dot="open"></span>in discussione · <span class="mb-vibe-dot" data-mb-dot="hypothesis"></span>ipotesi</p>' +
        (it.output ? '<p class="mb-vibe-output">' + inline(it.output) + '</p>' : '') + close +
        (it.grey?.length ? '<div class="mb-vibe-grey"><b>Zone grigie</b>' + it.grey.map(g => filledParagraphs([g], 'intent.grey')).join('') + '</div>' : '') + '</div></aside>';
}
// Optional fields of a card and of a page that need the building-block assets. A page without any of them keeps the
// base assets only, so its bytes do not change.
const CARD_BLOCKS = ['tone', 'labels', 'help', 'summary', 'voice', 'table', 'notes', 'diff', 'events', 'transcript', 'action', 'variant', 'images'];
const PAGE_BLOCKS = ['tabs', 'header', 'pills', 'actions', 'diagnostics', 'groups'];
const usesBlocks = (input, family) => NAMED_THEMES.includes(family) || PAGE_BLOCKS.some(k => input[k] !== undefined) || (input.sections || []).some(section => section.count !== undefined || section.group !== undefined || section.dot !== undefined || (section.cards || []).some(card => card && (CARD_BLOCKS.some(k => card[k] !== undefined) || card.question?.text !== undefined)));
// Theme family (laboratorio-stile/lavish/DESIGN.md): drawn once per artifact and kept in every revision.
export const FAMILIES = ['B', 'F', 'E2', 'G2', 'D3'];
// Themes asked by name only, never drawn: «revisione» is the look of the approved review page (S53, 22 novembre 2026);
// «vibe» the scaffold of the round interview («B2 arricchito», 25 novembre 2026; see «Theme vibe» above).
export const NAMED_THEMES = ['revisione', VIBE];
export function familyFor(seed) { return FAMILIES[createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % FAMILIES.length]; }
// Canonical JSON: key order in input.json never changes a fingerprint.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value ?? null);
// What the reader sees as written by the agent. The reader's own answers and unanswered comments are excluded.
export function cardFingerprint(card, comments = []) {
    const content = { title: card.title, status: card.status || 'info', paragraphs: card.paragraphs || [], fields: card.fields, metadata: card.metadata, clarification: card.clarification, question: card.question, ...Object.fromEntries([...CARD_BLOCKS, ...VIBE_CARD_FIELDS].map(k => [k, card[k]])), comments: comments.filter(c => c.response).map(c => ({ id: c.id, text: c.text, response: c.response })) };
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
    input = withDiagnostics(input);
    const state = input.state || { revision: 0, answers: {}, comments: [] };
    const previous = typeof options.previous === 'string' ? renderRecord(options.previous) : (options.previous || null);
    if (input.theme !== undefined && !FAMILIES.includes(input.theme) && !NAMED_THEMES.includes(input.theme))
        throw new Error('Unknown theme family: ' + input.theme + ' (expected ' + FAMILIES.concat(NAMED_THEMES).join(', ') + ')');
    const family = input.theme || (FAMILIES.includes(previous?.theme) || NAMED_THEMES.includes(previous?.theme) ? previous.theme : familyFor(input.id ?? options.id ?? input.title));
    // The theme «revisione» has no usage guide, as on the approved review page (S3); every other theme requires it.
    const guided = family !== 'revisione';
    if (guided && !input.guide)
        throw new Error('title and a collapsible usage guide are required');
    // The theme «vibe»: rounds as tabs and the intent column; its fields stop the render on any other page.
    const vibe = family === VIBE;
    if (!vibe)
        rejectOutsideVibe(input);
    const prep = vibe ? prepareVibe(input) : null;
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
    const ids = new Set(['usage-guide', 'mb-state', 'mb-render', ...(vibe ? ['intent'] : [])]);
    const unique = id => { if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id || '') || ids.has(id))
        throw new Error('Every section/card needs a unique stable id: ' + id); ids.add(id); return id; };
    for (const section of input.sections || []) {
        unique(section.id);
        for (const card of section.cards)
            unique(card.id);
    }
    checkTree(input, unique);
    // In the theme «revisione» with tabs, the tab names the section: no heading repeats it.
    const review = family === 'revisione', tabTitled = review && (input.tabs === true || input.tabs === 'tree');
    const sections = (input.sections || []).map(section => {
        const closed = vibe && section !== prep.open;
        const opening = vibe ? '<section id="' + section.id + '" class="mb-vibe-round"' + (closed ? ' data-mb-closed' : '') + '><h2>' + escape(section.title) + '</h2>' + (closed ? closedList(section, state) : '')
            : '<section id="' + section.id + '"' + (tabTitled ? ' aria-label="' + escape(section.title) + '">' : '><h2>' + escape(section.title) + '</h2>');
        return opening + section.cards.map(card => {
            if (vibe)
                return vibeCard(card, section);
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
            return '<article class="card" id="' + card.id + '" data-mb-state="' + status + '"' + (card.tone !== undefined ? ' data-mb-tone="' + toneOf(card.tone, 'Card ' + card.id) + '"' : '') + (fresh ? ' data-mb-new="' + fresh + '"' : '') + (filesPage ? ' data-mb-files' : '') + cardVariant(card) + '><button class="voice" type="button" data-mb-voice' + voiceText(card) + ' aria-label="Leggi questa scheda">🔊</button>' + cardHead(card, helpId) + paragraphs(card.paragraphs) + cardFields(card) + cardTable(card) + cardImages(card) + cardEvents(card) + cardTranscript(card) + cardDiff(card, filesPage) + context + question + cardAction(card) + cardNotes(card) + follow + '</article>';
        }).join('') + '</section>';
    }).join('');
    // A card of the theme «vibe»: colour and fixed help from its genre, who speaks in a table with the question as a row,
    // the answers under it; the comments and the shared text blocks keep their rendering.
    function vibeCard(card) {
        for (const key of ['diff', 'action', 'variant'])
            if (card[key] !== undefined)
                throw new Error('Card ' + card.id + ': ' + key + ' is not part of the theme "vibe"');
        checkVibeCard(card);
        const genre = genreOf(card), answer = state.answers?.[card.id];
        const status = vibeStatus(card, state);
        if (!['waiting', 'answered', 'info', 'blocked'].includes(status))
            throw new Error('Unknown card status');
        let helpId = 'mb-help-' + card.id;
        while (ids.has(helpId))
            helpId += '-';
        unique(helpId);
        const context = (card.metadata || card.clarification) ? '<details class="context" data-mb-field="' + card.id + ':context"><summary>Contesto e chiarimenti</summary>' + (card.metadata ? '<div class="meta">' + inline(card.metadata) + '</div>' : '') + paragraphs(card.clarification ? [card.clarification] : []) + '</details>' : '';
        const comments = (state.comments || []).filter(c => c.card === card.id);
        const follow = comments.length ? '<details class="followup"><summary>Commenti e seguito (' + comments.length + ')</summary>' + comments.map(c => fieldsTable([['Commento', '<p><span class="sentence">' + escape(c.text) + '</span></p>'], ...(c.response ? [['Risposta', paragraphs(c.response)]] : [])], 'mb-fields mb-comment')).join('') + '</details>' : '';
        const fresh = novelty(card.id);
        return '<article class="card" id="' + card.id + '" data-mb-state="' + status + '" data-mb-genre="' + genre + '"' + (fresh ? ' data-mb-new="' + fresh + '"' : '') + '><button class="voice" type="button" data-mb-voice' + voiceText(card) + ' aria-label="Leggi questa scheda">🔊</button>' +
            cardHead({ ...card, help: card.help ?? GENRES[genre].help }, helpId, { meaning: GENRES[genre].name + ' · a cosa serve' }) + vibeCardBody(card, answer, unique) + cardFields(card) + cardTable(card) + cardEvents(card) + cardTranscript(card) + context + cardNotes(card) + follow + '</article>';
    }
    const asks = (input.sections || []).some(section => (section.cards || []).some(card => card?.question));
    const blocks = usesBlocks(input, family), head = headerParts(input.header), actions = headerActions(input.actions);
    // A page with diagnostics is operated by an executor: after sending, the page says where the outcome will appear
    // instead of claiming the agent received it.
    const executor = input.diagnostics !== undefined ? ' data-mb-executor' : '';
    // The tree bar lays the page out in two columns (bar, then the page); main says so to the stylesheet.
    const nav = input.tabs === 'tree' ? ' data-mb-nav="tree"' : '';
    // In the theme «revisione» a title ending in « #<number> » (the PR) shows the number muted, as on the review page.
    const number = review ? / #\d+$/.exec(input.title) : null;
    const title = number ? escape(input.title.slice(0, number.index)) + ' <span class="mb-number">' + escape(number[0].slice(1)) + '</span>' : escape(input.title);
    // Header D (header.facts): the title is the first thing, without the PR number, which the facts table carries; the
    // operations and the state sit top right, in a fixed place that a long title does not move; the facts follow.
    const intro = paragraphs(input.intro ? [input.intro] : []) + (vibe ? headerStatus(prep.open, state) : ''), pills = pillsOf(input.pills, (input.sections || []).map(section => section.id));
    const factsHeader = () => { const plain = / #\d+$/.exec(input.title), side = actions + head.badge;
        return '<header class="mb-header-facts"><div class="mb-header-top"><h1>' + escape(plain ? input.title.slice(0, plain.index) : input.title) + '</h1>' + (side ? '<div class="mb-header-side">' + side + '</div>' : '') + '</div>' + head.facts + intro + pills + '</header>'; };
    const classicHeader = () => (actions ? '<header class="mb-header-actions"><div class="mb-header-main">' : '<header>') + head.before + '<h1>' + title + '</h1>' + head.after + intro + pills + (actions ? '</div>' + actions : '') + '</header>';
    const css = (await Promise.all(['fonts.css', 'artifact.css', ...(blocks ? ['artifact-blocks.css'] : []), ...(vibe ? ['artifact-vibe.css'] : [])].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const js = (await Promise.all(['artifact.js', ...(blocks ? ['artifact-blocks.js'] : []), ...(vibe ? ['artifact-vibe.js'] : [])].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const intent = vibe ? intentColumn(input, prep, state, unique) : '';
    const record = { version: 1, theme: family, revision, cards: fingerprints, base };
    return '<!doctype html>\n<html lang="it" data-mb-theme="dark" data-mb-family="' + family + '" data-mb-state-version="' + Number(state.revision || 0) + '" data-lavish-annotate="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(input.title) + '</title><style>' + css + '</style><script>' + js + '</script></head><body><main' + (actions ? ' data-mb-view="' + escape(input.actions.view) + '"' : '') + executor + nav + (vibe ? ' data-mb-vibe' : '') + '>' + head.notice + (head.facts ? factsHeader() : classicHeader()) + (guided ? '<details class="guide" id="usage-guide"><summary>Come usare questa pagina</summary>' + filledParagraphs([input.guide], 'title and a collapsible usage guide are required') + (asks ? paragraphs([ANSWER_HELP]).replace('<p>', '<p class="mb-answer-help">') : '') + '</details>' : '') + (vibe ? roundTabs(input, prep.open, state) + '<div class="mb-vibe"' + (prep.open ? ' data-mb-vibe-open="' + prep.open.id + '"' : '') + '><div class="mb-vibe-rounds">' + sections + '</div>' + intent + '</div>' : sectionIndex(input) + sections) + '</main><script type="application/json" id="mb-state">' + JSON.stringify(state).replaceAll('<', '\\u003c') + '</script><script type="application/json" id="mb-render">' + JSON.stringify(record).replaceAll('<', '\\u003c') + '</script></body></html>\n';
}
