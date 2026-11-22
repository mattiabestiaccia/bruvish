# App Bruvish

App macOS personale per le review Lavish: una finestra con la home (catalogo degli artefatti registrati) e una scheda `WebContentsView` per ogni review. Non esiste un'app Lavish ufficiale: questa cartella è tutta del delta di Bruvish.

L'app usa la build installata di Bruvish (`~/tools/bruvish/current`, il link che sposta `bruvish/scripts/install`, oppure `LAVISH_APP_CORE_ROOT`) e lo stato delle review del servizio (`~/.local/state/lavish-axi-compact`). Non crea una seconda installazione: aprire una review lancia `dist/bruvish.mjs <file> --no-open`, che avvia il servizio quando è spento. Le review concluse dall'utente chiedono una conferma nativa prima di `--reopen`.

La stessa identità canonica del file riusa la scheda senza navigare: bozze e posizione restano. Chiudere una scheda non conclude la review. Il preload esiste solo nella vista locale di home/barra con CSP; negli artefatti niente preload privilegiato, niente Node nei renderer, sandbox e context isolation, IPC limitato al frame principale fidato della vista locale. Il renderer di sfondo della finestra non ha preload. Permessi e nuove finestre sono negati.

## Barra condivisa

La finestra usa `titleBarStyle: hidden` e semafori macOS nativi in alto a sinistra (chiudi, riduci e verde per ingrandire/schermo intero secondo la modalità descritta sotto). La barra è alta 40 px: freccia per la home, **BRUVISH** nello stesso STIX 15 px, peso 700 e spaziatura `.16em` della cornice, schede e interruttore Trasparenza a icona (`role="switch"`, `aria-checked`, nome accessibile e suggerimento). Non ci sono più il pulsante Apri HTML né l'interruttore Anche artefatti; aprire un file resta possibile dal menu File e da Cmd+O.

La barra locale è un'unica superficie larga quanto tutta la finestra, alta 40 px, senza sovrapposizioni o due porzioni affiancate: semafori centrati verticalmente, freccia, marchio e chips delle review da sinistra; tutti i controlli raggruppati a destra (Trasparenza, carte chiuse, Annota, eventuali avvisi e revisioni, pannello e menu). La review inizia a y=40 e occupa tutta la larghezza restante, compresa la conversazione. La home riusa la vista locale a finestra intera.

Il processo principale applica CSS alla sola pagina principale della review per togliere la riga della barra servita, anche dopo un ricaricamento; menu e cassetti reali restano nella review e si aprono sotto la barra locale. Nessun parametro URL o messaggio dell'artefatto abilita questa composizione. La barra locale riprende colori e stato dei controlli letti dal processo principale, non decide uno stato parallelo. Il canale `lavish:review-action` è autorizzato solo per il frame principale della vista locale fidata, come gli altri IPC: accetta soltanto sei nomi (`annotate`, `closed`, `panel`, `more`, `revisions`, `warnings`) e invoca il controllo reale corrispondente nella review attiva. Nessun selettore, codice, URL, comando d'invio o fine sessione è accettato dal chiamante. A larghezza ridotta, pannello usa il controllo reale del foglio mobile. Un renderer locale separato, senza privilegi, conserva l'immagine di sfondo sotto le review trasparenti. Nel browser la barra resta quella servita, alta 30 px, con il proprio marchio.

Trasparenza ha una sola fonte: la preferenza `transparent` dell'app, conservata fra gli avvii e comandata soltanto dall'interruttore nella barra Mac. Il processo principale la scrive sulla pagina della review (`data-mb-app-mode`); l'addon la manda all'artefatto tramite il ponte esistente, che imposta `data-mb-mode`. La stessa scelta governa finestra, cornice e artefatti, senza cambiare bozze o posizione. Non esiste un secondo interruttore negli artefatti generati; il ponte ritira anche quello dei vecchi file generati quando aperti con il servizio aggiornato.

Per le pagine scritte a mano valgono le stesse regole: cornice e documento incorporato usano `color-scheme: dark` coerente, così Chromium non aggiunge un canvas bianco sotto i fondi trasparenti. Da spento, vista, cornice e radice dell'artefatto hanno il fondo pieno `#1f2023`, anche se la pagina non dichiara uno sfondo. Da acceso, il fondo della vista e della radice torna trasparente; la tinta scura al 40% resta sul corpo. Lo stile temporaneo viene sostituito, non eliminato, passando al modo opaco: rimuoverlo ripristinerebbe il fondo bianco della cornice originale.

