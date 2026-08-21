# K-DOP OS

Sistema operativo personale: Italia → KAFA → direttore della fotografia in Corea.

## Architettura

Quattro sezioni, barra fissa in basso. Tutto il resto sta dentro una di queste.

| Sezione | Contiene |
|---|---|
| **Focus** | La giornata: anello di progresso, task, non negoziabili, agenda, consistenza a 30 giorni. FAB per parcheggiare un'idea al volo. |
| **Accademia** | Coreano (roadmap TOPIK 4 + diario di studio con feedback AI), Mirino KAFA, Portfolio, Diario visione. |
| **Logistica** | Soldi (entrate, uscite, proiezione), Arsenale, Piano in 5 fasi, Canali. |
| **Oracolo** | Coach con proiezioni, Clinica del selezionatore ombra, Parcheggio idee. |

Le impostazioni non sono una sezione: sono l'ingranaggio in alto a destra, che apre un foglio modale.

## Sviluppo locale

```bash
npm install
npm run dev
```

Per far funzionare l'AI in locale hai due strade:

1. **Con le funzioni Netlify** (consigliata, uguale alla produzione):
   ```bash
   npm i -g netlify-cli
   ANTHROPIC_API_KEY=sk-ant-... netlify dev
   ```
2. **Senza funzioni**: apri `src/App.jsx` e riempi `ANTHROPIC_API_KEY` in cima. Comodo per provare, ma non fare il deploy così: quella chiave finisce nel bundle e chiunque apra il devtools se la porta via.

## Deploy su Netlify

1. Metti il progetto su un repo GitHub.
2. Su Netlify: **Add new site → Import an existing project**, scegli il repo.
   Build command e publish directory arrivano da `netlify.toml`, non toccarli.
3. **Site configuration → Environment variables**, aggiungi:
   `ANTHROPIC_API_KEY` = la tua chiave.
4. Deploy. La funzione in `netlify/functions/anthropic.js` risponde su `/api/anthropic`.

Senza quella variabile l'app funziona in tutto tranne le tre feature AI (diario TOPIK, Coach, Clinica), che restituiranno un errore esplicito.

## Sul telefono

Apri il sito in Safari o Chrome e scegli "Aggiungi a schermata Home". Da lì parte a schermo intero, senza barra del browser, con le safe area rispettate. Lo zoom è disattivato e i campi di testo sono a 16px, così iOS non zooma quando ci entri.

## Dati

Tutto in `localStorage`, chiave `hanbit:state:v5`. Nessun server, nessun account, nessun backup automatico: se cancelli i dati del sito, sparisce tutto. Il pulsante di reset è in Impostazioni, in fondo.
