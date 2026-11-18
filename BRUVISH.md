# Bruvish

Bruvish è Lavish (`kunchenguid/lavish-axi`) con un delta personale. Il ramo `carry` è il codice ufficiale più il delta; va solo in avanti, con merge dei tag ufficiali (`git merge --no-ff lavish-axi-vX.Y.Z`), mai rebase né force-push. Il delta intero è sempre `git diff lavish-axi-vX.Y.Z..carry`.

Il nome Bruvish è solo quello visibile: il comando resta `lavish-axi`, `lavish-axi --version` stampa la versione ufficiale e `package.json` non cambia (versione, `files`, script).

## Dove sta il delta

- `bruvish/`: runtime (`lib/`), punto d'ingresso (`bin/lavish-axi.js`), daemon (`bin/lavish-server-daemon.mjs`), renderer degli artefatti (`bin/bruvish.mjs`), asset, esempi, licenze dei font, test.
- `app/`: app macOS (Electron 44.2.0 ufficiale), vedi `app/README.md`.
- `scripts/bruvish-build.js`: passo di build eseguito in coda a `scripts/build.js`.
- `bruvish/scripts/`: `update-upstream`, `install` e `rollback`, descritti sotto.

La configurazione personale resta fuori dal repository: `~/.config/lavish-mb/remote.json` (host Tailscale), `~/.config/lavish-mb/opening.json` (app o Chrome), LaunchAgent, profilo Seatbelt, identità di firma e la guida di stile degli artefatti. La guida (`bruvish/DESIGN.md`, letta da `lavish-axi design`) è esclusa da `bruvish/.gitignore` e si genera con `style-sync-ai` dal laboratorio di stile: istruzioni in `bruvish/DESIGN.placeholder.md`. Senza guida, `lavish-axi design` esce con un messaggio chiaro; `lavish-axi design --upstream` stampa quella ufficiale.

## Runtime

Il runtime Bruvish è attivo quando `LAVISH_BRUVISH=1`. Lo impostano il punto d'ingresso, il daemon e l'app (`bruvish/lib/env.mjs`), insieme ai valori del servizio: porta 4388, stato `~/.local/state/lavish-axi-compact`, ascolto solo su `127.0.0.1`, nessuna apertura del browser ufficiale. Senza quella variabile ogni punto d'aggancio è inerte: `bin/lavish-axi.js` e la suite di test ufficiale si comportano come l'originale.

Nel runtime: `/` è il catalogo per il telefono, `/mb-info` dichiara la build, ogni artefatto carica `/mb-artifact.js` subito dopo lo script dell'SDK (eccezione voluta all'invariante «un solo script iniettato»), il server serve `/chrome-client.js` e `/chrome.css` con l'addon dell'interfaccia in coda al file ufficiale (i file in `dist/` restano quelli ufficiali), e `open` aggiunge il link remoto verificato, un prefisso al `next_step` ufficiale e l'apertura della superficie configurata. Il CLI rifiuta un server di un'altra build sulla stessa porta e stato.

### Cornice

L'addon (`bruvish/assets/chrome-addon.css` e `chrome-addon.js`) dà alla barra in alto e al pannello della conversazione lo stile del mock-up approvato della cornice, senza toccare l'HTML ufficiale: rimappa le variabili di colore e di carattere della cornice ufficiale e modifica il DOM della pagina al caricamento.

