# Bruvish

Bruvish è Lavish (`kunchenguid/lavish-axi`) con un delta personale. Il ramo `carry` è il codice ufficiale più il delta; va solo in avanti, con merge dei tag ufficiali (`git merge --no-ff lavish-axi-vX.Y.Z`), mai rebase né force-push. Il delta intero è sempre `git diff lavish-axi-vX.Y.Z..carry`.

Il nome Bruvish è solo quello visibile: il comando resta `lavish-axi`, `lavish-axi --version` stampa la versione ufficiale e `package.json` non cambia (versione, `files`, script).

## Dove sta il delta

- `bruvish/`: runtime (`lib/`), punto d'ingresso (`bin/lavish-axi.js`), daemon (`bin/lavish-server-daemon.mjs`), renderer degli artefatti (`bin/bruvish.mjs`), asset, esempi, licenze dei font, test.
- `app/`: app macOS (Electron 44.2.0 ufficiale), vedi `app/README.md`.
- `scripts/bruvish-build.js`: passo di build eseguito in coda a `scripts/build.js`.

La configurazione personale resta fuori dal repository: `~/.config/lavish-mb/remote.json` (host Tailscale), `~/.config/lavish-mb/opening.json` (app o Chrome), LaunchAgent, profilo Seatbelt, identità di firma e la guida di stile degli artefatti. La guida (`bruvish/DESIGN.md`, letta da `lavish-axi design`) è esclusa da `bruvish/.gitignore` e si genera con `style-sync-ai` dal laboratorio di stile: istruzioni in `bruvish/DESIGN.placeholder.md`. Senza guida, `lavish-axi design` esce con un messaggio chiaro; `lavish-axi design --upstream` stampa quella ufficiale.

## Runtime

Il runtime Bruvish è attivo quando `LAVISH_BRUVISH=1`. Lo impostano il punto d'ingresso, il daemon e l'app (`bruvish/lib/env.mjs`), insieme ai valori del servizio: porta 4388, stato `~/.local/state/lavish-axi-compact`, ascolto solo su `127.0.0.1`, nessuna apertura del browser ufficiale. Senza quella variabile ogni punto d'aggancio è inerte: `bin/lavish-axi.js` e la suite di test ufficiale si comportano come l'originale.

Nel runtime: `/` è il catalogo per il telefono, `/mb-info` dichiara la build, ogni artefatto carica `/mb-artifact.js` subito dopo lo script dell'SDK (eccezione voluta all'invariante «un solo script iniettato»), il server serve `/chrome-client.js` e `/chrome.css` con l'addon dell'interfaccia in coda al file ufficiale (i file in `dist/` restano quelli ufficiali), e `open` aggiunge il link remoto verificato, un prefisso al `next_step` ufficiale e l'apertura della superficie configurata. Il CLI rifiuta un server di un'altra build sulla stessa porta e stato.

## Build

`pnpm run build` produce la build ufficiale e poi, con `scripts/bruvish-build.js`, `dist/bruvish.mjs` (il comando da installare), gli asset in `dist/` e `dist/bruvish-manifest.json` (versione e tag ufficiali, commit del carry, impronte; l'identità della build è l'impronta delle uscite). Nel layout installato servono `dist/`, `bruvish/`, `app/` e le dipendenze di produzione, senza `bin/` né `src/`: così il server parte da `dist/server.mjs`.

Passo d'installazione per L5: la guida di stile non viene dal repository. L'installazione la genera o la copia nella cartella installata come `dist/bruvish-design.md` (la build lo fa da sé se `bruvish/DESIGN.md` esiste al momento della build), oppure imposta `BRUVISH_DESIGN` con il percorso della guida locale.

## Punti d'aggancio

Ogni punto toccato del codice ufficiale porta `BRUVISH:hook <id>`; `bruvish/test/hooks.test.mjs` controlla che ognuno ci sia una volta sola e che non ce ne siano altri. Durante un merge, un conflitto in uno di questi punti si risolve rimettendo l'aggancio, non riscrivendo l'innesto.

| id                 | File                                   | Cosa fa                                                                              |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `server-import`    | `src/server.js`                        | importa `bruvish/lib/server.mjs`                                                     |
| `server-routes`    | `src/server.js`                        | registra catalogo, `/mb-info`, `/mb-artifact.js` e addon prima delle route ufficiali |
| `artifact-script`  | `src/server.js`                        | aggiunge `/mb-artifact.js` dopo lo script dell'SDK                                   |
| `open-import`      | `src/cli.js`                           | importa `bruvish/lib/open.mjs`                                                       |
| `open-present`     | `src/cli.js`                           | link remoto, prefisso del `next_step`, apertura della superficie                     |
| `build`            | `scripts/build.js`                     | lancia `scripts/bruvish-build.js`                                                    |
| `prettier`         | `.prettierignore`                      | esclude i file portati byte per byte dallo strato precedente                         |
| `workflow-ci`      | `.github/workflows/ci.yml`             | la CI ufficiale gira solo nel repository ufficiale                                   |
| `workflow-release` | `.github/workflows/release-please.yml` | il fork non rilascia né pubblica su npm                                              |

I workflow girano dal ramo dell'evento: `main` del fork è lo specchio ufficiale senza questi agganci, quindi il vero interruttore su GitHub resta Actions disattivato nelle impostazioni del fork.

## Prove

```sh
pnpm run check
node --test bruvish/test/*.test.mjs app/test/*.test.mjs
```

`pnpm test` include anche le prove di Bruvish. Opzionali: `LAVISH_MB_TEST_CHROME` (Chrome for Testing) per le prove nel browser; `LAVISH_MB_TEST_DEDICATED=1` con `LAVISH_APP_BUNDLE` per la prova Electron; `BRUVISH_PARITY_CACHE=<voce della cache dello strato precedente>` per la parità con lo strato `lavish-mb`.