Le vecchie scelte web `lavish-mb:mode` non vengono più lette né riscritte. Anche il campo storico `artifactBackground`, se presente nel file di preferenze, è conservato per compatibilità ma non può più contraddire l'interruttore unico. Browser, telefono e file standalone partono sempre scuri (`#1f2023`), anche con vecchie preferenze trasparenti: non hanno alcun interruttore, e solo il ponte nell'app Electron su Mac accetta il modo trasparente.

Nome visibile **Bruvish** (bundle, menu, finestra). Restano invariati, per non perdere bozze e consenso del Portachiavi: bundle id `local.lavish.mb`, `app.setName('Lavish')` e profilo in `~/.local/state/lavish-mb/app-personal`.

## Motore e firma

Il motore è l'Electron 44.2.0 ufficiale, scaricato a mano dalla pagina dei rilasci di Electron e messo in `~/tools/electron/44.2.0/Electron.app` (oppure `--electron` / `BRUVISH_ELECTRON_APP`). La radice `~/tools` è definita una volta sola, in `protocol.cjs` (`toolsRoot`), e `BRUVISH_TOOLS_ROOT` la sostituisce per le prove. `build.py` controlla id e versione dell'app ufficiale e l'impronta SHA-256 dell'intero albero di `Electron.app`, e la registra nel receipt (`sourceTreeSha256`). L'impronta copre ogni voce dell'app (lanciatore, framework, app helper, risorse): per ciascuna, in ordine di percorso relativo, il tipo (file, cartella, collegamento simbolico), il percorso, il bit di esecuzione del proprietario per i file, il contenuto dei file e il bersaglio dei collegamenti, che non vengono seguiti. Un file in più, in meno o alterato fa fallire la build. Lo zip ufficiale non è firmato da Electron (nessun `_CodeSignature`, solo la firma ad hoc del linker), quindi `codesign --verify` non è una prova di integrità e non viene eseguito: l'impronta è obbligatoria. Il valore predefinito è quello dell'app 44.2.0 darwin-arm64 estratta dallo zip ufficiale, verificato con `SHASUMS256.txt` del rilascio; `--electron-sha256` / `BRUVISH_ELECTRON_SHA256` lo sostituiscono (per un'altra piattaforma o build) e si riferiscono alla stessa impronta d'albero. Resta la firma con l'identità esplicita sull'app finita e la sua verifica `--strict`. Non scarica nulla.

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

### Avvio dell'app

Il servizio gira dentro un profilo Seatbelt, e l'opener (`open.mjs`) nasce dentro lo stesso profilo. Un processo lanciato direttamente da lì lo eredita: Electron non riesce più a inizializzare la sandbox di Chromium e l'app si chiude («sandbox initialization failed: Operation not permitted»). Per questo l'opener non lancia l'eseguibile, ma passa da LaunchServices con `/usr/bin/open`, come la superficie Chrome: l'app parte fuori dal profilo di chi la chiama.

LaunchServices però ignora argomenti, ambiente e redirezioni di un chiamante dentro una sandbox (la documentazione di `NSWorkspace.OpenConfiguration.arguments` lo dice per gli argomenti; per ambiente e log l'ha mostrato la prova reale). La richiesta quindi non passa dalla riga di comando: l'opener la scrive in `requests/<id>.request.json` nella cartella di stato dell'app (prima in un file `.tmp`, poi rinominato) e chiama solo `open -a <bundle>`, con il bundle verificato da `resolveEngine()` (`~/Applications/Bruvish.app` o `LAVISH_APP_BUNDLE`). `open` avvia l'app o, se è già aperta, la porta in primo piano. L'app prende le richieste all'avvio e a ogni cambiamento di `requests/` (`takeRequests` in `protocol.cjs`), in ordine di arrivo (data di modifica del file, poi nome): legge e cancella ogni file prima di gestirlo, così una richiesta si apre una volta sola. Una richiesta non valida riceve una conferma d'errore. Se la conferma non arriva, l'opener ritira la richiesta, così l'app non la apre più tardi.

Avviata da LaunchServices, l'app usa il proprio ambiente, come quando la si apre dal Finder: cartella di stato, porta e stato del servizio sono quelli predefiniti. Con una `LAVISH_APP_STATE_DIR` diversa nel servizio, l'app deve già essere aperta con la stessa cartella. Poiché dalla sandbox non riceve stdout né stderr, l'app scrive da sé il proprio log in `app.log` (0600, nella cartella di stato). Ci finiscono le richieste rifiutate o fallite, gli errori d'avvio e il log nativo di Chromium, attivato in cima a `main.cjs` con `enable-logging`, `log-file` e `log-level` 1: processo principale e processi figli (GPU, renderer), solo avvisi, errori e crash, quindi righe come «sandbox initialization failed». Electron rilegge quegli switch subito dopo il codice iniziale di `main.cjs` e li passa ai processi figli. Non arriva in `app.log` ciò che Electron scrive prima di quel momento, né i messaggi di livello informativo: fra questi l'output di `console.log` del processo principale e i messaggi della console degli artefatti, che altrimenti lo farebbero crescere senza limite. Restano invariate l'attesa della conferma in `requests/<id>.json`, il controllo del codice dell'app e i messaggi d'errore; se LaunchServices rifiuta l'avvio, l'opener lo dice e non apre altro. Il nuovo canale cambia `main.cjs` e `protocol.cjs`: il bundle va ricostruito e installato di nuovo, e un'app Bruvish già aperta va chiusa (Cmd+Q) prima di usarlo. L'app vecchia non guarda `requests/`, e l'opener scadrebbe dopo 15 s con la diagnosi del consenso macOS. Per lo stesso motivo va chiusa l'anteprima lasciata aperta da `verify-library.sh` prima di aprire review con l'app installata: macOS riconosce l'app aperta dall'identificativo del bundle, non dal percorso, e `open -a` porterebbe in primo piano l'anteprima, che guarda solo la propria cartella `requests/`.

## Verifiche

```sh
node --test app/test/*.test.mjs
```

Le prove dell'opener non avviano app né LaunchServices: `test-helpers/fake-launchservices.mjs` sostituisce `/usr/bin/open`, registra la chiamata e avvia un bundle finto come farebbe LaunchServices per un chiamante in sandbox: senza argomenti, senza log e senza l'ambiente del chiamante.

La prova DOM della home usa Chrome for Testing headless con `LAVISH_MB_TEST_CHROME`; senza, viene saltata. La prova Electron è opt-in (`LAVISH_MB_TEST_DEDICATED=1` e `LAVISH_APP_BUNDLE`) e richiede la build di Bruvish (`pnpm run build`). Con clic reali verifica anche come si cambia una risposta data e ancora in coda: dalla nota nel pannello, con un clic sulla carta in modalità Annota (`test-helpers/card-edit.mjs`, su una pagina scritta a mano a due tocchi) e con una nuova risposta alla stessa domanda, che sostituisce la precedente. Dal terminale, `bash app/verify-library.sh` esegue la suite, costruisce e firma un bundle di prova in una cartella nuova sotto `/private/tmp`, esegue la prova Electron e lascia aperta un'anteprima su dati isolati; non installa nulla e non tocca il servizio.

La home mostra un solo elenco: cerca nel titolo, scegli un suggerimento oppure apri l’imbuto per filtrare. Pin e stella sono indipendenti; `?` apre il fumetto con i dati dell’ultimo lavoro, il percorso, Finder e Copia percorso. La freccia apre la review. Crea una cartella con l’icona cartella `+` e assegna gli artefatti da `?` → «Organizza in». Le assegnazioni si salvano in `catalog-organization.json` accanto a `preferences.json`: non spostano i file HTML. Il catalogo web legge cartelle e contrassegni, senza modificarli. I metadati si registrano con `lavish-axi metadata`, descritto in [BRUVISH.md](../BRUVISH.md#metadati-dellultimo-lavoro).

Trasparenza usa il materiale macOS `under-window`; la stessa preferenza `transparent` governa anche il modo degli artefatti attraverso il ponte, senza un secondo stato. Con Trasparenza, Vista → Schermo intero (`ctrl-cmd-f`) usa lo schermo intero semplice sullo Space corrente; Vista → Immagine a schermo intero sceglie un'immagine di fondo. Le scelte stanno in `preferences.json` nella cartella di stato dell'app.