- **Tema:** barra e pannello prendono la famiglia di temi dell'artefatto (`--card`, `--line`, `--ink`, `--muted`, `--title`, `--field`), che `bridge.js` manda nel messaggio `outline`, solo se la pagina definisce tutte e sei le voci come colori; finché non arriva, o per una pagina senza famiglia o con una famiglia incompleta, vale il tema B, mai un misto. Vetro più opaco della pagina (72%, con sfocatura), Atkinson Hyperlegible Next e STIX (da `/mb-catalog-fonts.css`), testo mai sotto 13 px, anche nei testi ufficiali di barra, pannello, menu e cassetti che l'addon porta a 13 px. Le misure restano quelle compatte: barra 30 px, pannello 245 px. Nell'app con la trasparenza attiva lo sfondo di barra e pannello lo impone ancora `app/appearance.cjs`.
- **Barra:** in alto a sinistra la freccia «←» verso l'indice degli artefatti (il catalogo, `/`; nell'app porta alla home dell'app, perché una scheda mostra sempre e solo la propria revisione: `app/workspace.cjs` rifiuta ogni altra navigazione della scheda), poi «BRUVISH» in maiuscolo, STIX spaziato nel colore d'accento. «Annotate» è un interruttore senza scritta con una matita (`role="switch"`, `aria-checked`, `aria-label="Annota"`): il codice ufficiale continua a gestire clic e `aria-pressed`, che l'addon riporta in `aria-checked`. La modalità annotazione si alterna anche con un doppio tocco del tasto Option destro (`AltRight`, due pressioni entro 400 ms senza altri tasti in mezzo), sia nella cornice sia dentro l'artefatto (`bridge.js` chiede il cambio con `annotate-toggle`), mai mentre il fuoco è in un campo di testo; la scorciatoia ufficiale resta. Restano anche Revisions, Warnings e More della barra ufficiale. L'elenco dei Lavish aperti del mock-up non fa parte della cornice servita, per scelta di Mattia: nell'app i Lavish aperti stanno già nella barra delle schede dell'app.
- **Carte chiuse:** una carta con `data-mb-state="answered"` e senza `data-mb-new` è chiusa ed è nascosta per impostazione, già prima del caricamento della pagina (`bridge.js`), così la posizione ripristinata a ogni ricaricamento cade sulla stessa impaginazione; l'interruttore con la spunta nel cerchio, accanto ad Annota, la mostra. Compare solo se la pagina ha carte chiuse e carte aperte: una pagina di sole carte chiuse non viene mai svuotata. Nella minimappa le carte chiuse nascoste sono pallini attenuati; un clic su un pallino mostra le chiuse e porta alla carta. Allo stesso modo, un `lavish:revealElement` o `lavish:annotateElement` ufficiale (modifica di una nota in coda, «Mostra» delle revisioni) che punta dentro una carta chiusa nascosta la mostra prima che l'SDK la raggiunga, e `bridge.js` lo dice alla cornice (`show-closed`), che accende l'interruttore.
- **Pannello:** titolo «Conversazione», pulsanti «Invia all'agente» e «Invia e chiudi», campo «Scrivi all'agente…». Niente fumetti: le risposte dell'agente sono testo in linea con il Markdown reso; i messaggi dell'utente («Tu») sono attenuati, con un filo a sinistra e una tinta verde molto chiara, tenue sul tema scuro perché il testo resti leggibile.
- **Italiano:** l'addon traduce anche i testi ufficiali di barra, pannello e carta di fine sessione, compresi quelli che il codice ufficiale scrive dopo (note in coda, «Invio…», avvisi di presenza e di passaggio fra schede, suggerimenti d'invio, «Annotazione non inviata», voci del menu Altro, cassetti Revisioni e Problemi di impaginazione, `aria-label` e `title`). Traduce solo frasi intere note, mai le parole del lettore o dell'agente (messaggi, bozze, ancore, percorsi). Restano in inglese, per scelta: la finestra di pubblicazione su ht-ml.app e i suoi messaggi, l'attesa e le schede di errore del caricamento dell'artefatto, la lavagna, i riassunti con i conteggi dei cassetti e le etichette dei problemi di impaginazione che manda il server, e «Image message» / «Image annotation», che il codice ufficiale scrive nel posto del testo del lettore (`.bubble-text`), dove l'addon non tocca nulla.
- **Intervista:** nelle pagine del renderer un primo tocco su una risposta la seleziona, un secondo tocco sulla stessa la mette in coda come il pulsante «Aggiungi risposte» (`artifact.js`); vale per le pagine generate da questa versione in poi. Nessun campo di testo libero: per note e commenti si usa lo strumento di annotazione. Un'opzione può portare `recommended: true` (`question.options[]`): la consigliata ha il colore d'accento, senza scritta, e non è mai preselezionata; senza il campo l'opzione resta com'era.

### Apertura dal server

Link per il telefono e apertura li fa il server, non il comando: la sandbox degli agenti raggiunge il server locale ma non può lanciare l'app o Chrome né raggiungere la tailnet. `lavish-axi open <pagina>` e la forma nuda `lavish-axi <pagina>` creano la sessione come l'originale (`POST /api/sessions`), poi chiedono al server `GET /mb/remote` e, senza `--no-open`, `POST /mb/open`; `lavish-axi remote <url della sessione>` chiede solo `GET /mb/remote`. Le due richieste (`bruvish/lib/control.mjs`) portano soltanto la chiave della sessione (`{"session": "<16 hex>"}`, più `no_gate` per `--no-gate`) e rifiutano ogni altro campo:

