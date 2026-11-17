# Guida di stile degli artefatti (segnaposto)

`lavish-axi design` stampa la guida di stile degli artefatti Bruvish: temi, tipografia, schede, minimappa, schema del renderer (`node bruvish/bin/bruvish.mjs render input.json --output pagina.html`) e regole di presentazione. La guida è personale e non sta in questo repository: è il file `bruvish/DESIGN.md`, escluso da `bruvish/.gitignore`.

Per generarla si usa `style-sync-ai`, che copia lo stile comune dal laboratorio di stile (famiglia `lavish`) nei progetti che lo ricevono:

1. Registrare la copia di Bruvish in `style-sync.toml` con un blocco `[[progetto]]` (`nome = "bruvish"`, `famiglia = "lavish"`); le aggiunte proprie di Bruvish vanno nel file locale (`stile.locale.md`), anche lui escluso dal repository.
2. Generare la guida dentro questa cartella:

   ```sh
   style-sync-ai --project bruvish --dest bruvish
   style-sync-ai --apply --project bruvish --dest bruvish
   ```

   La prima riga mostra le differenze senza scrivere nulla.

3. Ricostruire con `pnpm run build`: la build copia la guida in `dist/bruvish-design.md`, da dove la legge `lavish-axi design`.

Senza la guida, `lavish-axi design` esce con un messaggio che rimanda a questo file; la guida ufficiale di Lavish resta disponibile con `lavish-axi design --upstream`. L'installazione (lavoro L5) deve portare con sé la guida locale.
