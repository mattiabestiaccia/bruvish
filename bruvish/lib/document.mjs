import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const asset = name => new URL('../assets/' + name, import.meta.url);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
// Inline marks in agent text: `code`, **bold**, *italic*. Every other character stays escaped: the marks
// become fixed tags and no HTML from the input ever reaches the page. An unmatched mark stays literal text.
// A code span is literal (no marks inside); bold may hold code and italic; italic may hold code.
const INLINE = /`([^`\n]+)`|\*\*(?=[^\s*])((?:`[^`\n]+`|[^`*]|\*(?!\*))+?)(?<=[^\s*])\*\*|\*(?=[^\s*])((?:`[^`\n]+`|[^`*])+?)(?<=[^\s*])\*/g;
export function inline(value) {
    const text = String(value ?? '');
    let html = '', last = 0;
    for (const match of text.matchAll(INLINE)) {
        html += escape(text.slice(last, match.index));
        if (match[1] !== undefined)
            html += '<code>' + escape(match[1]) + '</code>';
        else if (match[2] !== undefined)
            html += '<strong>' + inline(match[2]) + '</strong>';
        else
            html += '<em>' + inline(match[3]) + '</em>';
        last = match.index + match[0].length;
    }
    return html + escape(text.slice(last));
}
// One sentence per line: the renderer splits every agent string at a sentence end, so a string with several
// sentences still shows one per line. A sentence end is . ! ? or … (closing quotes, brackets or inline marks may follow),
// then a space or a newline, then a capital letter, a digit, a backtick or an asterisk (an opening quote or
// bracket may come first). It is never a split point inside an inline mark, after a known abbreviation
// (es., cfr., dott. ...), after a number abbreviation followed by a digit (pag. 3, art. 5, 20 nov. 2026),
// or after a single letter (initials, S.p.A.). A list number (digits only) stays with the sentence it opens:
// at the start of a string it is never a split point, and after a colon or a semicolon the split comes before it.
// Decimals, versions and paths have no space after the point and never split.
// A non-breaking space (U+00A0) after the point keeps two parts on one line.
const ABBREVIATIONS = new Set(['es', 'p.es', 'p.e', 'cfr', 'dott', 'dott.ssa', 'sig', 'sigg', 'sig.ra', 'prof', 'ing', 'avv', 'arch', 'geom', 'rag', 'sen', 'ibid', 'cit', 'op', 'ed', 'trad', 'rif', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'e.g', 'i.e']);
const NUMBER_ABBREVIATIONS = new Set(['pag', 'pagg', 'pp', 'art', 'artt', 'cap', 'par', 'fig', 'figg', 'tab', 'vol', 'voll', 'nr', 'num', 'nn', 'tel', 'ca', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic', 'jan', 'jun', 'jul', 'aug', 'sep', 'oct', 'dec']);
const SENTENCE_END = /([.!?…]+)([»"”’')\]*`]*)[ \t\r\n]+(?=[«"“‘(\[]?[\p{Lu}\p{N}`*])/gu;
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
                if (/[:;]$/.test(lead) && !inside(at - word.length)) {
                    parts.push(lead);
                    start = at - word.length;
                }
                if (!lead || /[:;]$/.test(lead))
                    continue;
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
// Theme family (laboratorio-stile/lavish/DESIGN.md): drawn once per artifact and kept in every revision.
export const FAMILIES = ['B', 'F', 'E2', 'G2', 'D3'];
export function familyFor(seed) { return FAMILIES[createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % FAMILIES.length]; }
// Canonical JSON: key order in input.json never changes a fingerprint.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value ?? null);
// What the reader sees as written by the agent. The reader's own answers and unanswered comments are excluded.
export function cardFingerprint(card, comments = []) {
    const content = { title: card.title, status: card.status || 'info', paragraphs: card.paragraphs || [], fields: card.fields, metadata: card.metadata, clarification: card.clarification, question: card.question, comments: comments.filter(c => c.response).map(c => ({ id: c.id, text: c.text, response: c.response })) };
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
const sameCards = (a, b) => { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
export async function renderDocument(input, options = {}) {
    if (!input.title || !input.guide)
        throw new Error('title and a collapsible usage guide are required');
    const state = input.state || { revision: 0, answers: {}, comments: [] };
    const previous = typeof options.previous === 'string' ? renderRecord(options.previous) : (options.previous || null);
    if (input.theme !== undefined && !FAMILIES.includes(input.theme))
        throw new Error('Unknown theme family: ' + input.theme + ' (expected ' + FAMILIES.join(', ') + ')');
    const family = input.theme || (FAMILIES.includes(previous?.theme) ? previous.theme : familyFor(input.id ?? options.id ?? input.title));
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
    const ids = new Set(['usage-guide', 'mb-state']);
    const unique = id => { if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id || '') || ids.has(id))
        throw new Error('Every section/card needs a unique stable id: ' + id); ids.add(id); return id; };
    const sections = (input.sections || []).map(section => {
        unique(section.id);
        return '<section id="' + section.id + '"><h2>' + escape(section.title) + '</h2>' + section.cards.map(card => {
            unique(card.id);
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
                question = '<form data-mb-question="' + card.id + '"><fieldset><legend>' + inline(q.label || 'La tua risposta') + '</legend>' + q.options.map(o => '<label class="option' + (o.recommended === true ? ' mb-recommended' : '') + '"><input data-mb-field="' + card.id + ':choice' + '" name="choice" type="radio" value="' + escape(o.value) + '"' + (answer?.choice === o.value ? ' checked' : '') + '><span>' + inline(o.label) + '</span></label>').join('') + reason + '<p class="mb-hint">Tocca una risposta per sceglierla, toccala di nuovo per accodarla. Con la tastiera, premi Spazio sull’opzione scelta per accodarla.</p><span class="queue-status" role="status"></span></fieldset></form>';
            }
            const comments = (state.comments || []).filter(c => c.card === card.id);
            const follow = comments.length ? '<details class="followup"><summary>Commenti e seguito (' + comments.length + ')</summary>' + comments.map(c => fieldsTable([['Commento', '<p><span class="sentence">' + escape(c.text) + '</span></p>'], ...(c.response ? [['Risposta', paragraphs(c.response)]] : [])], 'mb-fields mb-comment')).join('') + '</details>' : '';
            const fresh = novelty(card.id);
            return '<article class="card" id="' + card.id + '" data-mb-state="' + status + '"' + (fresh ? ' data-mb-new="' + fresh + '"' : '') + '><button class="voice" type="button" data-mb-voice aria-label="Leggi questa scheda">🔊</button><h3>' + inline(card.title) + '</h3>' + paragraphs(card.paragraphs) + cardFields(card) + context + question + follow + '</article>';
        }).join('') + '</section>';
    }).join('');
    const css = (await Promise.all(['fonts.css', 'artifact.css'].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const js = await readFile(asset('artifact.js'), 'utf8');
    const record = { version: 1, theme: family, revision, cards: fingerprints, base };
    return '<!doctype html>\n<html lang="it" data-mb-theme="dark" data-mb-family="' + family + '" data-mb-state-version="' + Number(state.revision || 0) + '" data-lavish-annotate="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(input.title) + '</title><style>' + css + '</style><script>' + js + '</script></head><body><main><header><h1>' + escape(input.title) + '</h1>' + paragraphs(input.intro ? [input.intro] : []) + '</header><details class="guide" id="usage-guide"><summary>Come usare questa pagina</summary>' + filledParagraphs([input.guide], 'title and a collapsible usage guide are required') + '</details><nav>' + input.sections.map(s => '<a href="#' + s.id + '">' + escape(s.title) + '</a>').join('') + '</nav>' + sections + '</main><script type="application/json" id="mb-state">' + JSON.stringify(state).replaceAll('<', '\\u003c') + '</script><script type="application/json" id="mb-render">' + JSON.stringify(record).replaceAll('<', '\\u003c') + '</script></body></html>\n';
}
