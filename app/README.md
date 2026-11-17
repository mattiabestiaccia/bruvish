# App Bruvish

App macOS personale per le review Lavish: una finestra con la home (catalogo degli artefatti registrati) e una scheda `WebContentsView` per ogni review. Non esiste un'app Lavish ufficiale: questa cartella è tutta del delta di Bruvish.

L'app usa la build installata di Bruvish (`~/tools/bruvish/current`, il link che sposta `bruvish/scripts/install`, oppure `LAVISH_APP_CORE_ROOT`) e lo stato delle review del servizio (`~/.local/state/lavish-axi-compact`). Non crea una seconda installazione: aprire una review lancia `dist/bruvish.mjs <file> --no-open`, che avvia il servizio quando è spento. Le review concluse dall'utente chiedono una conferma nativa prima di `--reopen`.

La stessa identità canonica del file riusa la scheda senza navigare: bozze e posizione restano. Chiudere una scheda non conclude la review. Il preload esiste solo nella home locale con CSP; negli artefatti niente preload privilegiato, niente Node nei renderer, sandbox e context isolation, IPC limitato al frame principale fidato. Permessi e nuove finestre sono negati.

Nome visibile **Bruvish** (bundle, menu, finestra). Restano invariati, per non perdere bozze e consenso del Portachiavi: bundle id `local.lavish.mb`, `app.setName('Lavish')` e profilo in `~/.local/state/lavish-mb/app-personal`.

## Motore e firma

Il motore è l'Electron 44.2.0 ufficiale, scaricato a mano dalla pagina dei rilasci di Electron e messo in `~/tools/electron/44.2.0/Electron.app` (oppure `--electron` / `BRUVISH_ELECTRON_APP`). La radice `~/tools` è definita una volta sola, in `protocol.cjs` (`toolsRoot`), e `BRUVISH_TOOLS_ROOT` la sostituisce per le prove. `build.py` controlla id e versione dell'app ufficiale e la sua firma, accetta un pin facoltativo dell'eseguibile (`--electron-sha256` / `BRUVISH_ELECTRON_SHA256`) e registra l'impronta nel receipt. Non scarica nulla.

La firma usa un'identità stabile del Portachiavi, passata con `--identity` o `BRUVISH_SIGN_IDENTITY`; non c'è ripiego ad hoc. Il Portachiavi non è raggiungibile dalla sandbox degli agenti: la build firmata si lancia dal terminale.

```sh
python3 app/build.py --output /private/tmp/bruvish-app/Bruvish.app --dry-run
python3 app/build.py --output /private/tmp/bruvish-app/Bruvish.app
```

La build copia il motore, chiama l'eseguibile `Bruvish`, copia l'inventario `package.json:lavishFiles`, firma, verifica e scrive il receipt `<bundle>.lavish-build.json` accanto al bundle.

## Installazione, adozione e ritorno

Operazioni esplicite; preparare un bundle non le esegue.

```sh
node app/deploy.mjs plan /private/tmp/bruvish-app/Bruvish.app
node app/deploy.mjs apply /private/tmp/bruvish-app/Bruvish.app --receipt-sha256 HASH_DEL_PIANO
node app/adopt.mjs plan app
node app/adopt.mjs apply app
```

`deploy` verifica sorgente, receipt e firma, rifiuta un'istanza in esecuzione, copia in staging, conserva bundle e receipt precedenti con suffisso `.backup-UUID` e li ripristina se la verifica finale fallisce. Destinazione `~/Applications/Bruvish.app` (oppure `LAVISH_APP_BUNDLE`).

`adopt` scrive `~/.config/lavish-mb/opening.json`, unico punto per tutti gli agenti; conserva la configurazione precedente. Senza configurazione si usa Chrome. Ritorno a Chrome: `node app/adopt.mjs apply chrome`. Apre il server di Lavish, che legge il file a ogni richiesta: chi lancia `lavish-axi` non può cambiare la superficie, né per una sola apertura né con un adattatore (vedi «Apertura dal server» in `BRUVISH.md`). Dalla sandbox degli agenti funziona solo se il server gira fuori da essa (avviato dal servizio o da un terminale normale): un server avviato dentro la sandbox fa fallire l'apertura con un errore chiaro e prende la superficie dall'ambiente di chi l'ha avviato. Se l'app non conferma entro 15 s, l'opener la lascia viva e segnala il possibile consenso macOS pendente; un'app mancante o divergente fallisce in modo esplicito, senza cambiare browser.

## Verifiche

```sh
node --test app/test/*.test.mjs
```

La prova DOM della home usa Chrome for Testing headless con `LAVISH_MB_TEST_CHROME`; senza, viene saltata. La prova Electron è opt-in (`LAVISH_MB_TEST_DEDICATED=1` e `LAVISH_APP_BUNDLE`) e richiede la build di Bruvish (`pnpm run build`). Dal terminale, `bash app/verify-library.sh` esegue la suite, costruisce e firma un bundle di prova in una cartella nuova sotto `/private/tmp`, esegue la prova Electron e lascia aperta un'anteprima su dati isolati; non installa nulla e non tocca il servizio.

La home alterna Elenco e Griglia, con Preferiti, pin, Finder e Copia percorso. Trasparenza usa il materiale macOS `under-window`; Anche artefatti estende l'effetto alle review. Con Trasparenza, Vista → Schermo intero (`ctrl-cmd-f`) usa lo schermo intero semplice sullo Space corrente; Vista → Immagine a schermo intero sceglie un'immagine di fondo. Le scelte stanno in `preferences.json` nella cartella di stato dell'app.