- il server ricava file e indirizzo dal proprio stato e accetta solo sessioni registrate (404 altrimenti); `/mb/open` non apre una sessione conclusa (409): la riapertura resta la scelta di `--reopen` sulla route ufficiale, mentre `/mb/remote` è in sola lettura e risponde anche per le concluse;
- la superficie la sceglie il server dalla propria configurazione (`opening.json`, letto a ogni richiesta, o `LAVISH_MB_SURFACE` nel suo ambiente); nessun percorso, comando, adattatore o variabile d'ambiente arriva dal chiamante, e `LAVISH_MB_OPEN_ADAPTER` non esiste più;
- oltre ai controlli ufficiali di Host e Origin, accettano solo un Host di loopback, nessuna intestazione di proxy (il telefono passa dal proxy Tailscale) e nessuna pagina web (niente Origin o Referer, e l'intestazione `x-bruvish-control: 1` del CLI, che un browser non manda senza una preflight CORS);
- un limite di frequenza per route (12 aperture e 30 verifiche al minuto) risponde 429 con `Retry-After`; conta solo le richieste con la chiave di una sessione registrata, così le chiamate senza chiave valida non esauriscono il budget.

Tutto questo vale dalla sandbox solo se il server gira fuori da essa: avviato dal servizio (LaunchAgent) o da un terminale normale. Se nessun server è in ascolto, un `lavish-axi open` lanciato in sandbox lo avvia come l'originale, e il server nasce dentro la sandbox con l'ambiente del chiamante: l'apertura fallisce con un errore chiaro, il link per il telefono risulta non disponibile e la superficie la fissa l'ambiente di quel chiamante (`LAVISH_MB_SURFACE`) finché il server non si ferma.

Se il server non risponde o non ha queste route (un server ufficiale o di un'altra build), il comando lo dice e si ferma: niente ripiego che apra o verifichi da sé. Un'apertura fallita lascia la sessione valida, riporta `opening.status: failed` con il motivo ed esce con 1.

## Build

`pnpm run build` produce la build ufficiale e poi, con `scripts/bruvish-build.js`, `dist/bruvish.mjs` (il comando da installare), gli asset in `dist/` e `dist/bruvish-manifest.json` (versione e tag ufficiali, commit del carry, impronte; l'identità della build è l'impronta delle uscite). Nel layout installato servono `dist/`, `bruvish/`, `app/`, `plugin.json` e `skills/lavish/` (letti da `lavish-axi setup plugin` accanto a `dist/`) e le dipendenze di produzione, senza `src/` e con un `bin/` che contiene solo il link `lavish-axi` verso `dist/bruvish.mjs` (niente `bin/lavish-axi-server.js` ufficiale): così il server parte da `dist/server.mjs`.

La guida di stile non viene dal repository: arriva nella cartella installata come `dist/bruvish-design.md` solo se `bruvish/DESIGN.md` esiste al momento della build; altrimenti si imposta `BRUVISH_DESIGN` con il percorso della guida locale.

## Aggiornamento, installazione, ritorno indietro

Tre comandi in `bruvish/scripts/`, senza rete tranne il fetch dei tag ufficiali e di `origin/carry` e le dipendenze dal lockfile. `--help` li descrive per intero.

`bruvish/scripts/update-upstream [tag]` porta una versione ufficiale nel delta. Con il lavoro pulito, fa `git fetch upstream --tags` e, se c'è il remote `origin`, `git fetch origin carry`: il ramo locale `carry` deve contenere `origin/carry`, altrimenti si ferma e chiede di aggiornarlo. Poi sceglie l'ultimo `lavish-axi-vX.Y.Z` (o quello indicato: `0.1.97`, `v0.1.97`, `lavish-axi-v0.1.97`), crea `update/vX.Y.Z` dal ramo locale `carry` e fa `git merge --no-ff` del tag con `rerere` attivo. Poi controlla i punti d'aggancio e lancia le prove: `pnpm install --frozen-lockfile` e `pnpm run check` (build, lint, formattazione, tipi, tutte le prove, comprese quelle di Bruvish). Non fa push, non apre la PR e non installa: il passo successivo è la PR di `update/vX.Y.Z` verso `carry`. Si ferma, con un codice d'uscita per caso:

- `2`, `needs-decision`: la versione cambia la configurazione degli agenti (`.claude/`, `.mcp.json`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, a qualunque profondità): mostra le differenze e non fa il merge. Dopo la revisione si rilancia con `--allow-agent-config <motivo>` (una riga, obbligatoria): il commit di merge porta il trailer `Bruvish-Agent-Config: <file toccati>; reason: <motivo>`, e la PR di `update/vX.Y.Z` deve citarlo, così la revisione arriva al proprietario.
- `2`, `needs-decision`: un marcatore `BRUVISH:hook` manca o è doppio, un conflitto supera 30 righe in un punto d'aggancio, oppure il conflitto è fuori dai file degli agganci o su un file cancellato o rinominato. L'innesto non si reinventa: il merge resta aperto per l'esame (`git merge --abort` per rinunciare).
- `3`: piccoli conflitti nei punti d'aggancio. Si risolvono rimettendo l'aggancio (codice ufficiale nuovo più la riga Bruvish), `git add`, poi `bruvish/scripts/update-upstream --continue`, che fa il commit del merge, ricontrolla gli agganci e rilancia le prove. `rerere` ricorda la soluzione per la volta successiva.
- `4`: prove fallite. Si corregge sul ramo, si fa il commit e si rilancia `--continue`.

`bruvish/scripts/install [--no-switch]` costruisce la copia (pulita, tutto in commit) con `pnpm run build`, che termina con `scripts/bruvish-build.js`, verifica `dist/bruvish-manifest.json` (stesso commit, nessuna modifica locale, impronte delle uscite) e prepara `~/tools/bruvish/<versione>-<sha7>/`, dove `<versione>` è quella ufficiale di `package.json`. Se quella cartella contiene già un'altra build dello stesso commit (per esempio dopo aver rigenerato `bruvish/DESIGN.md`), non la tocca e installa in `<versione>-<sha7>-<primi 6 caratteri dell'identità della build>`. Dentro: `dist/`, `bin/lavish-axi`, i file in commit di `bruvish/`, `app/` e `skills/lavish/`, `plugin.json`, licenze e lockfile, e le dipendenze di produzione (`pnpm install --prod --frozen-lockfile --offline --ignore-scripts`, dallo store di pnpm già riempito dalla copia di sviluppo). Prima di renderla visibile verifica la cartella: manifesto, dipendenze e `bin/lavish-axi --version` uguale alla versione ufficiale. Poi sposta il link `current` sulla nuova cartella e conserva il precedente come `previous`. Con `--no-switch` installa affiancato e lascia `current` com'è; rilanciato senza l'opzione, riconosce la cartella già installata e sposta solo i link. Non tocca `~/bin`, launchd, l'app installata né altro fuori da `~/tools/bruvish`; il riavvio del servizio o dell'app resta un passo a mano.

`bruvish/scripts/rollback` riporta `current` su `previous`, dopo aver verificato quella cartella, e mette in `previous` quella che sostituisce: un secondo `rollback` torna avanti. Non cancella nulla. Funziona anche dalla copia installata (`~/tools/bruvish/current/bruvish/scripts/rollback`).

La radice degli strumenti, `~/tools`, è definita una volta sola in `app/protocol.cjs` (`toolsRoot`): la usano `install`, `rollback`, l'app (`~/tools/bruvish/current`) e `app/build.py` (`~/tools/electron/44.2.0`). `BRUVISH_TOOLS_ROOT` la sostituisce. Le prove dei tre comandi (`bruvish/test/update-upstream.test.mjs`, `bruvish/test/install.test.mjs`) girano con una `HOME` finta, repository e tag finti e un `pnpm` finto, senza rete.

## Punti d'aggancio

Ogni punto toccato del codice ufficiale porta `BRUVISH:hook <id>`. L'elenco sta in `bruvish/lib/hooks.mjs`: `bruvish/test/hooks.test.mjs` controlla che ognuno ci sia una volta sola e che non ce ne siano altri, e `update-upstream` lo ricontrolla dopo ogni merge. Durante un merge, un conflitto in uno di questi punti si risolve rimettendo l'aggancio, non riscrivendo l'innesto.

| id                 | File                                   | Cosa fa                                                                                                        |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `server-import`    | `src/server.js`                        | importa `bruvish/lib/server.mjs`                                                                               |
| `server-routes`    | `src/server.js`                        | registra catalogo, `/mb-info`, `/mb-artifact.js`, addon, `/mb/open` e `/mb/remote` prima delle route ufficiali |
| `artifact-script`  | `src/server.js`                        | aggiunge `/mb-artifact.js` dopo lo script dell'SDK                                                             |
| `open-import`      | `src/cli.js`                           | importa `bruvish/lib/open.mjs`                                                                                 |
| `open-present`     | `src/cli.js`                           | chiede al server link remoto e apertura; prefisso del `next_step`                                              |
| `build`            | `scripts/build.js`                     | lancia `scripts/bruvish-build.js`                                                                              |
| `prettier`         | `.prettierignore`                      | esclude i file portati byte per byte dallo strato precedente                                                   |
| `workflow-ci`      | `.github/workflows/ci.yml`             | la CI ufficiale gira solo nel repository ufficiale                                                             |
| `workflow-release` | `.github/workflows/release-please.yml` | il fork non rilascia né pubblica su npm                                                                        |

I workflow girano dal ramo dell'evento: `main` del fork è lo specchio ufficiale senza questi agganci, quindi il vero interruttore su GitHub resta Actions disattivato nelle impostazioni del fork.

## Prove

```sh
pnpm run check
node --test bruvish/test/*.test.mjs app/test/*.test.mjs
```

`pnpm test` include anche le prove di Bruvish. Opzionali: `LAVISH_MB_TEST_CHROME` (Chrome for Testing) per le prove nel browser; `LAVISH_MB_TEST_DEDICATED=1` con `LAVISH_APP_BUNDLE` per la prova Electron; `BRUVISH_PARITY_CACHE=<voce della cache dello strato precedente>` per la parità con lo strato `lavish-mb`.
