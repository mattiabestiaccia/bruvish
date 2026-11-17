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
function paragraphs(value = []) { return value.map(p => '<p>' + (Array.isArray(p) ? p : [p]).map(sentence => '<span class="sentence">' + (sentence && typeof sentence === 'object' ? (sentence.highlight ? '<mark>' + escape(sentence.text) + '</mark>' : escape(sentence.text)) : escape(sentence)) + '</span>').join('') + '</p>').join(''); }
// Theme family (laboratorio-stile/lavish/DESIGN.md): drawn once per artifact and kept in every revision.
export const FAMILIES = ['B', 'F', 'E2', 'G2', 'D3'];
export function familyFor(seed) { return FAMILIES[createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % FAMILIES.length]; }
// Canonical JSON: key order in input.json never changes a fingerprint.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value ?? null);
// What the reader sees as written by the agent. The reader's own answers and unanswered comments are excluded.
export function cardFingerprint(card, comments = []) {
    const content = { title: card.title, status: card.status || 'info', paragraphs: card.paragraphs || [], metadata: card.metadata, clarification: card.clarification, question: card.question, comments: comments.filter(c => c.response).map(c => ({ id: c.id, text: c.text, response: c.response })) };
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
            const context = (card.metadata || card.clarification) ? '<details class="context" data-mb-field="' + card.id + ':context"><summary>Contesto e chiarimenti</summary>' + (card.metadata ? '<div class="meta">' + escape(card.metadata) + '</div>' : '') + paragraphs(card.clarification ? [card.clarification] : []) + '</details>' : '';
            let question = '';
            if (card.question) {
                const q = card.question;
                question = '<form data-mb-question="' + card.id + '"><fieldset><legend>' + escape(q.label || 'La tua risposta') + '</legend>' + q.options.map(o => '<label class="option"><input data-mb-field="' + card.id + ':choice' + '" name="choice" type="radio" value="' + escape(o.value) + '"' + (answer?.choice === o.value ? ' checked' : '') + '><span>' + escape(o.label) + '</span></label>').join('') + '<label>Nota<textarea data-mb-field="' + card.id + ':note" name="note">' + escape(answer?.note || '') + '</textarea></label><button type="submit">Aggiungi risposte</button><span class="queue-status" role="status"></span></fieldset></form>';
            }
            const comments = (state.comments || []).filter(c => c.card === card.id);
            const follow = comments.length ? '<details class="followup"><summary>Commenti e seguito (' + comments.length + ')</summary>' + comments.map(c => '<p><b>Commento:</b> ' + escape(c.text) + '</p>' + (c.response ? '<p><b>Risposta:</b> ' + escape(c.response) + '</p>' : '')).join('') + '</details>' : '';
            const fresh = novelty(card.id);
            return '<article class="card" id="' + card.id + '" data-mb-state="' + status + '"' + (fresh ? ' data-mb-new="' + fresh + '"' : '') + '><button class="voice" type="button" data-mb-voice aria-label="Leggi questa scheda">🔊</button><h3>' + escape(card.title) + '</h3>' + paragraphs(card.paragraphs) + context + question + follow + '</article>';
        }).join('') + '</section>';
    }).join('');
    const css = (await Promise.all(['fonts.css', 'artifact.css'].map(n => readFile(asset(n), 'utf8')))).join('\n');
    const js = await readFile(asset('artifact.js'), 'utf8');
    const record = { version: 1, theme: family, revision, cards: fingerprints, base };
    return '<!doctype html>\n<html lang="it" data-mb-theme="dark" data-mb-family="' + family + '" data-mb-state-version="' + Number(state.revision || 0) + '" data-lavish-annotate="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(input.title) + '</title><style>' + css + '</style><script>' + js + '</script></head><body><main><header><h1>' + escape(input.title) + '</h1>' + paragraphs(input.intro ? [input.intro] : []) + '</header><div class="mb-mode" role="group" aria-label="Fondo della pagina">Fondo <button type="button" data-mb-mode-button="dark" aria-pressed="false">Scuro</button><button type="button" data-mb-mode-button="transparent" aria-pressed="false">Trasparente</button></div><details class="guide" id="usage-guide"><summary>Come usare questa pagina</summary>' + paragraphs([input.guide]) + '</details><nav>' + input.sections.map(s => '<a href="#' + s.id + '">' + escape(s.title) + '</a>').join('') + '</nav>' + sections + '</main><script type="application/json" id="mb-state">' + JSON.stringify(state).replaceAll('<', '\\u003c') + '</script><script type="application/json" id="mb-render">' + JSON.stringify(record).replaceAll('<', '\\u003c') + '</script></body></html>\n';
}
