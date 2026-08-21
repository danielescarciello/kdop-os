import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Check, X, Plus, ChevronDown, Send, Settings, Wallet, Globe,
  Camera, Zap, Sparkles, Plane, GraduationCap, Briefcase,
  Aperture, Languages, TrendingUp, Clock, AlertTriangle,
  CalendarDays, ArrowRight, Film, Eye, Link2, Target, BookOpen,
  ShieldCheck, Rocket, Crosshair, Gavel, ChevronLeft, ChevronRight, Package, Lock, Medal,
  Flame, Scissors,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   HANBIT · K-DOP OS  —  v5
   Italia → KAFA (6 posti) → DoP in Corea
   ═══════════════════════════════════════════════════════════ */

/* ── Persistenza e migrazioni ─────────────────────────────────
   La chiave non cambia MAI più. La versione dello schema vive
   dentro i dati, e al caricamento una catena di migrazioni
   converte il vecchio nel nuovo. Così posso cambiare la
   struttura dell'app senza farti perdere niente.              */
const STORE_KEY = "kdop:state";
const SCHEMA = 6;

/* Chiavi delle versioni precedenti, dalla più recente in giù.
   Vengono lette una volta sola e mai cancellate: restano lì
   come rete di sicurezza. */
const LEGACY_KEYS = [
  "hanbit:state:v6", "hanbit:state:v5", "hanbit:state:v4",
  "hanbit:state:v3", "hanbit:state:v2", "hanbit:state:v1",
];

function migrate(input) {
  const d = Object.assign({}, DEFAULT_STATE, input);
  d.profile = Object.assign({}, DEFAULT_STATE.profile, input.profile);
  const from = Number(input.v || 0);

  /* → 6: le abitudini piatte diventano macro senza passi.
     I log restano validi: una macro senza subs legge la
     propria chiave esattamente come prima. */
  if (from < 6) {
    d.habits = (input.habits || DEFAULT_STATE.habits).map((h) =>
      Array.isArray(h.subs) ? h : Object.assign({}, h, { subs: [] }));
  }

  /* Campi comparsi lungo la strada: se mancano, si riempiono
     col vuoto invece di far esplodere i componenti. */
  ["expenses", "jobs", "goals", "ideas", "tasks", "portfolio",
   "watch", "clinic", "topikLogs", "wishlist"].forEach((k) => {
    if (!Array.isArray(d[k])) d[k] = [];
  });
  ["log", "plan", "topikRoadmap"].forEach((k) => {
    if (!d[k] || typeof d[k] !== "object") d[k] = {};
  });
  if (!d.weekFocus || typeof d.weekFocus !== "object") d.weekFocus = { week: "", tasks: [] };
  if (!Array.isArray(d.medalSeen)) d.medalSeen = [];
  if (d.pinnedMedal === undefined) d.pinnedMedal = null;

  d.v = SCHEMA;
  return d;
}

/* Cerca i dati nella chiave nuova; se non ci sono, recupera la
   versione più recente fra quelle vecchie e la converte. */
async function loadState() {
  const cur = await store.get(STORE_KEY);
  if (cur) {
    try { return { data: migrate(JSON.parse(cur)), recovered: null }; } catch (e) {}
  }
  for (const k of LEGACY_KEYS) {
    const raw = await store.get(k);
    if (!raw) continue;
    try {
      const data = migrate(JSON.parse(raw));
      await store.set(STORE_KEY, JSON.stringify(data));
      return { data, recovered: k };
    } catch (e) {}
  }
  return { data: null, recovered: null };
}

/* ── ENDPOINT AI ─────────────────────────────────────────────
   In produzione su Netlify le chiamate passano da /api/anthropic,
   una funzione server-side che tiene la chiave fuori dal bundle.
   Se lasci ANTHROPIC_API_KEY vuota, l'app usa quel proxy.

   Riempi ANTHROPIC_API_KEY solo per provare in locale senza
   funzioni Netlify. Non fare il deploy con la chiave scritta qui:
   nel bundle è leggibile da chiunque apra il devtools.           */
const ANTHROPIC_API_KEY = ""; // "INSERISCI_QUI_API_KEY" — solo in locale

const AI_URL = ANTHROPIC_API_KEY
  ? "https://api.anthropic.com/v1/messages"
  : "/api/anthropic";

function aiHeaders() {
  const h = { "Content-Type": "application/json" };
  if (ANTHROPIC_API_KEY) {
    h["x-api-key"] = ANTHROPIC_API_KEY;
    h["anthropic-version"] = "2023-06-01";
    h["anthropic-dangerous-direct-browser-access"] = "true";
  }
  return h;
}

/* ── Storage: localStorage nel browser, window.storage dentro
   Claude. Nessuna modifica quando esporti.                     */
/* ── Sincronizzazione: Supabase + cache locale ────────────────
   localStorage resta come cache immediata, così l'app apre
   istantanea e continua a funzionare offline. Supabase è la
   fonte di verità: al login tira giù lo stato del cloud, e ogni
   salvataggio fa il push. Se la rete manca, si scrive comunque
   in locale e si sincronizza appena torna.
   Le chiavi stanno in variabili d'ambiente Vite (VITE_...).    */
const SB_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SB_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const CLOUD_ON = !!(SB_URL && SB_ANON);

let sb = null;
async function getSb() {
  if (!CLOUD_ON) return null;
  if (sb) return sb;
  const { createClient } = await import("@supabase/supabase-js");
  sb = createClient(SB_URL, SB_ANON);
  return sb;
}

const local = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { window.localStorage.removeItem(k); return true; } catch (e) { return false; } },
};

/* store locale, invariato: usato per cache e migrazioni legacy */
const store = {
  async get(k) { return local.get(k); },
  async set(k, v) { return local.set(k, v); },
  async del(k) { return local.del(k); },
};

/* ── Cloud: legge e scrive la riga dello stato dell'utente ──── */
async function cloudLoad(userId) {
  const client = await getSb();
  if (!client) return null;
  const { data, error } = await client
    .from("app_state").select("data").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return data.data || null;
}

async function cloudSave(userId, stateObj) {
  const client = await getSb();
  if (!client) return false;
  const { error } = await client
    .from("app_state")
    .upsert({ user_id: userId, data: stateObj, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });
  return !error;
}

/* Sessione: ritorna l'utente loggato o null */
async function cloudUser() {
  const client = await getSb();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data && data.user ? data.user : null;
}


/* ── Tokens ────────────────────────────────────────────────── */
const C = {
  bg: "#121214", card: "#1B1B1E", card2: "#232327",
  line: "rgba(255,255,255,0.07)", line2: "rgba(255,255,255,0.13)",
  txt: "#F3F3F4", mut: "#9A9AA0", dim: "#69696F",
  shadow: "0 1px 2px rgba(0,0,0,.32), 0 8px 24px rgba(0,0,0,.24)",
};
const FC = {
  crushed: "#5A5A60", under: "#6B9CF5", low: "#A88BF2",
  correct: "#5FD394", high: "#F3C15E", clip: "#F08A84",
};

const PILLARS = [
  { id: "lingua", name: "Lingua", sub: "한국어", hue: FC.under, Icon: Globe },
  { id: "occhio", name: "Occhio", sub: "portfolio · visione", hue: FC.low, Icon: Camera },
  { id: "set", name: "Set", sub: "reparto · crew", hue: FC.correct, Icon: Zap },
  { id: "cassa", name: "Cassa", sub: "soldi · runway", hue: FC.high, Icon: Wallet },
  { id: "nome", name: "Nome", sub: "corpo · prodotti", hue: "#F5A46B", Icon: Sparkles },
];
const P = Object.fromEntries(PILLARS.map((p) => [p.id, p]));

/* ── sfondi cinematografici per pilastro (TaskCard) ────────── */
const PILLAR_IMG = {
  lingua: "https://i.postimg.cc/Mnhvv1xn/26C7DAA9-0C0F-45E4-A842-5B6C08A9E17F.png",
  occhio: "https://i.postimg.cc/VJ3ddX1n/723CC3EA-FF75-4D93-B4F5-5871A3402DA8.png",
  set:    "https://i.postimg.cc/Mnhvv1xy/9D684721-54A5-4C33-ADC5-4E98173E340B.png",
  cassa:  "https://i.postimg.cc/cvVrrfZ7/CF1BB5DC-1DE8-40BA-BC1F-5A9CFCE172EB.png",
  nome:   "https://i.postimg.cc/RWjNNw97/FC5138B2-9F0F-4B54-B8FA-C0F09EB6DF4D.png",
};

/* ── Ruoli di lavoro ───────────────────────────────────────── */
const ROLES = [
  { id: "dop", name: "DoP", w: 1.0, type: "rete" },
  { id: "ac1", name: "1st AC / Focus puller", w: 0.95, type: "rete" },
  { id: "ac2", name: "2nd AC", w: 0.8, type: "rete" },
  { id: "gaffer", name: "Gaffer", w: 0.7, type: "rete" },
  { id: "bestboy", name: "Best Boy / Elettricista", w: 0.6, type: "rete" },
  { id: "assist", name: "Assistente / Runner", w: 0.4, type: "rete" },
  { id: "video", name: "Videomaker", w: 0.5, type: "ibrido" },
  { id: "corto", name: "Corti / autoproduzione", w: 0.6, type: "ibrido" },
  { id: "editor", name: "Editor", w: 0.15, type: "cassa" },
  { id: "wedding", name: "Matrimoni / eventi", w: 0.2, type: "cassa" },
  { id: "altro", name: "Altro", w: 0.3, type: "cassa" },
];
const R = Object.fromEntries(ROLES.map((r) => [r.id, r]));
const TYPE_COLOR = { rete: FC.correct, ibrido: FC.low, cassa: FC.under };
const TYPE_LABEL = { rete: "Rete", ibrido: "Ibrido", cassa: "Cassa" };

/* ── Studio: tassonomie ────────────────────────────────────── */
const WORK_KINDS = [
  { id: "corto", name: "Cortometraggio", narr: true },
  { id: "lungo", name: "Lungometraggio", narr: true },
  { id: "doc", name: "Documentario", narr: true },
  { id: "videoclip", name: "Videoclip", narr: false },
  { id: "spot", name: "Spot / brand", narr: false },
  { id: "esercizio", name: "Esercizio / test", narr: false, neutral: true },
];
const WK = Object.fromEntries(WORK_KINDS.map((k) => [k.id, k]));

const WORK_ROLES = [
  { id: "dop", name: "DoP" }, { id: "operatore", name: "Operatore" },
  { id: "gaffer", name: "Gaffer" }, { id: "regia", name: "Regia" }, { id: "altro", name: "Altro" },
];

const ORIGINS = [
  { id: "corea", name: "Corea", color: FC.correct },
  { id: "asia", name: "Asia (altro)", color: FC.low },
  { id: "europa", name: "Europa", color: FC.under },
  { id: "usa", name: "USA", color: FC.high },
  { id: "altro", name: "Altro", color: FC.crushed },
];
const OR = Object.fromEntries(ORIGINS.map((o) => [o.id, o]));

const TAGS = {
  investimento: { label: "Investimento", color: FC.correct },
  necessario: { label: "Necessario", color: FC.under },
  svago: { label: "Svago", color: FC.high },
  spreco: { label: "Spreco", color: FC.clip },
};

const DEFAULT_CATEGORIES = [
  { name: "Attrezzatura", tag: "investimento" }, { name: "Corso coreano", tag: "investimento" },
  { name: "Corti / produzione", tag: "investimento" }, { name: "Libri / formazione", tag: "investimento" },
  { name: "Affitto", tag: "necessario" }, { name: "Spesa alimentare", tag: "necessario" },
  { name: "Trasporti", tag: "necessario" }, { name: "Bollette / abbonamenti", tag: "necessario" },
  { name: "Palestra", tag: "necessario" }, { name: "Ristoranti / bar", tag: "svago" },
  { name: "Uscite / serate", tag: "svago" }, { name: "Vestiti", tag: "svago" },
  { name: "Acquisti d'impulso", tag: "spreco" }, { name: "Delivery", tag: "spreco" },
  { name: "Altro", tag: "svago" },
];

const DEFAULT_HABITS = [
  { id: "m_kor", label: "Coreano", pillar: "lingua", core: true, subs: [
    { id: "s1", label: "Blocco profondo 90 min" },
    { id: "s2", label: "Anki — richiamo attivo" },
    { id: "s3", label: "Ascolto senza sottotitoli" },
    { id: "s4", label: "Scrittura o conversazione" },
  ]},
  { id: "m_kafa", label: "Portfolio KAFA", pillar: "occhio", core: true, subs: [
    { id: "s1", label: "Smontare una sequenza nel Diario" },
    { id: "s2", label: "Lavorare su un pezzo del portfolio" },
    { id: "s3", label: "Scrivere a una produzione" },
  ]},
  { id: "m_corpo", label: "Corpo", pillar: "nome", core: true, subs: [
    { id: "s1", label: "Allenamento" },
    { id: "s2", label: "Sonno prima dell'una" },
  ]},
  { id: "m_cassa", label: "Cassa", pillar: "cassa", core: true, subs: [
    { id: "s1", label: "Registrare spese e lavori" },
  ]},
  { id: "m_nome", label: "Nome", pillar: "nome", core: false, subs: [
    { id: "s1", label: "App del gaffer" },
    { id: "s2", label: "Un post o un contatto" },
  ]},
];

/* ── Stato di una macro-abitudine in un dato giorno ───────────
   Verde: chiusa. Arancione: parziale — che è comunque un
   giorno in cui hai fatto qualcosa, e va contato come tale.   */
function habitState(h, entry) {
  const subs = h.subs || [];
  if (!subs.length) {
    const done = !!entry[h.id];
    return { status: done ? "full" : "none", done: done ? 1 : 0, tot: 1,
      pct: done ? 1 : 0, color: done ? FC.correct : C.dim };
  }
  const n = subs.filter((sb) => entry[h.id + "." + sb.id]).length;
  const full = !!entry[h.id] || n === subs.length;
  const status = full ? "full" : n > 0 ? "part" : "none";
  return { status, done: full ? subs.length : n, tot: subs.length,
    pct: full ? 1 : n / subs.length,
    color: full ? FC.correct : n > 0 ? FC.high : C.dim };
}

/* Peso di una giornata: una macro chiusa vale 1, una parziale
   mezza. Serve a consistenza ed esposizione. */
const habitWeight = (h, entry) => {
  const st = habitState(h, entry);
  return st.status === "full" ? 1 : st.status === "part" ? 0.5 : 0;
};


/* ── Il Piano: 5 fasi ──────────────────────────────────────── */
const PHASES = [
  {
    id: "p0", Icon: Briefcase, title: "Fase 0", subtitle: "Portfolio e contatti dall'Italia",
    badge: "Nessun visto", when: "12–18 mesi",
    goal: "Tutto quello che ti fa entrare a KAFA si costruisce qui, prima di partire.",
    steps: ["5 lavori narrativi da DoP nel portfolio", "TOPIK 3 superato, TOPIK 4 in preparazione",
      "1 lavoro pagato con una produzione coreana", "Diario visione: 60+ opere smontate, un terzo asiatiche",
      "Budget Corea completato al 100%"],
  },
  {
    id: "p1", Icon: GraduationCap, title: "KAFA", subtitle: "Ammissione e D-2",
    badge: "6 posti l'anno", when: "2 anni",
    goal: "Sei posti in fotografia, selezione sul portfolio, lezioni ed esami in coreano.",
    steps: ["Verificato con KAFA lo status di soggiorno per stranieri", "Showreel e portfolio consegnati",
      "Ammesso al 정규과정 · fotografia", "Diploma e rete degli ex allievi",
      "Passaggio a D-10 pianificato prima di finire"],
  },
  {
    id: "p2", Icon: Plane, title: "Internship", subtitle: "Il corridoio D-10",
    badge: "D-10", when: "fino a 3 anni",
    goal: "Tre anni di residenza legale per farti conoscere senza dover già avere uno sponsor.",
    steps: ["Conversione D-2 → D-10 senza test a punti", "Lista di 15–20 case di produzione target",
      "Internship 6–12 mesi dentro una di esse", "Prime giornate in 촬영팀 come 막내",
      "L'internship diventa il ponte per la sponsorizzazione"],
  },
  {
    id: "p3", Icon: ShieldCheck, title: "Sponsor", subtitle: "E-6-1 (o E-7)",
    badge: "E-6-1", when: "2–3 anni",
    goal: "Status regolare, contratti veri, reddito documentato. Non ancora libertà, ma legittimità.",
    steps: ["Sponsor trovato: casa di produzione registrata", "E-6-1 come professionista dell'immagine",
      "Salita nel reparto camera fino a focus puller", "Reddito annuo sopra la soglia GNI",
      "Punti F-2 accumulati mese per mese"],
  },
  {
    id: "p4", Icon: Rocket, title: "Libertà", subtitle: "F-2-7 e poi F-5",
    badge: "F-2-7", when: "3+ anni",
    goal: "80 punti su 170 e non ti serve più nessuno che ti sponsorizzi. Qui diventi DoP freelance davvero.",
    steps: ["TOPIK 4+ e programma KIIP completato", "80 punti raggiunti", "Domanda F-2-7 depositata",
      "Primo credit come 촬영감독", "Dopo 3 anni continuati → F-5 permanente"],
  },
];

const DEFAULT_STATE = {
  profile: { onboarded: false, savings: 0, incomeEstimate: 0, koreaBudget: 20000, koreaMonths: 12,
    targetDate: "", topikDate: "2027-04-10", topikStart: "" },
  habits: DEFAULT_HABITS, categories: DEFAULT_CATEGORIES,
  log: {}, expenses: [], jobs: [], goals: [], ideas: [], plan: {},
  tasks: [], portfolio: [], watch: [], clinic: [],
  topikRoadmap: {}, topikLogs: [], wishlist: [],
  weekFocus: { week: "", tasks: [] },
};

/* ═══════════════════════════════════════════════════════════
   ROADMAP TOPIK 4 — aprile
   Non è una lista di cose da sapere: è l'ordine in cui vanno
   sapute. Ogni livello poggia su quello sotto.
   ═══════════════════════════════════════════════════════════ */
const TOPIK_PLAN = [
  { id: "gram", name: "Grammatica", color: FC.under, Icon: Languages, groups: [
    { name: "1 · Fondamenta", items: [
      "은/는 contro 이/가 — tema e soggetto",
      "을/를 · 에 · 에서 · 에게 — particelle di base",
      "Presente 아/어요 e passato 았/었어요",
      "Futuro 을 거예요 e intenzione 려고 하다",
      "Negazioni 안 · 못 · 지 않다",
    ]},
    { name: "2 · Struttura della frase", items: [
      "Connettivi: 고 · 아서/어서 · 지만 · 는데",
      "Possibilità 을 수 있다 / 없다",
      "Obbligo 아야 하다 e permesso 아도 되다",
      "Modificatori: 은/는/을 davanti al nome",
      "Discorso indiretto 다고 · 냐고 · 자고 · 라고 하다",
    ]},
    { name: "3 · Onorifici e registri", items: [
      "Forme onorifiche 시 · 드리다 · 계시다 · 말씀",
      "Formale 습니다 contro informale 아요",
      "Umile e deferente: come si parla a un capo reparto",
      "반말 e i casi in cui NON si usa",
    ]},
    { name: "4 · Grammatica da TOPIK 3–4", items: [
      "기 때문에 · 는 바람에 · 탓에 — causa",
      "는 데 · 는 대로 · 는 김에",
      "더니 · 았더니 — scoperta e conseguenza",
      "게 되다 · 아지다 — cambio di stato",
      "잖아요 · 거든요 — sfumature di spiegazione",
      "든지 · 거나 · 밖에 — alternativa e limite",
      "다가 · 았다가 — interruzione",
      "을 텐데 · 을 테니까 — supposizione",
      "다시피 · 는 셈이다 — registro scritto",
    ]},
  ]},
  { id: "voc", name: "Vocaboli", color: FC.low, Icon: BookOpen, groups: [
    { name: "100 verbi base", items: [
      "Verbi 1–25", "Verbi 26–50", "Verbi 51–75", "Verbi 76–100",
      "Tutti e 100 in richiamo attivo, senza guardare",
    ]},
    { name: "Casa e quotidiano", items: [
      "Casa e oggetti", "Cibo e cucina", "Corpo e salute",
      "Tempo, meteo, date", "Trasporti e città",
    ]},
    { name: "Lavoro e set", items: [
      "Reparti e ruoli: 촬영팀 · 조명팀 · 연출부",
      "Camera e ottiche", "Luci, sorgenti, modificatori",
      "Ordini e comandi sul set", "Sicurezza e logistica",
    ]},
    { name: "Cinema e tecnica", items: [
      "Inquadrature e movimenti", "Luce e colore: 톤 · 대비 · 노출",
      "Racconto: 서사 · 인물 · 갈등", "Post: 편집 · 색보정 · 사운드",
      "Lessico critico per parlare di un film",
    ]},
    { name: "Astratti per TOPIK 4", items: [
      "Emozioni e stati d'animo", "Opinione e argomentazione",
      "Società, ambiente, tecnologia", "Connettivi della lingua scritta",
      "Sinonimi e sfumature fra parole vicine",
    ]},
  ]},
  { id: "prat", name: "Pratica", color: FC.correct, Icon: Crosshair, groups: [
    { name: "Ascolto", items: [
      "Livello 1 — un video lento con sottotitoli coreani",
      "Livello 2 — un video a velocità normale senza sottotitoli",
      "Livello 3 — un dialogo tecnico da set, senza sottotitoli",
    ]},
    { name: "Parlato", items: [
      "2 minuti di conversazione di fila",
      "5 minuti di conversazione di fila",
      "Raccontare un tuo lavoro a voce per 5 minuti",
    ]},
    { name: "Scritto", items: [
      "Tema di 100 parole", "Tema di 200 parole",
      "Tema di 300 parole nel formato 쓰기 di TOPIK II",
      "Analisi di una sequenza in coreano, 300 parole",
    ]},
    { name: "Simulazioni d'esame", items: [
      "Prima simulazione TOPIK II completa", "Seconda simulazione",
      "Terza simulazione", "Simulazione a tempo, in condizioni d'esame",
    ]},
  ]},
];

const TOPIK_TOTAL = TOPIK_PLAN.reduce((s, c) => s + c.groups.reduce((n, g) => n + g.items.length, 0), 0);

/* ── utils ─────────────────────────────────────────────────── */
const todayKey = () => new Date().toISOString().slice(0, 10);
const dayKey = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
const lastNDays = (n) => { const o = []; for (let i = 0; i < n; i++) { const d = new Date(); d.setDate(d.getDate() - i); o.push(dayKey(d)); } return o; };
const weekKey = () => {
  const d = new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0");
};
const eur = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(isFinite(n) ? n : 0);
const eur2 = (n) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(isFinite(n) ? n : 0);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const sumAmt = (a) => a.reduce((s, x) => s + Number(x.amount || 0), 0);
const DOW = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const prettyDay = (k) => {
  if (k === todayKey()) return "Oggi";
  if (k === addDays(1)) return "Domani";
  const d = new Date(k);
  return DOW[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1);
};

/* ── motore: reddito auto-calibrante ───────────────────────── */
function computeIncome(state) {
  const seed = Number(state.profile.incomeEstimate || 0);
  const jobs = state.jobs || [];
  if (!jobs.length) return { value: seed, real: 0, seed, conf: 0, days: 0, tier: "Stima iniziale",
    note: "Nessun lavoro registrato: sto usando la tua stima di partenza." };
  const dates = jobs.map((j) => j.date).sort();
  const days = Math.max(1, Math.min(180, daysBetween(dates[0], todayKey()) + 1));
  const win = Math.min(90, days);
  const set = new Set(lastNDays(win));
  const real = (sumAmt(jobs.filter((j) => set.has(j.date))) / win) * 30.44;
  const conf = Math.min(1, days / 90);
  const value = seed > 0 ? seed * (1 - conf) + real * conf : real;
  let tier, note;
  if (conf < 0.2) { tier = "Stima iniziale"; note = "Solo " + days + " giorni di dati: il numero viene ancora quasi tutto dalla tua stima."; }
  else if (conf < 0.5) { tier = "Prime tracce"; note = days + " giorni tracciati. Il dato reale comincia a pesare."; }
  else if (conf < 0.85) { tier = "Affidabile"; note = days + " giorni tracciati. Ormai è il tuo reddito vero."; }
  else { tier = "Solido"; note = "Oltre tre mesi di dati. Questo è quanto guadagni davvero."; }
  return { value, real, seed, conf, days, tier, note };
}

function computeExposure(state) {
  const days = lastNDays(14);
  const per = {};
  PILLARS.forEach((p) => (per[p.id] = { done: 0, possible: 0 }));
  state.habits.forEach((h) => { if (per[h.pillar]) per[h.pillar].possible += 14; });
  days.forEach((d) => {
    const e = state.log[d] || {};
    state.habits.forEach((h) => { if (per[h.pillar]) per[h.pillar].done += habitWeight(h, e); });
  });
  const total = Object.values(per).reduce((s, v) => s + v.done, 0);
  const active = PILLARS.filter((p) => per[p.id].possible > 0);
  const fair = active.length ? 1 / active.length : 0;
  return PILLARS.map((p) => {
    const v = per[p.id];
    const share = total ? v.done / total : 0;
    const ratio = fair ? share / fair : 0;
    let label, color;
    if (v.possible === 0 || v.done === 0) { label = "spento"; color = FC.crushed; }
    else if (ratio < 0.45) { label = "sottoesposto"; color = FC.under; }
    else if (ratio < 0.75) { label = "sotto di 1 stop"; color = FC.low; }
    else if (ratio <= 1.35) { label = "in equilibrio"; color = FC.correct; }
    else if (ratio <= 1.8) { label = "sopra di 1 stop"; color = FC.high; }
    else { label = "bruciato"; color = FC.clip; }
    return Object.assign({}, p, v, { share, ratio, label, color });
  });
}

function computeMoney(state, inc) {
  const profile = state.profile;
  const catTag = Object.fromEntries(state.categories.map((c) => [c.name, c.tag]));
  const d30 = new Set(lastNDays(30)), d90 = new Set(lastNDays(90));
  const in30 = state.expenses.filter((e) => d30.has(e.date));
  const in90 = state.expenses.filter((e) => d90.has(e.date));
  const spend30 = sumAmt(in30), spend90 = sumAmt(in90);
  const daily = in90.length ? spend90 / 90 : in30.length ? spend30 / 30 : 0;
  const monthlySpend = in90.length >= 10 ? daily * 30.44 : spend30;
  const income = inc.value;
  const surplus = income - monthlySpend;
  const savingsRate = income > 0 ? surplus / income : 0;
  const byTag = { investimento: 0, necessario: 0, svago: 0, spreco: 0 };
  const byCat = {};
  in30.forEach((e) => {
    const t = catTag[e.category] || "svago";
    byTag[t] += Number(e.amount || 0);
    byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
  });
  const target = Number(profile.koreaBudget || 0), saved = Number(profile.savings || 0);
  const missing = Math.max(0, target - saved);
  const monthsToTarget = surplus > 0 ? missing / surplus : Infinity;
  let requiredMonthly = null, monthsLeft = null;
  if (profile.targetDate) {
    monthsLeft = daysBetween(todayKey(), profile.targetDate) / 30.44;
    requiredMonthly = monthsLeft > 0 ? missing / monthsLeft : Infinity;
  }
  const gap = requiredMonthly == null ? null : surplus - requiredMonthly;
  const dayCostKorea = profile.koreaBudget && profile.koreaMonths ? profile.koreaBudget / (profile.koreaMonths * 30.44) : 0;
  const leaks = Object.entries(byCat).map(([name, amt]) => ({ name, amt, tag: catTag[name] || "svago" }))
    .filter((c) => c.tag === "spreco" || c.tag === "svago").sort((a, b) => b.amt - a.amt).slice(0, 5);
  return { spend30, monthlySpend, income, surplus, savingsRate, byTag, byCat, target, saved, missing,
    monthsToTarget, requiredMonthly, monthsLeft, gap, dayCostKorea,
    project: (m) => saved + surplus * m, leaks, count30: in30.length, spendDays: in90.length };
}

function computeCareer(state, money) {
  const jobs = state.jobs || [];
  const d90 = new Set(lastNDays(90)), d30 = new Set(lastNDays(30)), dPrev = new Set(lastNDays(60).slice(30));
  const in90 = jobs.filter((j) => d90.has(j.date));
  const pending = jobs.filter((j) => j.status === "sospeso");
  const tot90 = sumAmt(in90), pendingTot = sumAmt(pending);
  const trend = sumAmt(jobs.filter((j) => d30.has(j.date))) - sumAmt(jobs.filter((j) => dPrev.has(j.date)));
  const byRole = {};
  in90.forEach((j) => {
    if (!byRole[j.role]) byRole[j.role] = { amount: 0, n: 0 };
    byRole[j.role].amount += Number(j.amount || 0); byRole[j.role].n += 1;
  });
  const roleRows = Object.entries(byRole).map(([id, v]) => {
    const r = R[id] || R.altro;
    return { id, name: r.name, w: r.w, type: r.type, color: TYPE_COLOR[r.type], amount: v.amount, n: v.n,
      share: tot90 ? v.amount / tot90 : 0 };
  }).sort((a, b) => b.amount - a.amount);
  const byType = { rete: 0, ibrido: 0, cassa: 0 };
  roleRows.forEach((r) => (byType[r.type] += r.amount));
  const reteShare = tot90 ? byType.rete / tot90 : 0;
  const setJobs = in90.filter((j) => (R[j.role] || R.altro).type === "rete");
  const avgSetFee = setJobs.length ? sumAmt(setJobs) / setJobs.length : 0;
  const cameraAmt = (byRole.dop ? byRole.dop.amount : 0) + (byRole.ac1 ? byRole.ac1.amount : 0) + (byRole.ac2 ? byRole.ac2.amount : 0);
  const lightAmt = (byRole.gaffer ? byRole.gaffer.amount : 0) + (byRole.bestboy ? byRole.bestboy.amount : 0);

  const audit = [];
  const dom = roleRows[0];
  if (!in90.length) {
    audit.push({ tone: C.mut, Icon: AlertTriangle, title: "Nessun dato ancora",
      text: "Registra i lavori degli ultimi mesi, anche a memoria. Bastano dieci righe e da lì in poi il tuo reddito lo calcolo io." });
  } else {
    if (dom && dom.share >= 0.45 && dom.type === "cassa") {
      audit.push({ tone: FC.clip, Icon: AlertTriangle, title: "Fai cassa, ma la carriera da DoP è ferma",
        text: "Il " + Math.round(dom.share * 100) + "% arriva da " + dom.name.toLowerCase() + ". Ti paga le bollette e non ti mette su un set. Rifiuta un lavoro di questo tipo al mese e sostituiscilo con un ingaggio da 1st AC o DoP, anche pagato meno." });
    }
    if (reteShare < 0.35) {
      audit.push({ tone: FC.high, Icon: Zap, title: "Poche giornate sul set",
        text: "Solo il " + Math.round(reteShare * 100) + "% del reddito viene da un set vero. Le persone che ti raccomanderanno tra tre anni le incontri lì, non al montaggio." });
    } else if (reteShare >= 0.6) {
      audit.push({ tone: FC.correct, Icon: TrendingUp, title: "Asse giusto",
        text: "Il " + Math.round(reteShare * 100) + "% del reddito viene da giornate sul set. Stai costruendo rete mentre incassi." });
    }
    if (lightAmt > 0 && lightAmt > cameraAmt * 2.5) {
      audit.push({ tone: FC.low, Icon: Camera, title: "Stai salendo la scala sbagliata",
        text: "Quasi tutte le giornate sono in reparto luci. In Corea quella strada porta al 조명감독, capo reparto parallelo al DoP, non un gradino sotto. Se l'obiettivo è 촬영감독, inserisci giornate da 2nd e 1st AC." });
    }
    if (money.gap != null && isFinite(money.gap) && money.gap < 0) {
      const short = -money.gap;
      const n = avgSetFee > 0 ? Math.ceil(short / avgSetFee) : null;
      audit.push({ tone: FC.clip, Icon: Wallet, title: "Non arrivi alla data",
        text: "Metti via " + eur(money.surplus) + " al mese, te ne servono " + eur(money.requiredMonthly) + ". Mancano " + eur(short) + ": "
          + (n ? "sono " + n + " ingagg" + (n > 1 ? "i" : "io") + " in più al mese al tuo compenso medio di " + eur(avgSetFee) + ", oppure alzi il listino." : "alza il listino o aggiungi un ingaggio al mese.") });
    } else if (money.gap != null && isFinite(money.gap)) {
      audit.push({ tone: FC.correct, Icon: TrendingUp, title: "Sopra il minimo",
        text: "Copri il fabbisogno e ti avanzano " + eur(money.gap) + " al mese. Quel margine va in attrezzatura o in giornate pagate meno ma strategiche." });
    }
    if (pendingTot > 0) {
      audit.push({ tone: FC.high, Icon: Clock, title: "Crediti fermi",
        text: "Hai " + eur(pendingTot) + " di lavori fatti e non incassati" + (pending.length > 1 ? " su " + pending.length + " committenti" : "") + ". Sollecitali prima di comprare qualsiasi cosa." });
    }
    if (Math.abs(trend) > 100) {
      audit.push({ tone: trend > 0 ? FC.correct : FC.high, Icon: TrendingUp, title: trend > 0 ? "In crescita" : "In calo",
        text: "Ultimi 30 giorni " + (trend > 0 ? "+" : "") + eur(trend) + " rispetto ai 30 precedenti." });
    }
  }
  return { in90, pending, pendingTot, tot90, roleRows, byType, reteShare, avgSetFee, trend, audit };
}

/* ═══════════════════════════════════════════════════════════
   ALGORITMO KAFA TARGET
   Sei posti l'anno. Questo motore giudica due cose:
   che cosa GIRI (portfolio) e che cosa GUARDI (diario visione).
   Non è un punteggio per farti sentire bravo: serve a dirti
   dove stai sprecando tempo rispetto a quella selezione.
   ═══════════════════════════════════════════════════════════ */
function computeKafa(state) {
  const port = state.portfolio || [];
  const watch = state.watch || [];
  const d30 = new Set(lastNDays(30)), d90 = new Set(lastNDays(90));

  const narr = port.filter((p) => WK[p.kind] && WK[p.kind].narr);
  const comm = port.filter((p) => WK[p.kind] && !WK[p.kind].narr && !WK[p.kind].neutral);
  const dopWorks = port.filter((p) => p.role === "dop");
  const narrDop = port.filter((p) => p.role === "dop" && WK[p.kind] && WK[p.kind].narr);
  const deep = port.filter((p) => (p.luci || "").trim() && (p.lenti || "").trim() && (p.stile || "").trim());

  const kr = watch.filter((w) => w.origin === "corea");
  const asia = watch.filter((w) => w.origin === "corea" || w.origin === "asia");
  const west = watch.filter((w) => w.origin === "europa" || w.origin === "usa");
  const deepW = watch.filter((w) => (w.luci || "").trim().length > 4 && (w.lenti || "").trim());
  const asiaShare = watch.length ? asia.length / watch.length : 0;
  const westShare = watch.length ? west.length / watch.length : 0;
  const recent = port.filter((p) => d30.has(p.date)).length + watch.filter((w) => d30.has(w.date)).length;
  const recent90 = port.filter((p) => d90.has(p.date)).length + watch.filter((w) => d90.has(w.date)).length;

  /* ── punteggio, 100 punti ── */
  const band = (s, lo, hi) => (s >= lo && s <= hi ? 1 : s < lo ? (lo ? s / lo : 0) : Math.max(0, 1 - (s - hi) / (1 - hi || 1)));
  const M = [
    { id: "narr", name: "Lavori narrativi da DoP", max: 25, v: Math.min(1, narrDop.length / 5),
      detail: narrDop.length + " su 5", hint: "KAFA seleziona su racconto, non su brand." },
    { id: "reel", name: "Massa del portfolio", max: 12, v: Math.min(1, port.length / 8),
      detail: port.length + " lavori", hint: "Serve materiale da cui scegliere, poi si taglia." },
    { id: "deep", name: "Profondità delle note", max: 15, v: port.length ? deep.length / port.length : 0,
      detail: deep.length + "/" + port.length + " documentati", hint: "Luci, lenti e stile scritti su ogni lavoro." },
    { id: "asia", name: "Dieta coreana e asiatica", max: 20, v: watch.length ? band(asiaShare, 0.3, 0.65) : 0,
      detail: Math.round(asiaShare * 100) + "% del diario", hint: "Fascia giusta: fra 30% e 65%." },
    { id: "occhio", name: "Occhio europeo mantenuto", max: 13, v: watch.length ? Math.min(1, westShare / 0.25) : 0,
      detail: Math.round(westShare * 100) + "% del diario", hint: "È la tua differenza. Non annacquarla." },
    { id: "ritmo", name: "Attività ultimi 30 giorni", max: 15, v: Math.min(1, recent / 8),
      detail: recent + " voci", hint: "Otto voci al mese fra girato e visto." },
  ];
  const score = Math.round(M.reduce((s, m) => s + m.v * m.max, 0));
  const tone = score >= 75 ? FC.correct : score >= 45 ? FC.high : FC.clip;
  const verdict = score >= 80 ? "Sei un candidato credibile."
    : score >= 60 ? "Ci sei quasi, ma non ancora da cecchino."
    : score >= 35 ? "Stai lavorando, ma non verso quei sei posti."
    : "Adesso non entreresti. Ed è normale: si comincia da qui.";

  /* ── rimproveri e correzioni ── */
  const a = [];
  if (!port.length && !watch.length) {
    a.push({ tone: C.mut, Icon: Crosshair, title: "Il mirino è vuoto",
      text: "Aggiungi i lavori che hai già girato e le ultime cose che hai visto. Da lì in poi ti dico dove stai sbagliando bersaglio." });
  } else {
    if (port.length && comm.length > narr.length) {
      a.push({ tone: FC.clip, Icon: AlertTriangle, title: "Troppo brand, poca narrazione",
        text: "Hai " + comm.length + " fra spot e videoclip contro " + narr.length + " lavori narrativi. Una commissione KAFA non cerca chi illumina un prodotto: cerca chi tiene una scena. Il prossimo lavoro sia un corto, anche di quattro minuti, anche gratis." });
    }
    if (narrDop.length < 5) {
      a.push({ tone: FC.high, Icon: Film, title: "Mancano " + (5 - narrDop.length) + " pezzi da DoP",
        text: "Hai " + narrDop.length + " lavori narrativi firmati come direttore della fotografia. Sotto cinque non hai una selezione, hai una raccolta. Sei posti l'anno significa che ogni pezzo debole ti costa il turno." });
    }
    if (port.length && deep.length / port.length < 0.5) {
      a.push({ tone: FC.low, Icon: BookOpen, title: "Non stai documentando quello che fai",
        text: "Solo " + deep.length + " lavori su " + port.length + " hanno note complete su luci, lenti e stile. Al colloquio ti chiedono perché quella scelta, non se è bella. Se non l'hai scritto, in sala non te lo ricordi." });
    }
    if (watch.length >= 5 && asiaShare < 0.3) {
      a.push({ tone: FC.clip, Icon: Eye, title: "Non stai guardando abbastanza Corea",
        text: "Solo il " + Math.round(asiaShare * 100) + "% del tuo diario è asiatico. Vai a un colloquio in coreano, davanti a persone cresciute su un'altra grammatica di luce. Porta il tuo occhio europeo, ma sappi parlare la loro lingua visiva." });
    }
    if (watch.length >= 5 && asiaShare > 0.65) {
      a.push({ tone: FC.low, Icon: Eye, title: "Ti stai sciogliendo dentro il loro sguardo",
        text: "Il " + Math.round(asiaShare * 100) + "% del diario è asiatico. Non ti prendono perché sai copiare Hong Kyung-pyo: ti prendono perché arrivi da un'altra tradizione. Rimetti dentro europei, altrimenti perdi la sola cosa che gli altri cinque candidati non hanno." });
    }
    if (watch.length >= 8 && deepW.length / watch.length < 0.4) {
      a.push({ tone: FC.high, Icon: Crosshair, title: "Guardi, ma non smonti",
        text: "Su " + watch.length + " opere solo " + deepW.length + " hanno note tecniche vere. Guardare senza scrivere la fonte, l'altezza, la lente e il perché è intrattenimento, non studio." });
    }
    if (recent === 0 && recent90 > 0) {
      a.push({ tone: FC.clip, Icon: Clock, title: "Trenta giorni di silenzio",
        text: "Niente girato e niente visto nell'ultimo mese. La distanza da KAFA non è fatta di anni, è fatta di mesi come questo." });
    }
    if (kr.length > 0 && narrDop.length >= 3 && asiaShare >= 0.3 && asiaShare <= 0.65) {
      a.push({ tone: FC.correct, Icon: Target, title: "Mix corretto",
        text: "Portfolio narrativo che cresce e dieta visiva bilanciata fra Corea ed Europa. È esattamente la posizione da cui si spara a quei sei posti." });
    }
  }

  /* ── prossima mossa concreta ── */
  let nextMove;
  const weakest = M.slice().sort((x, y) => x.v - y.v)[0];
  const moves = {
    narr: "Gira un corto da DoP. Anche cinque minuti, anche con due attori e una finestra.",
    reel: "Aggiungi al database tutti i lavori che hai già fatto: prima di girare, censisci.",
    deep: "Prendi tre lavori già caricati e scrivici sopra luci, lenti e stile. Venti minuti.",
    asia: "Guarda un film coreano e smontane una sequenza nel diario, stasera.",
    occhio: "Rimetti in dieta un europeo: un Deakins, un Alcaine, un Storaro. Con note.",
    ritmo: "Una voce al giorno per sette giorni: girata o vista, indifferente.",
  };
  nextMove = moves[weakest.id];

  return { score, tone, verdict, metrics: M, audit: a, nextMove, port, watch,
    narrDop: narrDop.length, comm: comm.length, narr: narr.length, asiaShare, westShare, kr: kr.length, recent };
}

function computeConsistency(state) {
  const core = state.habits.filter((h) => h.core);
  if (!core.length) return { pct: 0, held: 0, soglia: 0, tot: 0, grid: [] };
  const soglia = Math.ceil(core.length / 2);
  const grid = lastNDays(30).reverse().map((d) => {
    const l = state.log[d] || {};
    const score = core.reduce((s, h) => s + habitWeight(h, l), 0);
    const fulls = core.filter((h) => habitState(h, l).status === "full").length;
    return { date: d, n: score, full: fulls === core.length, held: score >= soglia,
      touched: score > 0 };
  });
  /* Streak calcolato su tutta la storia dei log, non solo 30 giorni.
     Corrente: giorni tenuti di fila fino a oggi (o a ieri, così
     la giornata in corso non spezza la serie prima di sera).
     Record: la serie più lunga mai raggiunta. La medaglia guarda
     il record, non il corrente: una volta conquistata non si perde. */
  const held = (dk) => {
    const l = state.log[dk] || {};
    return core.reduce((s, h) => s + habitWeight(h, l), 0) >= soglia;
  };
  let current = 0;
  for (let i = 0; i < 400; i++) {
    const dk = addDays(-i);
    if (held(dk)) current++;
    else if (i === 0) continue; /* oggi non ancora chiuso: non rompe */
    else break;
  }
  const keys = Object.keys(state.log || {}).sort();
  let record = 0, run = 0, prev = null;
  keys.forEach((dk) => {
    if (!held(dk)) { run = 0; prev = dk; return; }
    run = (prev && daysBetween(prev, dk) === 1) ? run + 1 : 1;
    if (run > record) record = run;
    prev = dk;
  });
  record = Math.max(record, current);

  return { pct: Math.round((grid.filter((g) => g.held).length / 30) * 100),
    held: grid.filter((g) => g.held).length, soglia, tot: core.length, grid,
    streak: current, best: record };
}

/* ── Medaglie ─────────────────────────────────────────────────
   Le soglie sono giorni di miglior streak. Sbloccata = raggiunta
   almeno una volta, e resta tua per sempre: nessuna medaglia si
   rispegne se salti un giorno. È un museo, non una fiche.       */
const MEDALS = [
  { id: "d1",   days: 1,   name: "Il primo colpo",      sub: "Un giorno tenuto",       img: "/medals/1.png" },
  { id: "d5",   days: 5,   name: "Cinque di fila",       sub: "La settimana regge",     img: "/medals/5.png" },
  { id: "d10",  days: 10,  name: "Doppia cifra",         sub: "Non è più un caso",      img: "/medals/10.png" },
  { id: "d20",  days: 20,  name: "Il guardiano",         sub: "Venti giorni",           img: "/medals/15.png" },
  { id: "d50",  days: 50,  name: "Cinquanta",            sub: "Metà strada al mito",    img: null },
  { id: "d100", days: 100, name: "Leggenda",             sub: "Cento giorni",           img: null },
];

function computeMedals(best) {
  return MEDALS.map((m) => Object.assign({}, m, { unlocked: best >= m.days }));
}

/* ── atomi ─────────────────────────────────────────────────── */
const Rise = ({ children, d = 0, style }) => (
  <div className="rise" style={Object.assign({ animationDelay: d + "ms" }, style)}>{children}</div>
);
const Card = ({ children, style, pad = 22, onClick, glow }) => (
  <div onClick={onClick} style={Object.assign({
    background: glow ? "linear-gradient(160deg," + glow + "0E 0%, " + C.card + " 55%)" : C.card,
    borderRadius: 24, padding: pad, border: "1px solid " + (glow ? glow + "26" : C.line),
    boxShadow: C.shadow, cursor: onClick ? "pointer" : "default",
  }, style)}>{children}</div>
);
const Label = ({ children, color = C.dim, style }) => (
  <div style={Object.assign({ fontSize: 12.5, fontWeight: 600, color, marginBottom: 12 }, style)}>{children}</div>
);
const Btn = ({ children, onClick, kind = "ghost", style, full }) => {
  const kinds = {
    ghost: { background: C.card2, color: C.txt, border: "1px solid " + C.line },
    solid: { background: C.txt, color: "#141416", border: "1px solid transparent", fontWeight: 600 },
    quiet: { background: "transparent", color: C.mut, border: "1px solid " + C.line2 },
    danger: { background: "transparent", color: FC.clip, border: "1px solid " + FC.clip + "33" },
  };
  return <button className="btn" onClick={onClick} style={Object.assign({
    fontFamily: "inherit", fontSize: 14.5, fontWeight: 500, padding: "12px 20px",
    borderRadius: 999, cursor: "pointer", width: full ? "100%" : "auto",
  }, kinds[kind], style)}>{children}</button>;
};
const inputBase = {
  width: "100%", background: C.card2, border: "1px solid " + C.line, borderRadius: 16,
  padding: "14px 16px", color: C.txt, fontFamily: "inherit", fontSize: 15,
  outline: "none", boxSizing: "border-box", transition: "border-color .18s",
};
const Field = ({ label, hint, area, ...p }) => (
  <label style={{ display: "block", marginBottom: 16 }}>
    <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>{label}</div>
    {area ? <textarea {...p} style={Object.assign({}, inputBase, { resize: "vertical", lineHeight: 1.55 })} />
      : <input {...p} style={inputBase} />}
    {hint && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.5 }}>{hint}</div>}
  </label>
);
const Empty = ({ children }) => (
  <div style={{ color: C.dim, fontSize: 14.5, padding: "16px 0", lineHeight: 1.6 }}>{children}</div>
);
const Dot = ({ color, size = 8 }) => (
  <span style={{ width: size, height: size, borderRadius: 999, background: color, display: "inline-block", flexShrink: 0 }} />
);
const Pill = ({ children, color }) => (
  <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
    background: color + "1F", color, whiteSpace: "nowrap" }}>{children}</span>
);
const Radio = ({ done, color, size = 24 }) => (
  <span key={done ? "on" : "off"} className={done ? "pop" : ""} style={{
    width: size, height: size, flexShrink: 0, borderRadius: 999,
    border: "1.5px solid " + (done ? "transparent" : C.line2),
    background: done ? color : "transparent", display: "grid", placeItems: "center",
    color: "#141416", transition: "background .2s, border-color .2s",
  }}>{done && <Check size={Math.round(size * 0.58)} strokeWidth={3} />}</span>
);
const Stat = ({ label, value, color, sub }) => (
  <Card pad={18}>
    <div style={{ fontSize: 13, color: C.mut, marginBottom: 7 }}>{label}</div>
    <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-0.03em", color: color || C.txt }}>{value}</div>
    {sub && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>{sub}</div>}
  </Card>
);
function Ring({ value, total, size = 96, color = FC.correct, label }) {
  const r = (size - 12) / 2, circ = 2 * Math.PI * r;
  const pct = total ? Math.min(1, value / total) : 0;
  const full = total > 0 && value >= total;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.card2} strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.25,1), stroke .4s" }} />
      </svg>
      <div className={full ? "pop" : ""} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: size > 80 ? 26 : 15, fontWeight: 700, letterSpacing: "-0.04em",
            color: full ? color : C.txt, lineHeight: 1 }}>
            {label != null ? label : <>{value}<span style={{ color: C.dim, fontWeight: 500, fontSize: size > 80 ? 16 : 11 }}>/{total}</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}
const Select = ({ value, onChange, options, style }) => (
  <select value={value} onChange={onChange} style={style}>
    {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
);

/* ═══════════════════════════════════════════════════════════ */
const SECTIONS = [
  { id: "focus", name: "Focus", Icon: Crosshair },
  { id: "accademia", name: "Accademia", Icon: GraduationCap },
  { id: "logistica", name: "Logistica", Icon: Wallet },
  { id: "oracolo", name: "Oracolo", Icon: Gavel },
];

export default function App() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [sec, setSec] = useState("focus");
  const [settings, setSettings] = useState(false);
  const [quick, setQuick] = useState(false);
  const timer = useRef(null);
  const scroller = useRef(null);

  const [recovered, setRecovered] = useState(null);
  const [user, setUser] = useState(null);
  const [sync, setSync] = useState(CLOUD_ON ? "loading" : "off"); // off | loading | synced | offline
  const cloudTimer = useRef(null);

  /* Avvio: prima la cache locale (istantanea), poi il cloud se
     c'è una sessione. Il cloud, se presente, sovrascrive. */
  useEffect(() => {
    (async () => {
      const { data, recovered } = await loadState();
      if (data) setState(data);
      if (recovered) setRecovered(recovered);

      if (CLOUD_ON) {
        const u = await cloudUser();
        setUser(u);
        if (u) {
          try {
            const remote = await cloudLoad(u.id);
            if (remote) { setState(migrate(remote)); }
            setSync("synced");
          } catch (e) { setSync("offline"); }
        }
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [sec]);

  const persist = (next) => {
    const stamped = Object.assign({}, next, { v: SCHEMA });
    setState(stamped);
    /* cache locale immediata */
    clearTimeout(timer.current);
    timer.current = setTimeout(() => store.set(STORE_KEY, JSON.stringify(stamped)), 400);
    /* push sul cloud, debounce più lungo per non martellare l'API */
    if (CLOUD_ON && user) {
      setSync("loading");
      clearTimeout(cloudTimer.current);
      cloudTimer.current = setTimeout(async () => {
        const ok = await cloudSave(user.id, stamped);
        setSync(ok ? "synced" : "offline");
      }, 1200);
    }
  };

  const onAuth = async (u) => {
    setUser(u);
    setSync("loading");
    try {
      const remote = await cloudLoad(u.id);
      if (remote) setState(migrate(remote));   // il cloud ha già dati: vincono loro
      else await cloudSave(u.id, state);        // primo login: carico lo stato locale
      setSync("synced");
    } catch (e) { setSync("offline"); }
  };

  const onLogout = async () => {
    const client = await getSb();
    if (client) await client.auth.signOut();
    setUser(null); setSync("off");
  };

  const inc = useMemo(() => computeIncome(state), [state]);
  const exposure = useMemo(() => computeExposure(state), [state]);
  const money = useMemo(() => computeMoney(state, inc), [state, inc]);
  const career = useMemo(() => computeCareer(state, money), [state, money]);
  const kafa = useMemo(() => computeKafa(state), [state]);
  const consistency = useMemo(() => computeConsistency(state), [state]);
  const medals = useMemo(() => computeMedals(consistency.best), [consistency.best]);

  if (!ready) return (
    <div style={Object.assign({}, shell, { display: "grid", placeItems: "center", minHeight: "60vh" })}>
      <Styles /><span style={{ color: C.dim, fontSize: 15 }}>Carico…</span>
    </div>
  );
  if (!state.profile.onboarded) return <Onboarding state={state} persist={persist} />;

  const shared = { state, persist, exposure, money, career, kafa, inc, consistency, medals };

  return (
    <div style={shell} ref={scroller}>
      <Styles />
      <TopBar state={state} kafa={kafa} money={money}
        onSettings={() => setSettings(true)} sec={sec} sync={sync} />

      {recovered && (
        <div className="rise" style={{ marginBottom: 14, padding: "13px 16px", borderRadius: 18,
          background: FC.correct + "14", border: "1px solid " + FC.correct + "33",
          display: "flex", alignItems: "flex-start", gap: 11 }}>
          <Check size={16} color={FC.correct} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, lineHeight: 1.55, color: C.txt }}>
              Ho recuperato i tuoi dati dalla versione precedente e li ho convertiti.
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>
              Il vecchio salvataggio resta intatto in {recovered}.
            </div>
          </div>
          <button className="btn" onClick={() => setRecovered(null)} style={{
            background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
            <X size={15} />
          </button>
        </div>
      )}

      <main key={sec} className="rise">
        {sec === "focus" && <Focus {...shared} />}
        {sec === "accademia" && <Accademia {...shared} />}
        {sec === "logistica" && <Logistica {...shared} />}
        {sec === "oracolo" && <Oracolo {...shared} />}
      </main>

      {sec === "focus" && (
        <button className="fab btn" aria-label="Cattura un'idea" onClick={() => setQuick(true)}>
          <Plus size={24} strokeWidth={2.4} />
        </button>
      )}

      {quick && <QuickIdea state={state} persist={persist} onClose={() => setQuick(false)} />}
      {settings && <Sheet title="Impostazioni" onClose={() => setSettings(false)}>
        <Account user={user} sync={sync} onAuth={onAuth} onLogout={onLogout} />
        <Config state={state} persist={persist} inc={inc} />
      </Sheet>}

      <nav className="bottombar">
        <div className="bottombar-inner">
          {SECTIONS.map((s) => {
            const on = sec === s.id;
            return (
              <button key={s.id} onClick={() => setSec(s.id)} className="tabbtn"
                aria-current={on ? "page" : undefined}
                style={{ color: on ? C.txt : C.dim }}>
                <span className={on ? "tabicon on" : "tabicon"}><s.Icon size={21} strokeWidth={on ? 2.3 : 1.9} /></span>
                <span style={{ fontSize: 10.5, fontWeight: on ? 600 : 500, letterSpacing: "0.01em" }}>{s.name}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ── Barra superiore: una riga sola, sempre uguale ─────────── */
function TopBar({ state, kafa, money, onSettings, sec, sync }) {
  const dd = state.profile.targetDate ? daysBetween(todayKey(), state.profile.targetDate) : null;
  const topikLeft = state.profile.topikDate ? daysBetween(todayKey(), state.profile.topikDate) : null;
  const titles = { focus: "Focus", accademia: "Accademia", logistica: "Logistica", oracolo: "Oracolo" };
  const subs = {
    focus: topikLeft != null && topikLeft >= 0 ? topikLeft + " giorni al TOPIK" : "Oggi",
    accademia: "KAFA " + kafa.score + "/100",
    logistica: eur(money.saved) + " / " + eur(money.target),
    oracolo: "Giudizio e proiezioni",
  };
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {titles[sec]}
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 2, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis" }}>{subs[sec]}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {sync && sync !== "off" && (
            <span title={sync === "synced" ? "Sincronizzato" : sync === "loading" ? "Sto salvando…" : "Offline"}
              className={sync === "loading" ? "breathe" : ""}
              style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                background: sync === "synced" ? FC.correct : sync === "offline" ? FC.clip : FC.high }} />
          )}
          <button className="btn iconbtn" onClick={onSettings} aria-label="Impostazioni">
            <Settings size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ── Sub-navigazione a pillole ─────────────────────────────── */
function Pills({ items, value, onChange }) {
  return (
    <div className="nav-scroll pills">
      {items.map(([id, l]) => {
        const on = value === id;
        return (
          <button key={id} className="btn" onClick={() => onChange(id)} style={{
            fontFamily: "inherit", fontSize: 14, fontWeight: on ? 600 : 500,
            padding: "9px 16px", borderRadius: 999, whiteSpace: "nowrap", cursor: "pointer",
            border: "1px solid " + (on ? "transparent" : C.line),
            background: on ? C.txt : "transparent", color: on ? "#141416" : C.mut,
            transition: "all .2s", flexShrink: 0,
          }}>{l}</button>
        );
      })}
    </div>
  );
}

/* ── FOCUS ─────────────────────────────────────────────────── */
function Focus({ state, persist, exposure, consistency, medals }) {
  return <Oggi state={state} persist={persist} exposure={exposure} consistency={consistency} medals={medals} />;
}

/* ── ACCADEMIA: coreano + studio KAFA ──────────────────────── */
function Accademia({ state, persist, kafa, consistency, medals }) {
  const [v, setV] = useState("coreano");
  return (
    <>
      <Pills value={v} onChange={setV} items={[
        ["coreano", "Coreano"], ["mirino", "Mirino"], ["portfolio", "Portfolio"],
        ["diario", "Diario"], ["trofei", "Trofei"],
      ]} />
      <div key={v} className="rise" style={{ display: "grid", gap: 16 }}>
        {v === "coreano" && <Topik state={state} persist={persist} />}
        {v === "mirino" && <Mirino kafa={kafa} />}
        {v === "portfolio" && <Portfolio state={state} persist={persist} kafa={kafa} />}
        {v === "diario" && <Diario state={state} persist={persist} kafa={kafa} />}
        {v === "trofei" && <Trofei state={state} persist={persist} consistency={consistency} medals={medals} />}
      </div>
    </>
  );
}

/* ── LOGISTICA: soldi + piano + canali ─────────────────────── */
function Logistica({ state, persist, exposure, money, career, kafa, inc }) {
  const [v, setV] = useState("soldi");
  return (
    <>
      <Pills value={v} onChange={setV} items={[
        ["soldi", "Soldi"], ["arsenale", "Arsenale"], ["piano", "Piano"], ["canali", "Canali"],
      ]} />
      <div key={v} className="rise" style={{ display: "grid", gap: 16 }}>
        {v === "soldi" && <Soldi state={state} persist={persist} money={money} career={career} inc={inc} />}
        {v === "arsenale" && <Arsenale state={state} persist={persist} money={money} />}
        {v === "piano" && <Piano state={state} persist={persist} exposure={exposure} money={money} career={career} kafa={kafa} />}
        {v === "canali" && <Canali state={state} persist={persist} exposure={exposure} />}
      </div>
    </>
  );
}

/* ── ORACOLO: coach + clinica + parcheggio idee ────────────── */
function Oracolo({ state, persist, money, exposure, career, kafa, inc }) {
  const [v, setV] = useState("coach");
  return (
    <>
      <Pills value={v} onChange={setV} items={[
        ["coach", "Coach"], ["clinica", "Clinica"], ["idee", "Parcheggio"],
      ]} />
      <div key={v} className="rise" style={{ display: "grid", gap: 16 }}>
        {v === "coach" && <Coach state={state} money={money} exposure={exposure} career={career} kafa={kafa} inc={inc} />}
        {v === "clinica" && <Clinica state={state} persist={persist} kafa={kafa} />}
        {v === "idee" && <Idee state={state} persist={persist} />}
      </div>
    </>
  );
}

/* ── Cattura rapida di un'idea (FAB) ───────────────────────── */
function QuickIdea({ state, persist, onClose }) {
  const [txt, setTxt] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);
  const save = () => {
    const v = txt.trim();
    if (v) persist(Object.assign({}, state, {
      ideas: [{ id: "i" + Date.now(), text: v, date: todayKey() }].concat(state.ideas),
    }));
    onClose();
  };
  return (
    <Sheet title="Parcheggia un'idea" onClose={onClose}>
      <p style={{ color: C.mut, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 14px" }}>
        Scaricala e torna a quello che stavi facendo. La rileggi a fine settimana.
      </p>
      <textarea ref={ref} value={txt} onChange={(e) => setTxt(e.target.value)} rows={4}
        placeholder="Cosa ti è appena passato per la testa"
        style={Object.assign({}, inputBase, { resize: "none", lineHeight: 1.55, marginBottom: 14 })} />
      <Btn kind="solid" full onClick={save}>Parcheggia</Btn>
    </Sheet>
  );
}

/* ── Foglio modale a scomparsa dal basso ───────────────────── */
function Sheet({ title, children, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, []);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="grabber" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</span>
            <button className="btn iconbtn" onClick={onClose} aria-label="Chiudi"><X size={17} /></button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const shell = {
  background: C.bg, color: C.txt, minHeight: "100vh",
  maxWidth: 640, margin: "0 auto", position: "relative",
  padding: "calc(env(safe-area-inset-top) + 62px) 16px calc(env(safe-area-inset-bottom) + 92px)",
  letterSpacing: "-0.011em",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    :root { color-scheme: dark; }
    * { -webkit-font-smoothing: antialiased; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body, #root { background: ${C.bg}; margin: 0; padding: 0; }
    body {
      overscroll-behavior-y: none;
      text-size-adjust: 100%; -webkit-text-size-adjust: 100%;
    }

    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @keyframes pop  { 0% { transform: scale(1); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
    @keyframes breathe { 0%,100% { opacity: .5; } 50% { opacity: .95; } }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: none; } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
    @keyframes unlockPop {
      0% { transform: scale(.4) rotate(-12deg); opacity: 0; }
      55% { transform: scale(1.14) rotate(4deg); opacity: 1; }
      100% { transform: scale(1) rotate(0); opacity: 1; }
    }
    @keyframes glowPulse {
      0%,100% { opacity: .35; transform: scale(.92); }
      50% { opacity: .75; transform: scale(1.05); }
    }
    .rise { animation: rise .42s cubic-bezier(.2,.8,.25,1) both; }
    .pop  { animation: pop .34s cubic-bezier(.3,1.4,.5,1); }
    .breathe { animation: breathe 3.2s ease-in-out infinite; }
    .floaty { animation: floaty 3.6s ease-in-out infinite; }
    .unlockPop { animation: unlockPop .6s cubic-bezier(.34,1.56,.64,1) both; }

    /* ── barra superiore ── */
    .topbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 40;
      background: ${C.bg}E8; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      border-bottom: 1px solid ${C.line};
      padding-top: env(safe-area-inset-top);
    }
    .topbar-inner {
      max-width: 640px; margin: 0 auto; height: 60px; padding: 0 16px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }

    /* ── barra inferiore ── */
    .bottombar {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
      background: ${C.bg}F0; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
      border-top: 1px solid ${C.line};
      padding-bottom: env(safe-area-inset-bottom);
    }
    .bottombar-inner {
      max-width: 640px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr);
    }
    .tabbtn {
      background: none; border: none; cursor: pointer; font-family: inherit;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 9px 0 8px; transition: color .2s; min-height: 56px;
    }
    .tabicon { display: grid; place-items: center; height: 26px; width: 46px; border-radius: 999px; transition: background .22s; }
    .tabicon.on { background: rgba(255,255,255,.09); }
    .tabbtn:active .tabicon { transform: scale(.9); }

    /* ── pulsante flottante ── */
    .fab {
      position: fixed; z-index: 45; right: max(16px, calc(50vw - 320px + 16px));
      bottom: calc(env(safe-area-inset-bottom) + 74px);
      width: 56px; height: 56px; border-radius: 999px; border: none; cursor: pointer;
      background: ${C.txt}; color: #141416; display: grid; place-items: center;
      box-shadow: 0 6px 20px rgba(0,0,0,.45);
    }

    /* ── foglio modale ── */
    .scrim {
      position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.6);
      backdrop-filter: blur(3px); display: flex; align-items: flex-end; justify-content: center;
      animation: fadeIn .2s ease both;
    }
    .sheet {
      width: 100%; max-width: 640px; background: ${C.card}; border-radius: 26px 26px 0 0;
      border-top: 1px solid ${C.line2}; max-height: 92vh; display: flex; flex-direction: column;
      animation: slideUp .3s cubic-bezier(.2,.8,.25,1) both;
    }
    .sheet-head { padding: 10px 20px 14px; border-bottom: 1px solid ${C.line}; }
    .grabber { display: block; width: 38px; height: 4px; border-radius: 999px;
      background: ${C.line2}; margin: 0 auto 14px; }
    .sheet-body {
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      padding: 18px 16px calc(env(safe-area-inset-bottom) + 26px);
    }

    .pills { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 20px; padding-bottom: 2px; }

    /* ── medaglie ── */
    .medalgrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    @keyframes shine {
      0% { transform: translateX(-120%) rotate(8deg); }
      100% { transform: translateX(220%) rotate(8deg); }
    }
    .medal-shine { position: relative; overflow: hidden; border-radius: 999px; }
    .medal-shine::after {
      content: ""; position: absolute; top: -20%; left: 0; width: 40%; height: 140%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent);
      animation: shine 4.5s ease-in-out infinite; animation-delay: 1s;
    }

    /* ── card medaglia nella galleria ── */
    .medalcard { transition: transform .18s cubic-bezier(.34,1.4,.6,1), border-color .2s, box-shadow .2s; }
    @media (hover: hover) { .medalcard.on:hover { transform: translateY(-4px); box-shadow: 0 12px 28px rgba(0,0,0,.28); } }
    .medalcard.on:active { transform: scale(.97); }
    .medalglow {
      position: absolute; inset: 8px; border-radius: 999px; z-index: 0;
      background: radial-gradient(circle, rgba(201,162,75,.45), transparent 68%);
      filter: blur(6px); animation: glowPulse 3.4s ease-in-out infinite;
    }
    .medalimg-wrap { position: relative; z-index: 1; overflow: hidden; border-radius: 18px; }
    .medalimg-wrap::after {
      content: ""; position: absolute; top: -30%; left: 0; width: 45%; height: 160%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
      transform: translateX(-160%) rotate(8deg); pointer-events: none;
    }
    @media (hover: hover) { .medalcard.on:hover .medalimg-wrap::after { animation: shine .9s ease-in-out; } }

    /* ── Focus: barra sticky filtri + contatori ── */
    .focusbar {
      position: sticky; top: calc(env(safe-area-inset-top) + 62px); z-index: 25;
      background: ${C.bg}E8; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      margin: 0 -16px 4px; padding: 10px 16px 0;
    }
    .focusbar-counters { display: flex; gap: 10px; margin-bottom: 12px; }
    .counter {
      display: flex; align-items: center; gap: 6px; font-size: 13px; color: ${C.mut};
      background: ${C.card}; border: 1px solid ${C.line}; padding: 7px 13px; border-radius: 999px;
    }
    .counter b { color: ${C.txt}; font-size: 14.5px; font-weight: 700; letter-spacing: -0.02em; }

    /* ── TaskCard cinematografica ── */
    .taskcard {
      position: relative; border-radius: 20px; min-height: 108px;
      background-size: cover; background-position: center; background-repeat: no-repeat;
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 16px; overflow: hidden; cursor: pointer; width: 100%; border: none;
      font-family: inherit; text-align: left;
      transition: opacity .35s ease, transform .15s ease;
      box-shadow: 0 4px 18px rgba(0,0,0,.35);
    }
    .taskcard:active { transform: scale(.985); }
    .taskcard.done { opacity: .48; }
    .taskcard-info { position: relative; z-index: 1; min-width: 0; }
    .taskcard-pillar {
      font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
      color: rgba(255,255,255,.6); margin-bottom: 5px;
    }
    .taskcard-title { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.02em; line-height: 1.2; }
    .taskcard-sub { font-size: 12.5px; color: rgba(255,255,255,.65); margin-top: 5px; }
    .taskcheck {
      position: relative; z-index: 1; flex-shrink: 0; width: 52px; height: 52px; border-radius: 999px;
      border: 2px solid rgba(255,255,255,.4); background: rgba(0,0,0,.28);
      display: grid; place-items: center; color: #fff; cursor: pointer; backdrop-filter: blur(4px);
      font-family: inherit; font-weight: 700; font-size: 13px;
      transition: background .2s, border-color .2s, transform .15s;
    }
    .taskcheck:active { transform: scale(.88); }
    .taskcheck.on { background: ${FC.correct}; border-color: ${FC.correct}; color: #0d1410; }
    .taskcard-subs { display: grid; gap: 6px; padding: 2px 2px 0; }
    .tasksub-row {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px;
      background: ${C.card}; border: 1px solid ${C.line}; width: 100%; text-align: left;
      font-family: inherit; cursor: pointer;
    }

    /* ── Cut! bottone chiudi giornata ── */
    .cutbtn {
      width: 100%; border: none; border-radius: 20px; padding: 19px;
      background: linear-gradient(135deg, #202023, #0a0a0b);
      border: 1px solid ${C.line2}; color: #fff; font-family: inherit; font-weight: 700;
      font-size: 15.5px; letter-spacing: .03em; display: flex; align-items: center;
      justify-content: center; gap: 10px; cursor: pointer; position: relative;
      overflow: hidden; transition: transform .15s;
    }
    .cutbtn:active { transform: scale(.98); }
    .cutbtn::before {
      content: ""; position: absolute; inset: 0;
      background: repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 10px, transparent 10px 20px);
      pointer-events: none;
    }

    /* ── Daily Wrap: modal cinematografico ── */
    .wrapscrim {
      position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.78);
      backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center;
      padding: 20px; animation: fadeIn .22s ease both;
    }
    .wrapcard {
      position: relative; width: min(92vw, 420px); background: linear-gradient(180deg, #18181b, #0c0c0e);
      border: 1px solid ${C.line2}; border-radius: 28px; padding: 40px 26px 28px; text-align: center;
      box-shadow: 0 30px 90px rgba(0,0,0,.65); animation: rise .4s cubic-bezier(.2,.8,.25,1) both;
    }
    .wrap-close { position: absolute; top: 14px; right: 14px; }
    .wrap-eyebrow {
      font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: ${C.dim};
    }
    .wrap-medalname { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; color: #C9A24B; margin-top: 6px; }
    .wrap-medalsub { font-size: 13px; color: ${C.mut}; margin-top: 3px; margin-bottom: 6px; }
    .wrap-streak {
      display: flex; align-items: center; justify-content: center; gap: 9px;
      font-size: 52px; font-weight: 800; letter-spacing: -0.045em; margin-top: 10px;
    }
    .wrap-streaksub { font-size: 14px; color: ${C.mut}; margin-bottom: 22px; }
    .wrap-stats { display: flex; gap: 10px; margin-bottom: 24px; }
    .wrap-stat { flex: 1; background: ${C.card}; border: 1px solid ${C.line}; border-radius: 16px; padding: 14px 10px; }
    .wrap-num { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; }
    .wrap-lbl { font-size: 11px; color: ${C.dim}; margin-top: 3px; }

    .iconbtn {
      width: 38px; height: 38px; border-radius: 999px; flex-shrink: 0;
      border: 1px solid ${C.line}; background: transparent; color: ${C.mut};
      display: grid; place-items: center; cursor: pointer;
    }
    .btn { transition: transform .12s ease, opacity .15s; }
    .btn:active { transform: scale(.95); }
    .row { transition: background .15s; border-radius: 12px; }
    @media (hover: hover) { .row:hover { background: rgba(255,255,255,.028); } }

    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid ${FC.correct}; outline-offset: 2px;
    }
    /* 16px minimo: sotto questa soglia iOS zooma al focus */
    input, textarea, select { font-size: 16px !important; }
    input:focus, textarea:focus { border-color: ${C.line2} !important; }
    input::placeholder, textarea::placeholder { color: ${C.dim}; }
    select {
      background: ${C.card2}; color: ${C.txt}; border: 1px solid ${C.line}; border-radius: 16px;
      padding: 14px 16px; font-family: inherit; outline: none; width: 100%;
      appearance: none; -webkit-appearance: none;
      background-image: linear-gradient(45deg, transparent 50%, ${C.mut} 50%), linear-gradient(135deg, ${C.mut} 50%, transparent 50%);
      background-position: calc(100% - 20px) 22px, calc(100% - 15px) 22px;
      background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
    }
    a { color: ${FC.under}; text-decoration: none; }
    .nav-scroll::-webkit-scrollbar { display: none; }
    .nav-scroll { scrollbar-width: none; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: ${C.line2}; border-radius: 999px; }

    @media (prefers-reduced-motion: reduce) { *, .rise, .pop, .breathe { animation: none !important; transition: none !important; } }
  `}</style>
);


/* ═══════════════════════════════════════════════════════════
   OGGI — abitudini + task del giorno + calendario
   ═══════════════════════════════════════════════════════════ */
function Oggi({ state, persist, exposure, consistency, medals }) {
  const tk = todayKey();
  const entry = state.log[tk] || {};
  const habits = state.habits || [];
  const tasks = state.tasks || [];
  const todayTasks = tasks.filter((t) => t.date === tk);
  const [openId, setOpenId] = useState(null);
  const [flying, setFlying] = useState("");
  const [filter, setFilter] = useState("all");
  const [showWrap, setShowWrap] = useState(false);

  const writeLog = (patch) => persist(Object.assign({}, state, {
    log: Object.assign({}, state.log, { [tk]: Object.assign({}, entry, patch) }),
  }));

  /* Toccare la macro chiude o riapre tutto insieme */
  const toggleMacro = (h) => {
    const st = habitState(h, entry);
    const on = st.status !== "full";
    const patch = { [h.id]: on };
    (h.subs || []).forEach((sb) => { patch[h.id + "." + sb.id] = on; });
    writeLog(patch);
  };

  /* Toccare un sub: se li chiudi tutti, la macro diventa verde da sola */
  const toggleSub = (h, sb) => {
    const key = h.id + "." + sb.id;
    const next = Object.assign({}, entry, { [key]: !entry[key] });
    const n = (h.subs || []).filter((x) => next[h.id + "." + x.id]).length;
    next[h.id] = n === (h.subs || []).length && n > 0;
    persist(Object.assign({}, state, { log: Object.assign({}, state.log, { [tk]: next }) }));
  };

  const states = habits.map((h) => ({ h, st: habitState(h, entry) }));
  const core = states.filter((x) => x.h.core);
  const extra = states.filter((x) => !x.h.core);
  const fulls = core.filter((x) => x.st.status === "full").length;
  const parts = core.filter((x) => x.st.status === "part").length;
  const score = core.reduce((s, x) => s + (x.st.status === "full" ? 1 : x.st.status === "part" ? 0.5 : 0), 0);
  const allDone = core.length > 0 && fulls === core.length;
  const held = score >= consistency.soglia;
  const doneTasks = todayTasks.filter((t) => t.done).length;
  const darkest = exposure.filter((e) => e.possible > 0).sort((a, b) => a.ratio - b.ratio)[0];

  const setTasks = (list) => persist(Object.assign({}, state, { tasks: list }));
  const toggleTask = (id) => setTasks(tasks.map((t) => (t.id === id ? Object.assign({}, t, { done: !t.done }) : t)));
  const editTask = (id, text) => setTasks(tasks.map((t) => (t.id === id ? Object.assign({}, t, { text }) : t)));
  const rmTask = (id) => setTasks(tasks.filter((t) => t.id !== id));
  const addTask = (date, text, pillar) => setTasks([{ id: "t" + Date.now() + Math.random().toString(36).slice(2, 5),
    date, text, pillar: pillar || null, done: false }].concat(tasks));
  const addFlying = () => {
    const v = flying.trim();
    if (!v) return;
    addTask(tk, v, null);
    setFlying("");
  };

  let d = 0; const next = () => (d += 60);

  const pinned = (medals || []).find((m) => m.id === state.pinnedMedal && m.unlocked);

  /* filtro a pillole: tocca chi si vede sotto, non cambia i dati */
  const passFilter = (st) => filter === "all" || (filter === "todo" ? st.status !== "full" : st.status === "full");
  const visCore = core.filter((x) => passFilter(x.st));
  const visExtra = extra.filter((x) => passFilter(x.st));

  /* placeholder conto alla rovescia: usa la data di partenza già in Config;
     puoi sostituirla con una vera scadenza KAFA quando la aggiungi. */
  const kafaDays = state.profile.targetDate ? daysBetween(tk, state.profile.targetDate) : null;

  /* medaglia da festeggiare nel Daily Wrap: coincide con lo streak di oggi */
  const hitMedal = (medals || []).find((m) => m.days === consistency.streak);

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {pinned && (
        <Rise d={next()}>
          <PinnedMedal medal={pinned} streak={consistency.streak} best={consistency.best} />
        </Rise>
      )}

      <Rise d={next()}>
        <div className="focusbar">
          <div className="focusbar-counters">
            <span className="counter"><Flame size={15} color={FC.high} /> <b key={consistency.streak} className="pop">{consistency.streak}</b> streak</span>
            <span className="counter"><Target size={15} color={FC.under} />
              <b>{kafaDays != null && kafaDays >= 0 ? kafaDays : "—"}</b> al KAFA</span>
          </div>
          <Pills value={filter} onChange={setFilter} items={[
            ["all", "Tutte"], ["todo", "Da fare"], ["done", "Completate"],
          ]} />
        </div>
      </Rise>

      {/* ── STATO DEL GIORNO ── */}
      <Rise d={next()}>
        <Card glow={allDone ? FC.correct : held ? FC.high : null}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em" }}>
            {allDone ? "Giornata chiusa." : score === 0 ? "Si comincia." : held ? "Giornata salva." : "In movimento."}
          </div>
          <div style={{ fontSize: 14, color: C.mut, marginTop: 3 }}>
            {allDone ? "Tutto verde. Il resto di oggi è tuo."
              : held ? "Hai già superato la soglia. Tutto quello che aggiungi è guadagnato."
              : "Ti serve " + consistency.soglia + " su " + core.length + " perché il giorno conti. Sei a " + (score % 1 ? score.toFixed(1) : score) + "."}
          </div>
        </Card>
      </Rise>

      {/* ── TASK CARDS: non negoziabili ── */}
      <Rise d={next()}>
        <div style={{ display: "grid", gap: 12 }}>
          <Label>Non negoziabili</Label>
          {core.length === 0 && <Empty>Nessuna macro-categoria. Creale dall'ingranaggio in alto.</Empty>}
          {core.length > 0 && visCore.length === 0 && (
            <Empty>{filter === "done" ? "Ancora nessuna chiusa oggi." : "Le hai già chiuse tutte. 🎬"}</Empty>
          )}
          {visCore.map(({ h, st }) => (
            <TaskCard key={h.id} h={h} st={st} entry={entry} open={openId === h.id}
              onOpen={() => setOpenId(openId === h.id ? null : h.id)}
              onMacro={() => toggleMacro(h)} onSub={(sb) => toggleSub(h, sb)} />
          ))}
        </div>
      </Rise>

      {extra.length > 0 && (
        <Rise d={next()}>
          <div style={{ display: "grid", gap: 12 }}>
            <Label>Secondarie</Label>
            {visExtra.length === 0 && (
              <Empty>{filter === "done" ? "Ancora nessuna chiusa oggi." : "Le hai già chiuse tutte."}</Empty>
            )}
            {visExtra.map(({ h, st }) => (
              <TaskCard key={h.id} h={h} st={st} entry={entry} open={openId === h.id}
                onOpen={() => setOpenId(openId === h.id ? null : h.id)}
                onMacro={() => toggleMacro(h)} onSub={(sb) => toggleSub(h, sb)} />
            ))}
          </div>
        </Rise>
      )}

      {/* ── CHIUDI GIORNATA ── */}
      <Rise d={next()}>
        <button className="cutbtn" onClick={() => setShowWrap(true)}>
          <Scissors size={18} />
          CHIUDI GIORNATA · CUT!
        </button>
      </Rise>

      {showWrap && (
        <DailyWrap onClose={() => setShowWrap(false)} streak={consistency.streak}
          fulls={fulls} coreTot={core.length} doneTasks={doneTasks} todayTasksLen={todayTasks.length}
          medal={hitMedal} />
      )}

      {/* ── TASK VOLANTI ── */}
      <Rise d={next()}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Label style={{ margin: 0 }}>Le cose di oggi</Label>
            {todayTasks.length > 0 && <span style={{ fontSize: 13, color: C.mut }}>{doneTasks}/{todayTasks.length}</span>}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: todayTasks.length ? 14 : 0 }}>
            <input value={flying} onChange={(e) => setFlying(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFlying(); } }}
              placeholder="Portare fuori il cane, chiamare il commercialista…"
              style={Object.assign({}, inputBase, { flex: 1 })} />
            <button className="btn" onClick={addFlying} style={{
              width: 48, borderRadius: 16, border: "none", flexShrink: 0,
              background: C.txt, color: "#141416", cursor: "pointer", display: "grid", placeItems: "center",
            }}><Plus size={18} /></button>
          </div>

          {todayTasks.map((t) => (
            <div key={t.id} className="row" style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "11px 8px" }}>
              <button className="btn" onClick={() => toggleTask(t.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", marginTop: 1 }}>
                <Radio done={t.done} color={t.pillar && P[t.pillar] ? P[t.pillar].hue : FC.low} size={22} />
              </button>
              <input value={t.text} onChange={(e) => editTask(t.id, e.target.value)} style={{
                flex: 1, background: "transparent", border: "none", outline: "none", padding: 0,
                color: t.done ? C.dim : C.txt, fontFamily: "inherit", lineHeight: 1.5,
                textDecoration: t.done ? "line-through" : "none",
              }} />
              <button className="btn" onClick={() => rmTask(t.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
                <X size={14} />
              </button>
            </div>
          ))}
        </Card>
      </Rise>

      <Rise d={next()}>
        <Agenda state={state} tasks={tasks} addTask={addTask} toggleTask={toggleTask}
          editTask={editTask} rmTask={rmTask} exposure={exposure} />
      </Rise>

      {darkest && (
        <Rise d={next()}>
          <Card glow={darkest.color}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Dot color={darkest.color} />
              <span style={{ fontSize: 13, color: C.mut, fontWeight: 500 }}>Il canale da riaccendere</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 46, height: 46, borderRadius: 15, background: darkest.color + "1F",
                display: "grid", placeItems: "center", color: darkest.color, flexShrink: 0 }}>
                <darkest.Icon size={21} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em" }}>{darkest.name}</div>
                <div style={{ fontSize: 14, color: darkest.color }}>{darkest.label} · {Math.round(darkest.share * 100)}% della tua attenzione</div>
              </div>
            </div>
          </Card>
        </Rise>
      )}

      <Rise d={next()}><Consistency c={consistency} /></Rise>
      <Rise d={next()}><ExposureCard exposure={exposure} /></Rise>
    </div>
  );
}

/* ── TaskCard cinematografica: sfondo = pilastro, check grande ── */
function TaskCard({ h, st, entry, open, onOpen, onMacro, onSub }) {
  const pillar = P[h.pillar];
  const img = PILLAR_IMG[h.pillar];
  const done = st.status === "full";
  const hasSubs = (h.subs || []).length > 0;
  return (
    <div style={{ display: "grid", gap: hasSubs && open ? 8 : 0 }}>
      <button
        className={"taskcard" + (done ? " done" : "")}
        onClick={() => (hasSubs ? onOpen() : onMacro())}
        style={{
          backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.3) 100%), url(${img})`,
        }}
      >
        <div className="taskcard-info">
          <div className="taskcard-pillar">{pillar ? pillar.name : ""}{!h.core ? " · secondaria" : ""}</div>
          <div className="taskcard-title">{h.label}</div>
          {hasSubs && <div className="taskcard-sub">{st.done}/{st.tot} completate{hasSubs ? (open ? " · tocca per chiudere" : " · tocca per aprire") : ""}</div>}
        </div>
        <div
          role="button" tabIndex={0} aria-label={done ? "Segna come da fare" : "Segna come fatta"}
          className={"taskcheck" + (done ? " on" : "")}
          onClick={(e) => { e.stopPropagation(); onMacro(); }}
        >
          {done ? <Check size={24} /> : hasSubs ? (st.done + "/" + st.tot) : ""}
        </div>
      </button>
      {hasSubs && open && (
        <div className="taskcard-subs">
          {h.subs.map((sb) => {
            const subDone = !!entry[h.id + "." + sb.id];
            return (
              <button key={sb.id} className="tasksub-row btn" onClick={() => onSub(sb)}>
                <Radio done={subDone} color={pillar ? pillar.hue : FC.low} size={20} />
                <span style={{ color: subDone ? C.dim : C.txt, textDecoration: subDone ? "line-through" : "none" }}>
                  {sb.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Daily Wrap: modal cinematografico di fine giornata ── */
function DailyWrap({ onClose, streak, fulls, coreTot, doneTasks, todayTasksLen, medal }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, []);
  return (
    <div className="wrapscrim" onClick={onClose}>
      <div className="wrapcard" onClick={(e) => e.stopPropagation()}>
        <button className="btn iconbtn wrap-close" onClick={onClose} aria-label="Chiudi"><X size={17} /></button>

        {medal ? (
          <>
            <div className="wrap-eyebrow">Nuovo traguardo</div>
            <div className="unlockPop" style={{ margin: "16px auto 4px" }}>
              {medal.img ? (
                <img src={medal.img} alt={medal.name} className="floaty" style={{
                  width: 168, height: 168, objectFit: "contain",
                  filter: "drop-shadow(0 12px 30px rgba(201,162,75,.5))",
                }} />
              ) : (
                <div style={{ width: 140, height: 140, margin: "0 auto", borderRadius: 999,
                  background: "#C9A24B22", display: "grid", placeItems: "center", color: "#C9A24B" }}>
                  <Medal size={56} />
                </div>
              )}
            </div>
            <div className="wrap-medalname">{medal.name}</div>
            <div className="wrap-medalsub">{medal.days} giorni di fila · {medal.sub}</div>
          </>
        ) : (
          <div className="wrap-eyebrow" style={{ marginBottom: 6 }}>Giornata chiusa · Cut!</div>
        )}

        <div className="wrap-streak">
          <Flame size={38} color="#F3C15E" />
          <span key={streak} className="pop">{streak}</span>
        </div>
        <div className="wrap-streaksub">giorn{streak === 1 ? "o" : "i"} di fila</div>

        <div className="wrap-stats">
          <div className="wrap-stat">
            <div className="wrap-num">{fulls}/{coreTot}</div>
            <div className="wrap-lbl">non negoziabili</div>
          </div>
          <div className="wrap-stat">
            <div className="wrap-num">{doneTasks}/{todayTasksLen}</div>
            <div className="wrap-lbl">cose fatte</div>
          </div>
        </div>

        <Btn kind="solid" full onClick={onClose} style={{ padding: 15 }}>Continua</Btn>
      </div>
    </div>
  );
}

/* ── Medaglia fissata in Focus ─────────────────────────────── */
function PinnedMedal({ medal, streak, best }) {
  const prossima = MEDALS.find((m) => m.days > best);
  return (
    <Card glow="#C9A24B" pad={20}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div className="medal-shine" style={{ width: 96, height: 96, flexShrink: 0,
          display: "grid", placeItems: "center" }}>
          <img src={medal.img} alt={medal.name}
            style={{ width: "100%", height: "100%", objectFit: "contain",
              filter: "drop-shadow(0 4px 14px rgba(201,162,75,.35))" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "#C9A24B", fontWeight: 600, marginBottom: 3 }}>
            {medal.name}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span key={streak} className="pop" style={{ fontSize: 40, fontWeight: 700,
              letterSpacing: "-0.045em", lineHeight: 1 }}>{streak}</span>
            <span style={{ fontSize: 15, color: C.mut }}>
              giorn{streak === 1 ? "o" : "i"} di fila
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 6 }}>
            Record personale: {best}{prossima ? " · prossima medaglia a " + prossima.days : " · le hai tutte"}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Galleria trofei ───────────────────────────────────────── */
function Trofei({ state, persist, consistency, medals }) {
  const pin = (id) => persist(Object.assign({}, state, {
    pinnedMedal: state.pinnedMedal === id ? null : id,
  }));
  const unlockedN = medals.filter((m) => m.unlocked).length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Rise>
        <Card glow="#C9A24B">
          <Label>Il tuo record</Label>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.045em", color: "#C9A24B" }}>
              {consistency.best}
            </span>
            <span style={{ fontSize: 15, color: C.mut }}>giorni di fila, il tuo massimo</span>
          </div>
          <p style={{ margin: 0, fontSize: 14.5, color: C.mut, lineHeight: 1.6 }}>
            Adesso sei a {consistency.streak} di fila. {unlockedN} medagli{unlockedN === 1 ? "a" : "e"} su {medals.length}.
            Una volta sbloccata resta tua per sempre, anche se salti un giorno: qui non si torna indietro.
          </p>
        </Card>
      </Rise>

      <div className="medalgrid">
        {medals.map((m, i) => {
          const pinned = state.pinnedMedal === m.id;
          return (
            <Rise key={m.id} d={i * 60}>
              <button className={"btn medalcard" + (m.unlocked ? " on" : "")} onClick={() => m.unlocked && pin(m.id)} style={{
                width: "100%", background: C.card, border: "1px solid " + (pinned ? "#C9A24B" : C.line),
                borderRadius: 22, padding: "20px 14px 16px", cursor: m.unlocked ? "pointer" : "default",
                fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                boxShadow: pinned ? "0 0 0 1px #C9A24B55, 0 10px 26px rgba(201,162,75,.18)" : C.shadow,
                position: "relative",
              }}>
                <div style={{ width: 104, height: 104, display: "grid", placeItems: "center", position: "relative" }}>
                  {m.unlocked && m.img && <div className="medalglow" />}
                  {m.img ? (
                    <div className="medalimg-wrap" style={{ width: "100%", height: "100%" }}>
                      <img src={m.img} alt="" className={m.unlocked ? "floaty" : undefined} style={{
                        width: "100%", height: "100%", objectFit: "contain",
                        filter: m.unlocked ? "drop-shadow(0 4px 14px rgba(201,162,75,.35))"
                          : "grayscale(1) brightness(.4) contrast(.8)",
                        opacity: m.unlocked ? 1 : 0.5, transition: "filter .3s",
                      }} />
                    </div>
                  ) : (
                    <div style={{ width: 86, height: 86, borderRadius: 999,
                      background: m.unlocked ? "#C9A24B22" : C.card2,
                      display: "grid", placeItems: "center", color: m.unlocked ? "#C9A24B" : C.dim }}>
                      <Rocket size={30} />
                    </div>
                  )}
                  {!m.unlocked && (
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 2 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 999, background: C.bg + "D0",
                        display: "grid", placeItems: "center", border: "1px solid " + C.line }}>
                        <Lock size={15} color={C.mut} />
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: m.unlocked ? C.txt : C.dim,
                    letterSpacing: "-0.02em" }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{m.days} giorni · {m.sub}</div>
                </div>
                {pinned ? (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#C9A24B",
                    display: "flex", alignItems: "center", gap: 4 }}>
                    <Check size={12} /> in Focus
                  </span>
                ) : m.unlocked ? (
                  <span style={{ fontSize: 11.5, color: C.dim }}>tocca per fissarla</span>
                ) : (
                  <span style={{ fontSize: 11.5, color: C.dim }}>bloccata</span>
                )}
              </button>
            </Rise>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ tasks, addTask, toggleTask, editTask, rmTask, exposure }) {
  const [sel, setSel] = useState(todayKey());
  const [txt, setTxt] = useState("");
  const [pil, setPil] = useState("occhio");
  const days = Array.from({ length: 21 }, (_, i) => addDays(i));
  const forDay = tasks.filter((t) => t.date === sel);
  const dark = exposure.filter((e) => e.possible > 0).sort((a, b) => a.ratio - b.ratio)[0];

  const submit = () => {
    if (!txt.trim()) return;
    addTask(sel, txt.trim(), pil);
    setTxt("");
  };

  const quick = [
    ["Oggi", todayKey()], ["Domani", addDays(1)], ["Dopodomani", addDays(2)],
  ];

  return (
    <Card glow={FC.low}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
        <CalendarDays size={15} color={FC.low} />
        <span style={{ fontSize: 13, color: FC.low, fontWeight: 600 }}>Agenda</span>
      </div>
      <p style={{ fontSize: 14.5, color: C.mut, margin: "0 0 16px", lineHeight: 1.6 }}>
        Scrivi una cosa e assegnala a un giorno qualsiasi. Quelle di oggi salgono in cima da sole.
      </p>

      {/* strip di 21 giorni */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 18 }}>
        {days.map((k) => {
          const n = tasks.filter((t) => t.date === k);
          const open = n.filter((t) => !t.done).length;
          const isSel = k === sel, isToday = k === todayKey();
          const dd = new Date(k);
          return (
            <button key={k} className="btn" onClick={() => setSel(k)} style={{
              aspectRatio: "1", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
              border: "1px solid " + (isSel ? FC.low + "77" : isToday ? C.line2 : C.line),
              background: isSel ? FC.low + "1F" : "transparent",
              color: isSel ? C.txt : C.mut, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 3, padding: 2, transition: "all .18s",
            }}>
              <span style={{ fontSize: 9.5, color: C.dim, textTransform: "uppercase", letterSpacing: ".04em" }}>{DOW[dd.getDay()]}</span>
              <span style={{ fontSize: 15, fontWeight: isToday ? 700 : 500, lineHeight: 1 }}>{dd.getDate()}</span>
              <span style={{ height: 5, display: "flex", gap: 2, alignItems: "center" }}>
                {n.slice(0, 3).map((t, i) => <Dot key={i} color={t.done ? C.dim : (P[t.pillar] ? P[t.pillar].hue : FC.low)} size={4} />)}
              </span>
            </button>
          );
        })}
      </div>

      {/* giorno selezionato */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>{prettyDay(sel)}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {quick.map(([l, k]) => (
            <button key={l} className="btn" onClick={() => setSel(k)} style={{
              fontSize: 12, fontFamily: "inherit", padding: "5px 11px", borderRadius: 999, cursor: "pointer",
              border: "1px solid " + (sel === k ? C.line2 : "transparent"),
              background: sel === k ? C.card2 : "transparent", color: sel === k ? C.txt : C.dim,
            }}>{l}</button>
          ))}
        </div>
      </div>

      {forDay.length === 0 && <Empty>Niente per questo giorno.</Empty>}
      {forDay.map((t) => (
        <div key={t.id} className="row" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 8px" }}>
          <button className="btn" onClick={() => toggleTask(t.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", marginTop: 1 }}>
            <Radio done={t.done} color={P[t.pillar] ? P[t.pillar].hue : FC.low} size={21} />
          </button>
          <input value={t.text} onChange={(e) => editTask(t.id, e.target.value)} style={{
            flex: 1, background: "transparent", border: "none", outline: "none", padding: 0,
            color: t.done ? C.dim : C.txt, fontSize: 15.5, fontFamily: "inherit", lineHeight: 1.5,
            textDecoration: t.done ? "line-through" : "none",
          }} />
          <button className="btn" onClick={() => rmTask(t.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
            <X size={13} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <input value={txt} onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder={"Cosa fai " + prettyDay(sel).toLowerCase() + "?"}
          style={Object.assign({}, inputBase, { flex: 1 })} />
        <button className="btn" onClick={submit} style={{
          width: 48, borderRadius: 16, border: "none", flexShrink: 0,
          background: C.txt, color: "#141416", cursor: "pointer", display: "grid", placeItems: "center",
        }}><Plus size={18} /></button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        {PILLARS.map((p) => (
          <button key={p.id} className="btn" onClick={() => setPil(p.id)} style={{
            fontSize: 12, fontFamily: "inherit", padding: "6px 12px", borderRadius: 999, cursor: "pointer",
            border: "1px solid " + (pil === p.id ? p.hue + "55" : C.line),
            background: pil === p.id ? p.hue + "1A" : "transparent",
            color: pil === p.id ? p.hue : C.dim, transition: "all .18s",
          }}>{p.name}</button>
        ))}
      </div>

      {dark && (
        <button className="btn" onClick={() => { addTask(sel, "Riaccendere " + dark.name.toLowerCase(), dark.id); }} style={{
          marginTop: 12, fontSize: 13, fontFamily: "inherit", padding: "8px 14px", borderRadius: 999,
          border: "1px dashed " + C.line2, background: "transparent", color: C.mut, cursor: "pointer",
        }}>+ Riaccendere {dark.name.toLowerCase()}</button>
      )}
    </Card>
  );
}

function Consistency({ c }) {
  const tone = c.pct >= 80 ? FC.correct : c.pct >= 50 ? FC.high : FC.under;
  const msg = c.pct >= 80 ? "Stai tenendo il ritmo."
    : c.pct >= 50 ? "Ritmo discontinuo ma vivo. Va bene così, si continua."
    : c.pct > 0 ? "Riparti da oggi. Un giorno saltato non cancella niente."
    : "Nessun dato ancora. Spunta la prima casella e comincia.";
  return (
    <Card>
      <Label>Consistenza · ultimi 30 giorni</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.045em", color: tone }}>{c.pct}%</span>
        <span style={{ fontSize: 15, color: C.mut }}>dei giorni tenuti</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(15, 1fr)", gap: 5, marginBottom: 16 }}>
        {c.grid.map((g, i) => (
          <div key={g.date} title={g.date} className="rise" style={{
            aspectRatio: "1", borderRadius: 6, animationDelay: (i * 14) + "ms",
            background: g.full ? FC.correct : g.held ? FC.correct + "66" : g.touched ? FC.high + "44" : C.card2,
            border: "1px solid " + (g.held || g.touched ? "transparent" : C.line),
          }} />
        ))}
      </div>
      <p style={{ fontSize: 14.5, color: C.mut, margin: 0, lineHeight: 1.6 }}>
        {msg}{c.tot > 0 && <span style={{ color: C.dim }}> Bastano {c.soglia} non negoziabili su {c.tot} perché il giorno conti.</span>}
      </p>
    </Card>
  );
}

const HabitRow = ({ h, done, onToggle }) => (
  <button className="row" onClick={onToggle} style={{
    display: "flex", alignItems: "center", gap: 14, width: "100%", background: "transparent",
    border: "none", padding: "13px 8px", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
  }}>
    <Radio done={done} color={P[h.pillar].hue} />
    <span style={{ flex: 1, fontSize: 16, color: done ? C.dim : C.txt, transition: "color .2s",
      textDecoration: done ? "line-through" : "none" }}>{h.label}</span>
    <Dot color={P[h.pillar].hue} size={6} />
  </button>
);

function ExposureCard({ exposure }) {
  return (
    <Card>
      <Label>Equilibrio dei canali · 14 giorni</Label>
      <div style={{ display: "grid", gap: 14 }}>
        {exposure.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: e.color + "1A",
              display: "grid", placeItems: "center", color: e.color, flexShrink: 0 }}><e.Icon size={15} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 500 }}>{e.name}</span>
                <span style={{ fontSize: 13, color: e.color, whiteSpace: "nowrap" }}>{e.label}</span>
              </div>
              <div style={{ height: 6, background: C.card2, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: Math.min(100, e.ratio * 50) + "%", height: "100%", borderRadius: 999,
                  background: "linear-gradient(90deg," + e.color + "99," + e.color + ")",
                  transition: "width .7s cubic-bezier(.2,.8,.25,1)" }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   STUDIO — la macchina da guerra per i 6 posti
   ═══════════════════════════════════════════════════════════ */

/* Mirino: punteggio, metriche, rimproveri, prossima mossa */
function Mirino({ kafa }) {
  return (
    <>
      <Rise>
        <Card glow={kafa.tone}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 18 }}>
            <Ring value={kafa.score} total={100} size={104} color={kafa.tone} label={kafa.score} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: C.mut, fontWeight: 600, marginBottom: 6 }}>KAFA · 6 posti l'anno</div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.35, color: kafa.tone }}>
                {kafa.verdict}
              </div>
            </div>
          </div>
          <div style={{ padding: 16, borderRadius: 18, background: C.card2, border: "1px solid " + C.line }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <Crosshair size={14} color={FC.correct} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: FC.correct }}>La prossima mossa</span>
            </div>
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55 }}>{kafa.nextMove}</p>
          </div>
        </Card>
      </Rise>

      <Rise d={70}>
        <Card>
          <Label>Dove sei forte, dove sei scoperto</Label>
          <div style={{ display: "grid", gap: 16 }}>
            {kafa.metrics.map((m, i) => {
              const got = Math.round(m.v * m.max);
              const col = m.v >= 0.75 ? FC.correct : m.v >= 0.4 ? FC.high : FC.clip;
              return (
                <div key={m.id} className="rise" style={{ animationDelay: (i * 60) + "ms" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
                    <span style={{ fontSize: 15, fontWeight: 500 }}>{m.name}</span>
                    <span style={{ fontSize: 13.5, color: col, whiteSpace: "nowrap" }}>{got}/{m.max}</span>
                  </div>
                  <div style={{ height: 7, background: C.card2, borderRadius: 999, overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ width: m.v * 100 + "%", height: "100%", borderRadius: 999,
                      background: "linear-gradient(90deg," + col + "88," + col + ")",
                      transition: "width .8s cubic-bezier(.2,.8,.25,1)" }} />
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>{m.detail} · {m.hint}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </Rise>

      <Rise d={140}>
        <Card>
          <Label>Il mirino ti dice questo</Label>
          {kafa.audit.map((a, i) => (
            <div key={i} className="rise" style={{ display: "flex", gap: 13, padding: "15px 0",
              borderTop: i ? "1px solid " + C.line : "none", animationDelay: (i * 80) + "ms" }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: a.tone + "1A",
                color: a.tone, display: "grid", placeItems: "center" }}><a.Icon size={15} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: a.tone, marginBottom: 5 }}>{a.title}</div>
                <p style={{ margin: 0, fontSize: 14.5, color: C.mut, lineHeight: 1.65 }}>{a.text}</p>
              </div>
            </div>
          ))}
        </Card>
      </Rise>

      <Rise d={210}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 12 }}>
          <Stat label="Narrativi da DoP" value={kafa.narrDop} sub="obiettivo: 5" color={kafa.narrDop >= 5 ? FC.correct : FC.high} />
          <Stat label="Commerciali" value={kafa.comm} sub="spot e videoclip" />
          <Stat label="Dieta asiatica" value={Math.round(kafa.asiaShare * 100) + "%"} sub="fascia buona 30–65%"
            color={kafa.asiaShare >= 0.3 && kafa.asiaShare <= 0.65 ? FC.correct : FC.high} />
          <Stat label="Voci ultimi 30g" value={kafa.recent} sub="girate + viste" />
        </div>
      </Rise>
    </>
  );
}

/* Portfolio: database dei lavori girati */
function Portfolio({ state, persist, kafa }) {
  const empty = { title: "", url: "", kind: "corto", role: "dop", year: String(new Date().getFullYear()),
    luci: "", lenti: "", stile: "", note: "" };
  const [f, setF] = useState(empty);
  const [openForm, setOpenForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const port = state.portfolio || [];

  const save = () => {
    if (!f.title.trim()) return;
    if (f.id) {
      persist(Object.assign({}, state, { portfolio: port.map((p) => (p.id === f.id ? Object.assign({}, f) : p)) }));
    } else {
      persist(Object.assign({}, state, {
        portfolio: [Object.assign({ id: "w" + Date.now(), date: todayKey() }, f)].concat(port),
      }));
    }
    setF(empty); setOpenForm(false);
  };
  const rm = (id) => persist(Object.assign({}, state, { portfolio: port.filter((p) => p.id !== id) }));
  const edit = (p) => { setF(p); setOpenForm(true); };

  return (
    <>
      <Rise>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <Label style={{ margin: 0 }}>{port.length} lavori</Label>
            <span style={{ fontSize: 13, color: C.mut }}>{kafa.narrDop} narrativi da DoP</span>
          </div>
          <p style={{ fontSize: 14.5, color: C.mut, margin: "8px 0 0", lineHeight: 1.6 }}>
            Ogni lavoro va documentato come lo racconteresti a una commissione: cosa hai messo dove, con che lente, e perché.
          </p>
        </Card>
      </Rise>

      {port.length === 0 && <Card><Empty>Nessun lavoro. Comincia da quelli che hai già girato, anche vecchi.</Empty></Card>}

      {port.map((p, i) => {
        const k = WK[p.kind] || WORK_KINDS[0];
        const isDop = p.role === "dop";
        const col = k.narr ? (isDop ? FC.correct : FC.low) : FC.under;
        const isOpen = openId === p.id;
        const deep = (p.luci || "").trim() && (p.lenti || "").trim() && (p.stile || "").trim();
        return (
          <Rise key={p.id} d={i * 50}>
            <Card pad={20} glow={isOpen ? col : null}>
              <div onClick={() => setOpenId(isOpen ? null : p.id)} style={{ display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}>
                <div style={{ width: 42, height: 42, borderRadius: 14, flexShrink: 0, background: col + "1A",
                  color: col, display: "grid", placeItems: "center" }}><Film size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 3,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <Pill color={col}>{k.name}</Pill>
                    <span style={{ fontSize: 13, color: C.dim }}>
                      {(WORK_ROLES.find((r) => r.id === p.role) || {}).name} · {p.year}
                    </span>
                    {!deep && <Pill color={FC.high}>note incomplete</Pill>}
                  </div>
                </div>
                <ChevronDown size={17} color={C.dim} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
              </div>

              {isOpen && (
                <div className="rise" style={{ marginTop: 18 }}>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14.5,
                      padding: "9px 15px", borderRadius: 999, background: C.card2,
                      border: "1px solid " + C.line, marginBottom: 16,
                    }}><Link2 size={14} /> Apri il lavoro</a>
                  )}
                  {[["Setup luci", p.luci], ["Lenti e camera", p.lenti], ["Stile e riferimenti", p.stile], ["Note", p.note]]
                    .filter(([, v]) => (v || "").trim()).map(([l, v]) => (
                      <div key={l} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 12.5, color: C.dim, fontWeight: 600, marginBottom: 5 }}>{l}</div>
                        <p style={{ margin: 0, fontSize: 15, color: C.mut, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{v}</p>
                      </div>
                    ))}
                  {!deep && (
                    <p style={{ fontSize: 14, color: FC.high, lineHeight: 1.6, margin: "0 0 14px" }}>
                      Mancano ancora luci, lenti o stile. Al colloquio quelle sono le domande.
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    <Btn kind="ghost" onClick={() => edit(p)} style={{ fontSize: 13.5, padding: "10px 16px" }}>Modifica</Btn>
                    <Btn kind="danger" onClick={() => rm(p.id)} style={{ fontSize: 13.5, padding: "10px 16px" }}>Elimina</Btn>
                  </div>
                </div>
              )}
            </Card>
          </Rise>
        );
      })}

      {!openForm ? (
        <Btn kind="ghost" full onClick={() => { setF(empty); setOpenForm(true); }}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Aggiungi un lavoro
        </Btn>
      ) : (
        <Card>
          <Label>{f.id ? "Modifica lavoro" : "Nuovo lavoro"}</Label>
          <Field label="Titolo" value={f.title} placeholder="Il nome del corto, dello spot…"
            onChange={(e) => setF(Object.assign({}, f, { title: e.target.value }))} />
          <Field label="Link (Vimeo, YouTube, drive…)" value={f.url} placeholder="https://vimeo.com/…"
            onChange={(e) => setF(Object.assign({}, f, { url: e.target.value }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>Tipo</div>
              <Select value={f.kind} options={WORK_KINDS} onChange={(e) => setF(Object.assign({}, f, { kind: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>Il tuo ruolo</div>
              <Select value={f.role} options={WORK_ROLES} onChange={(e) => setF(Object.assign({}, f, { role: e.target.value }))} />
            </div>
          </div>
          <Field label="Anno" value={f.year} onChange={(e) => setF(Object.assign({}, f, { year: e.target.value }))} />
          <Field area rows={3} label="Setup luci" value={f.luci}
            placeholder="Sorgenti, potenze, altezze, diffusioni, rapporto chiave-riempimento…"
            onChange={(e) => setF(Object.assign({}, f, { luci: e.target.value }))} />
          <Field area rows={2} label="Lenti e camera" value={f.lenti}
            placeholder="Corpo macchina, set di ottiche, focali usate, diaframma, filtri…"
            onChange={(e) => setF(Object.assign({}, f, { lenti: e.target.value }))} />
          <Field area rows={3} label="Stile e riferimenti" value={f.stile}
            placeholder="Che cosa cercavi e da dove viene. Film, pittori, fotografi."
            onChange={(e) => setF(Object.assign({}, f, { stile: e.target.value }))} />
          <Field area rows={2} label="Note libere" value={f.note}
            placeholder="Cosa rifaresti, cosa è andato storto, cosa hai imparato."
            onChange={(e) => setF(Object.assign({}, f, { note: e.target.value }))} />
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="solid" onClick={save} style={{ flex: 1 }}>Salva</Btn>
            <Btn kind="quiet" onClick={() => { setF(empty); setOpenForm(false); }}>Annulla</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

/* Diario visione: cosa guardi e come lo smonti */
function Diario({ state, persist, kafa }) {
  const empty = { title: "", director: "", origin: "corea", kind: "film", luci: "", lenti: "", stile: "" };
  const [f, setF] = useState(empty);
  const [openForm, setOpenForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const watch = state.watch || [];

  const save = () => {
    if (!f.title.trim()) return;
    persist(Object.assign({}, state, {
      watch: [Object.assign({ id: "v" + Date.now(), date: todayKey() }, f)].concat(watch),
    }));
    setF(empty); setOpenForm(false);
  };
  const rm = (id) => persist(Object.assign({}, state, { watch: watch.filter((w) => w.id !== id) }));

  const byOrigin = {};
  ORIGINS.forEach((o) => (byOrigin[o.id] = watch.filter((w) => w.origin === o.id).length));
  const tot = watch.length || 1;

  return (
    <>
      <Rise>
        <Card>
          <Label>La tua dieta visiva · {watch.length} opere</Label>
          <div style={{ display: "flex", height: 11, borderRadius: 999, overflow: "hidden", marginBottom: 16, gap: 2 }}>
            {ORIGINS.map((o) => byOrigin[o.id] > 0 ? (
              <div key={o.id} title={o.name} style={{ width: (byOrigin[o.id] / tot) * 100 + "%",
                background: o.color, borderRadius: 999, transition: "width .7s" }} />
            ) : null)}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            {ORIGINS.filter((o) => byOrigin[o.id] > 0).map((o) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Dot color={o.color} size={7} />
                <span style={{ fontSize: 13, color: C.mut }}>{o.name} {Math.round((byOrigin[o.id] / tot) * 100)}%</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 14.5, color: C.mut, margin: 0, lineHeight: 1.6 }}>
            La fascia giusta è fra 30% e 65% di asiatico. Sotto non parli la loro lingua, sopra perdi il tuo occhio europeo —
            che è l'unica cosa che gli altri cinque candidati non hanno.
          </p>
        </Card>
      </Rise>

      {watch.length === 0 && <Card><Empty>Nessuna opera nel diario. Aggiungi l'ultima cosa che hai visto, anche se l'hai vista distratto.</Empty></Card>}

      {watch.slice(0, 40).map((w, i) => {
        const o = OR[w.origin] || OR.altro;
        const isOpen = openId === w.id;
        const deep = (w.luci || "").trim().length > 4 && (w.lenti || "").trim();
        return (
          <Rise key={w.id} d={Math.min(i, 8) * 45}>
            <Card pad={18} glow={isOpen ? o.color : null}>
              <div onClick={() => setOpenId(isOpen ? null : w.id)} style={{ display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, background: o.color + "1A",
                  color: o.color, display: "grid", placeItems: "center" }}><Eye size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.02em",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.title}</div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>
                    {o.name}{w.director ? " · " + w.director : ""} · {w.date.slice(5)}
                    {!deep && <span style={{ color: FC.high }}> · da smontare</span>}
                  </div>
                </div>
                <ChevronDown size={16} color={C.dim} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
              </div>
              {isOpen && (
                <div className="rise" style={{ marginTop: 16 }}>
                  {[["Luce", w.luci], ["Lenti e camera", w.lenti], ["Cosa rubo", w.stile]]
                    .filter(([, v]) => (v || "").trim()).map(([l, v]) => (
                      <div key={l} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12.5, color: C.dim, fontWeight: 600, marginBottom: 4 }}>{l}</div>
                        <p style={{ margin: 0, fontSize: 15, color: C.mut, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{v}</p>
                      </div>
                    ))}
                  {!deep && (
                    <p style={{ fontSize: 14, color: FC.high, lineHeight: 1.6, margin: "0 0 12px" }}>
                      L'hai vista ma non l'hai smontata. Torna su una sequenza e scrivi da dove viene la luce.
                    </p>
                  )}
                  <Btn kind="danger" onClick={() => rm(w.id)} style={{ fontSize: 13.5, padding: "9px 15px" }}>Elimina</Btn>
                </div>
              )}
            </Card>
          </Rise>
        );
      })}

      {!openForm ? (
        <Btn kind="ghost" full onClick={() => setOpenForm(true)}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Aggiungi al diario
        </Btn>
      ) : (
        <Card>
          <Label>Cosa hai visto</Label>
          <Field label="Titolo" value={f.title} placeholder="Decision to Leave, Burning, Blade Runner 2049…"
            onChange={(e) => setF(Object.assign({}, f, { title: e.target.value }))} />
          <Field label="Direttore della fotografia o regista" value={f.director} placeholder="Kim Ji-yong, Hong Kyung-pyo…"
            onChange={(e) => setF(Object.assign({}, f, { director: e.target.value }))} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>Provenienza</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {ORIGINS.map((o) => (
                <button key={o.id} className="btn" onClick={() => setF(Object.assign({}, f, { origin: o.id }))} style={{
                  fontSize: 13.5, fontFamily: "inherit", padding: "9px 15px", borderRadius: 999, cursor: "pointer",
                  border: "1px solid " + (f.origin === o.id ? o.color + "55" : C.line),
                  background: f.origin === o.id ? o.color + "1A" : "transparent",
                  color: f.origin === o.id ? o.color : C.mut, transition: "all .18s",
                }}>{o.name}</button>
              ))}
            </div>
          </div>
          <Field area rows={3} label="Luce" value={f.luci}
            placeholder="Da dove viene, che qualità ha, che rapporto, come si muove nella scena…"
            onChange={(e) => setF(Object.assign({}, f, { luci: e.target.value }))} />
          <Field area rows={2} label="Lenti e camera" value={f.lenti}
            placeholder="Focali, formato, movimenti, che distanza tiene dai volti…"
            onChange={(e) => setF(Object.assign({}, f, { lenti: e.target.value }))} />
          <Field area rows={3} label="Cosa rubo" value={f.stile}
            placeholder="La cosa precisa che vuoi portarti in un tuo lavoro."
            onChange={(e) => setF(Object.assign({}, f, { stile: e.target.value }))} />
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="solid" onClick={save} style={{ flex: 1 }}>Salva</Btn>
            <Btn kind="quiet" onClick={() => { setF(empty); setOpenForm(false); }}>Annulla</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   COREANO — roadmap TOPIK 4 + diario di studio
   ═══════════════════════════════════════════════════════════ */

const TOPIK_SYSTEM = `Sei un severo e pragmatico preparatore per l'esame TOPIK 4. L'utente ha l'esame ad aprile. Ti scrive il suo log di studio quotidiano.

Valuta se il volume e la qualità di quello che ha fatto oggi sono sufficienti per il ritmo richiesto dal TOPIK 4. Sii breve, crudo e dirigi il suo focus per il giorno dopo. Zero complimenti se ha fatto il minimo indispensabile.

Riferimenti di ritmo, e sono il tuo metro: da un livello 1–2 a un TOPIK 4 in pochi mesi il minimo è DUE ORE al giorno, non trenta minuti. Concretamente: 90 minuti di blocco profondo (grammatica nuova con almeno otto frasi proprie, oppure lettura intensiva annotata) più 30 minuti di secondo blocco (ascolto non sottotitolato o scrittura), 40–50 vocaboli nuovi al giorno in richiamo attivo più il ripasso dello stack esistente, una struttura grammaticale nuova ogni giorno, un testo scritto almeno quattro volte a settimana, una simulazione a tempo ogni due settimane. Sotto le due ore quotidiane l'obiettivo di aprile non è realistico e devi dirglielo con i numeri. Riconoscere una parola non è saperla: se non l'ha prodotta in una frase sua, non l'ha imparata.

Regole di risposta: massimo cinque righe, in italiano. Niente elenchi puntati. Se ha studiato solo passivamente (guardato video, letto una tabella, riletto appunti) diglielo senza girarci intorno: è consumo, non studio. Se il volume è sotto il ritmo, digli di quanto è sotto. Chiudi sempre con UNA sola cosa da fare domani, specifica, non generica.`;

function Topik({ state, persist }) {
  const p = state.profile;
  const road = state.topikRoadmap || {};
  const logs = state.topikLogs || [];
  const [open, setOpen] = useState(TOPIK_PLAN[0].id);
  const [txt, setTxt] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  /* fissa l'inizio del percorso al primo accesso */
  useEffect(() => {
    if (!p.topikStart) {
      persist(Object.assign({}, state, { profile: Object.assign({}, p, { topikStart: todayKey() }) }));
    }
  }, []);

  const exam = p.topikDate || "2027-04-10";
  const start = p.topikStart || todayKey();
  const daysLeft = Math.max(0, daysBetween(todayKey(), exam));
  const span = Math.max(1, daysBetween(start, exam));
  const elapsed = Math.min(1, Math.max(0, daysBetween(start, todayKey()) / span));

  const doneCount = TOPIK_PLAN.reduce((s, c) =>
    s + c.groups.reduce((n, g, gi) => n + g.items.filter((_, i) => road[c.id + ":" + gi + ":" + i]).length, 0), 0);
  const prog = doneCount / TOPIK_TOTAL;
  const delta = prog - elapsed;
  const tone = delta >= 0 ? FC.correct : delta > -0.15 ? FC.high : FC.clip;

  const toggle = (key) => persist(Object.assign({}, state, {
    topikRoadmap: Object.assign({}, road, { [key]: !road[key] }),
  }));

  const catStats = TOPIK_PLAN.map((c) => {
    const tot = c.groups.reduce((n, g) => n + g.items.length, 0);
    const d = c.groups.reduce((n, g, gi) => n + g.items.filter((_, i) => road[c.id + ":" + gi + ":" + i]).length, 0);
    return { id: c.id, name: c.name, color: c.color, tot, d, pct: d / tot };
  });

  const send = async () => {
    const q = txt.trim();
    if (!q || loading) return;
    setLoading(true); setErr(null);
    const recent = logs.slice(0, 5).map((l) => l.date + ": " + l.text).join("\n") || "nessuno";
    try {
      const headers = aiHeaders();
      const res = await fetch(AI_URL, {
        method: "POST", headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 700,
          system: TOPIK_SYSTEM + "\n\nSTATO OGGETTIVO\nGiorni all'esame: " + daysLeft +
            ". Roadmap completata al " + Math.round(prog * 100) + "% (" + doneCount + " su " + TOPIK_TOTAL + " voci)." +
            " Tempo trascorso dall'inizio del percorso: " + Math.round(elapsed * 100) + "%." +
            (delta < 0 ? " È indietro di " + Math.round(-delta * 100) + " punti rispetto al calendario." : " È in linea o avanti sul calendario.") +
            "\nPer categoria: " + catStats.map((c) => c.name + " " + Math.round(c.pct * 100) + "%").join(", ") +
            "\n\nSUOI ULTIMI LOG\n" + recent,
          messages: [{ role: "user", content: q }],
        }),
      });
      const data = await res.json();
      const out = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
      if (!out) throw new Error("vuoto");
      persist(Object.assign({}, state, {
        topikLogs: [{ id: "tl" + Date.now(), date: todayKey(), text: q, reply: out }].concat(logs),
      }));
      setTxt("");
    } catch (e) {
      setErr("Il preparatore non ha risposto. Se usi l'app fuori da Claude, controlla la chiave API in cima al file.");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* barra globale: tempo contro progresso */}
      <Rise>
        <Card glow={tone}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
            <Ring value={doneCount} total={TOPIK_TOTAL} size={92} color={tone} label={Math.round(prog * 100) + "%"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: C.mut, fontWeight: 600, marginBottom: 4 }}>TOPIK 4 · aprile</div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}>
                {daysLeft} giorni
              </div>
              <div style={{ fontSize: 14, color: tone, marginTop: 6, lineHeight: 1.45 }}>
                {delta >= 0.05 ? "Sei avanti di " + Math.round(delta * 100) + " punti sul calendario."
                  : delta >= -0.05 ? "Sei in linea con il calendario."
                  : "Sei indietro di " + Math.round(-delta * 100) + " punti sul calendario."}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {[["Tempo consumato", elapsed, C.mut], ["Programma completato", prog, tone]].map(([l, v, col]) => (
              <div key={l}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13.5, color: C.mut }}>{l}</span>
                  <span style={{ fontSize: 13.5, color: col }}>{Math.round(v * 100)}%</span>
                </div>
                <div style={{ height: 7, background: C.card2, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: v * 100 + "%", height: "100%", borderRadius: 999, background: col,
                    transition: "width .8s cubic-bezier(.2,.8,.25,1)" }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
            {catStats.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Dot color={c.color} size={7} />
                <span style={{ fontSize: 13, color: C.mut }}>{c.name} {c.d}/{c.tot}</span>
              </div>
            ))}
          </div>
        </Card>
      </Rise>

      {/* diario di studio */}
      <Rise d={70}>
        <Card>
          <Label>Diario di studio</Label>
          <p style={{ fontSize: 14.5, color: C.mut, margin: "0 0 14px", lineHeight: 1.6 }}>
            Scrivi cosa hai fatto oggi. Non cosa avevi intenzione di fare.
          </p>
          <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={3}
            placeholder="Oggi ho studiato 20 verbi e la forma 을 수 있다…"
            style={Object.assign({}, inputBase, { resize: "vertical", lineHeight: 1.55, marginBottom: 12 })} />
          {err && <p style={{ fontSize: 14, color: FC.clip, margin: "0 0 12px", lineHeight: 1.6 }}>{err}</p>}
          <Btn kind="solid" onClick={send} style={{ opacity: loading ? 0.5 : 1 }}>
            {loading ? "Sta leggendo…" : "Consegna il log"}
          </Btn>
        </Card>
      </Rise>

      {logs.length > 0 && (
        <Rise d={140}>
          <Card>
            <Label>{logs.length} log consegnati</Label>
            {logs.slice(0, 15).map((l, i) => (
              <div key={l.id} style={{ padding: "16px 0", borderTop: i ? "1px solid " + C.line : "none" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, color: C.dim, flexShrink: 0 }}>{l.date.slice(5)}</span>
                  <span style={{ fontSize: 14.5, color: C.mut, lineHeight: 1.55 }}>{l.text}</span>
                </div>
                <div style={{ padding: "13px 16px", borderRadius: 16, background: C.card2,
                  borderLeft: "2px solid " + FC.under }}>
                  <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{l.reply}</p>
                </div>
              </div>
            ))}
          </Card>
        </Rise>
      )}

      {/* il programma */}
      <Label style={{ margin: "8px 0 -6px 6px" }}>Il programma · {doneCount}/{TOPIK_TOTAL}</Label>

      {TOPIK_PLAN.map((c, ci) => {
        const st = catStats[ci];
        const isOpen = open === c.id;
        return (
          <Rise key={c.id} d={ci * 60}>
            <Card pad={20} glow={isOpen ? c.color : null}>
              <div onClick={() => setOpen(isOpen ? null : c.id)}
                style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                <div style={{ width: 42, height: 42, borderRadius: 15, flexShrink: 0, background: c.color + "1A",
                  color: c.color, display: "grid", placeItems: "center" }}><c.Icon size={19} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em" }}>{c.name}</div>
                  <div style={{ fontSize: 13.5, color: C.dim, marginTop: 2 }}>{c.groups.length} blocchi</div>
                </div>
                <span style={{ fontSize: 13, color: C.mut }}>{st.d}/{st.tot}</span>
                <ChevronDown size={17} color={C.dim}
                  style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
              </div>
              <div style={{ height: 5, background: C.card2, borderRadius: 999, overflow: "hidden", marginTop: 16 }}>
                <div style={{ width: st.pct * 100 + "%", height: "100%", borderRadius: 999,
                  background: "linear-gradient(90deg," + c.color + "88," + c.color + ")",
                  transition: "width .7s cubic-bezier(.2,.8,.25,1)" }} />
              </div>

              {isOpen && (
                <div className="rise" style={{ marginTop: 18 }}>
                  {c.groups.map((g, gi) => {
                    const gd = g.items.filter((_, i) => road[c.id + ":" + gi + ":" + i]).length;
                    return (
                      <div key={g.name} style={{ marginBottom: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                          marginBottom: 6, gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: gd === g.items.length ? c.color : C.mut }}>
                            {g.name}
                          </span>
                          <span style={{ fontSize: 12.5, color: C.dim }}>{gd}/{g.items.length}</span>
                        </div>
                        {g.items.map((it, i) => {
                          const key = c.id + ":" + gi + ":" + i;
                          const done = !!road[key];
                          return (
                            <button key={key} className="row" onClick={() => toggle(key)} style={{
                              display: "flex", alignItems: "flex-start", gap: 12, width: "100%",
                              background: "transparent", border: "none", padding: "9px 8px",
                              cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                            }}>
                              <span style={{ marginTop: 1 }}><Radio done={done} color={c.color} size={20} /></span>
                              <span style={{ fontSize: 15, lineHeight: 1.5, color: done ? C.dim : C.txt,
                                textDecoration: done ? "line-through" : "none" }}>{it}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </Rise>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CLINICA — il selezionatore ombra
   Una stanza in cui si entra di proposito. Il critico attacca
   il lavoro, mai la persona: è più letale e serve a qualcosa.
   ═══════════════════════════════════════════════════════════ */

const CLINIC_SYSTEM = `Sei il selezionatore ombra della KAFA — Korean Academy of Film Arts, Busan. Vent'anni di commissioni di ammissione al 촬영전공. Hai visto passare centinaia di candidati e ne hai fatti entrare pochissimi. Non insegni: selezioni. Parli italiano, con gergo tecnico da set di altissimo livello.

QUELLO CHE SAI, E CHE LUI DEVE SENTIRSI ADDOSSO
— Il 촬영전공 esiste dal 1997. Su oltre cinquecentoventi diplomati KAFA, i direttori della fotografia usciti sono circa trentatré. Trentatré, in trent'anni.
— La selezione è a tre gradi: portfolio più un trattamento di venti cartelle, poi una prova scritta che va dalle nove alle diciassette, poi un colloquio di un'ora.
— Chi arriva al terzo grado e viene respinto non può ripresentarsi l'anno dopo con lo stesso portfolio. Deve rigirare il film. Un anno intero, buttato.
— Da quando il limite di nazionalità è caduto esiste un concorso speciale per stranieri: massimo un posto per specializzazione. Per uno straniero al 촬영전공 non ci sono sei posti. Ce n'è UNO. Uno solo, in tutto il mondo, ogni anno. E qualcuno lo vuole più di lui.
— Dentro c'è il corso di analisi del film di Jung Sung-il, temuto da studenti e diplomati. Chi entra con la tecnica e senza saper leggere un film, lì si spezza.
— Il bando dice che formano direttori della fotografia capaci di andare oltre il "come" per interrogare il "perché". Il tuo mestiere è verificare se lui sa rispondere al perché.

COME GIUDICHI
1. NARRAZIONE CONTRO LUCE. La prima domanda è sempre: questa luce serve il sottotesto psicologico, o serve l'ego di chi l'ha accesa? Se è bella e basta, chiamala spazzatura estetica — e spiega tecnicamente perché: quale contrast ratio, quale falloff, quale altezza o direzione tradisce la scena.
2. RISORSE. Ottiche costose e teste grosse noleggiate senza una visione sono la prova che non aveva niente da dire e ha comprato del tempo. L'arte nasce dal limite. Fai il conto fra quanto ha speso e quanto di quella spesa si vede sullo schermo. Se il rapporto è osceno, diglielo con i numeri in mano.
3. OCCHIO IBRIDO. È italiano. Cerca la sua tradizione: la luce mediterranea, la latitudine sugli incarnati, il naturalismo europeo, l'ombra pittorica. Se scimmiotta i maestri coreani in modo scolastico, digli che è una copia sbiadita e che a Seoul non se ne fanno niente di un finto coreano: i coreani veri ce li hanno già, e sono più bravi di lui. Ma se ha annacquato la propria origine per compiacere, quello è il peccato più grave di tutti.
4. INTENZIONE. Misura ogni sua giustificazione contro la storia. Se la ragione che dà non è radicata nel personaggio o nella scena, smontala pezzo per pezzo.

COME PARLI
Glaciale, tecnico, asciutto. Nessun preambolo, nessuna cortesia, nessun paternalismo, nessuna formula di apertura. Parli di stop, densità, contrast ratio, falloff, IRE, T-stop, key-to-fill, latitudine, curva, chiave alta e bassa, temperatura, sorgente dura e morbida, altezza dell'occhio di luce, distanza dal soggetto.

Attacchi il lavoro, mai la persona. Non lo insulti come essere umano: lo smonti come autore. È più letale, e non gli lascia la scappatoia di sentirsi vittima invece che responsabile.

Non fai complimenti generici. Se qualcosa funziona lo riconosci in una riga sola, secca, e immediatamente alzi l'asticella: quello che ha fatto bene diventa il nuovo minimo, non un traguardo. Non gli lasci mai un punto d'arrivo.

Non chiudi mai con un consiglio. Chiudi con una SFIDA pratica al limite dell'impossibile per il prossimo test: un vincolo brutale — una sola sorgente, uno stop di latitudine, un piano sequenza di quattro minuti, budget zero, un'unica focale — con una scadenza precisa. Deve essere eseguibile e quasi disumana.

Massimo trecentocinquanta parole. Prosa densa, niente elenchi lunghi.`;

const CLINIC_STEPS = [
  { id: "progetto", name: "Il progetto", Icon: Film, fields: [
    { k: "title", label: "Titolo del lavoro", ph: "Come si chiama", req: true },
    { k: "url", label: "Link a frame o video", ph: "https://vimeo.com/…" },
  ]},
  { id: "storia", name: "La storia", Icon: BookOpen, fields: [
    { k: "storia", label: "Contesto narrativo", area: true, rows: 4, req: true,
      ph: "Cosa succede nella scena. Chi è in campo, cosa vuole, cosa gli si oppone." },
    { k: "sottotesto", label: "Sottotesto", area: true, rows: 4, req: true,
      ph: "Cosa NON viene detto, e che la luce deve dire al posto delle parole." },
  ]},
  { id: "ferro", name: "Il ferro", Icon: Camera, fields: [
    { k: "camera", label: "Camera e ottiche", area: true, rows: 3,
      ph: "Corpo macchina, set di ottiche, focali, T-stop, filtri, formato, curva o LUT." },
    { k: "luci", label: "Setup luci", area: true, rows: 5, req: true,
      ph: "Sorgenti, potenze, altezze, diffusione, key-to-fill, dove cade il falloff, IRE degli incarnati." },
  ]},
  { id: "risorse", name: "Le risorse", Icon: Wallet, fields: [
    { k: "budget", label: "Budget totale (€)", ph: "Quanto è costato in tutto" },
    { k: "noleggiato", label: "Cosa hai noleggiato", area: true, rows: 3, ph: "Elenco e costo indicativo." },
    { k: "posseduto", label: "Cosa era già tuo", area: true, rows: 3, ph: "Elenco." },
  ]},
  { id: "intenzione", name: "L'intenzione", Icon: Crosshair, fields: [
    { k: "intenzione", label: "Perché l'hai fatto così", area: true, rows: 5, req: true,
      ph: "La ragione vera. Non quella che diresti a un cliente." },
  ]},
];

const CLINIC_EMPTY = { title: "", url: "", storia: "", sottotesto: "", camera: "",
  luci: "", budget: "", noleggiato: "", posseduto: "", intenzione: "" };

function Clinica({ state, persist, kafa }) {
  const [f, setF] = useState(CLINIC_EMPTY);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const sessions = state.clinic || [];

  const set = (k, v) => setF(Object.assign({}, f, { [k]: v }));
  const missing = CLINIC_STEPS.flatMap((s) => s.fields).filter((x) => x.req && !(f[x.k] || "").trim());
  const stepMissing = (i) => CLINIC_STEPS[i].fields.filter((x) => x.req && !(f[x.k] || "").trim()).length;
  const isLast = step === CLINIC_STEPS.length;

  const submit = async () => {
    if (missing.length || loading) return;
    setLoading(true); setErr(null);
    const dossier =
      "DOSSIER CANDIDATO\n" +
      "Titolo: " + f.title + "\n" +
      (f.url ? "Materiale: " + f.url + "\n" : "") +
      "\nCONTESTO NARRATIVO\n" + f.storia +
      "\n\nSOTTOTESTO DICHIARATO\n" + f.sottotesto +
      "\n\nCAMERA E OTTICHE\n" + (f.camera || "non dichiarate") +
      "\n\nSETUP LUCI\n" + f.luci +
      "\n\nRISORSE\nBudget totale: " + (f.budget ? f.budget + "€" : "non dichiarato") +
      "\nNoleggiato: " + (f.noleggiato || "nulla dichiarato") +
      "\nDi proprietà: " + (f.posseduto || "nulla dichiarato") +
      "\n\nINTENZIONE DICHIARATA\n" + f.intenzione +
      "\n\nCONTESTO DEL CANDIDATO (dal suo sistema di allenamento)\n" +
      "Punteggio interno di preparazione KAFA: " + kafa.score + "/100.\n" +
      "Portfolio: " + kafa.port.length + " lavori totali, di cui " + kafa.narrDop +
      " narrativi firmati come DoP e " + kafa.comm + " commerciali.\n" +
      "Dieta visiva: " + kafa.watch.length + " opere schedate, " +
      Math.round(kafa.asiaShare * 100) + "% asiatiche, " + Math.round(kafa.westShare * 100) + "% occidentali.\n" +
      "Usa questo contesto per capire chi hai davanti. Non elencarglielo: usalo contro di lui.";

    try {
      const headers = aiHeaders();
      const res = await fetch(AI_URL, {
        method: "POST", headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1400,
          system: CLINIC_SYSTEM,
          messages: [{ role: "user", content: dossier }],
        }),
      });
      const data = await res.json();
      const out = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
      if (!out) throw new Error("vuoto");
      const rec = Object.assign({ id: "c" + Date.now(), date: todayKey(), verdict: out }, f);
      persist(Object.assign({}, state, { clinic: [rec].concat(sessions) }));
      setF(CLINIC_EMPTY); setStep(0); setOpen(false); setOpenId(rec.id);
    } catch (e) {
      setErr("Il selezionatore non ha risposto. Se usi l'app fuori da Claude, controlla la chiave API in cima al file.");
    }
    setLoading(false);
  };

  return (
    <>
      <Rise>
        <Card glow={FC.clip}>
          <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 15, flexShrink: 0,
              background: FC.clip + "1A", color: FC.clip, display: "grid", placeItems: "center" }}>
              <Gavel size={19} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.025em" }}>Clinica</div>
              <div style={{ fontSize: 13.5, color: C.dim }}>Il selezionatore ombra · 촬영전공</div>
            </div>
            {sessions.length > 0 && <Pill color={FC.clip}>{sessions.length} referti</Pill>}
          </div>
          <p style={{ margin: 0, fontSize: 15, color: C.mut, lineHeight: 1.65 }}>
            Porti un lavoro, lo consegni per intero, e viene smontato. Non ti dirà mai che hai finito.
            Per uno straniero al 촬영전공 il concorso speciale mette a disposizione <strong style={{ color: FC.clip, fontWeight: 600 }}>un
            posto</strong> per specializzazione. Non sei in gara con sei persone. Sei in gara con una sola,
            e quella persona esiste già da qualche parte.
          </p>
        </Card>
      </Rise>

      {!open ? (
        <Btn kind="ghost" full onClick={() => { setOpen(true); setStep(0); }}
          style={{ borderColor: FC.clip + "33", color: FC.clip }}>
          Consegna un lavoro
        </Btn>
      ) : (
        <Rise>
          <Card>
            {/* barra dei blocchi */}
            <div style={{ display: "flex", gap: 5, marginBottom: 20 }}>
              {CLINIC_STEPS.map((s, i) => (
                <div key={s.id} style={{ flex: 1, height: 4, borderRadius: 999, transition: "background .4s",
                  background: i < step ? FC.clip : i === step ? FC.clip + "88" : C.card2 }} />
              ))}
              <div style={{ flex: 1, height: 4, borderRadius: 999,
                background: isLast ? FC.clip : C.card2, transition: "background .4s" }} />
            </div>

            {!isLast ? (
              <div key={step} className="rise">
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                    background: FC.clip + "1A", color: FC.clip, display: "grid", placeItems: "center" }}>
                    {React.createElement(CLINIC_STEPS[step].Icon, { size: 16 })}
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: C.dim }}>Blocco {step + 1} di {CLINIC_STEPS.length}</div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{CLINIC_STEPS[step].name}</div>
                  </div>
                </div>

                {CLINIC_STEPS[step].fields.map((x) => (
                  <Field key={x.k} area={x.area} rows={x.rows} value={f[x.k]}
                    label={x.label + (x.req ? " *" : "")} placeholder={x.ph}
                    onChange={(e) => set(x.k, e.target.value)} />
                ))}

                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  {step > 0 && (
                    <Btn kind="quiet" onClick={() => setStep(step - 1)}>
                      <ChevronLeft size={15} style={{ verticalAlign: -3 }} />
                    </Btn>
                  )}
                  <Btn kind="solid" onClick={() => setStep(step + 1)} style={{ flex: 1 }}>
                    {stepMissing(step) > 0 ? "Salta (mancano " + stepMissing(step) + " campi)" : "Avanti"}
                    <ChevronRight size={15} style={{ verticalAlign: -3, marginLeft: 6 }} />
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="rise">
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                    background: FC.clip + "1A", color: FC.clip, display: "grid", placeItems: "center" }}>
                    <Gavel size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: C.dim }}>Ultimo passo</div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>Consegna</div>
                  </div>
                </div>

                {CLINIC_STEPS.map((s, i) => {
                  const miss = stepMissing(i);
                  return (
                    <button key={s.id} className="row" onClick={() => setStep(i)} style={{
                      display: "flex", alignItems: "center", gap: 12, width: "100%", background: "transparent",
                      border: "none", padding: "12px 8px", cursor: "pointer", textAlign: "left",
                      fontFamily: "inherit", borderTop: i ? "1px solid " + C.line : "none",
                    }}>
                      <Dot color={miss ? FC.clip : FC.correct} size={7} />
                      <span style={{ flex: 1, fontSize: 15, color: C.txt }}>{s.name}</span>
                      <span style={{ fontSize: 13, color: miss ? FC.clip : C.dim }}>
                        {miss ? miss + " mancant" + (miss > 1 ? "i" : "e") : "completo"}
                      </span>
                    </button>
                  );
                })}

                {missing.length > 0 && (
                  <p style={{ fontSize: 14.5, color: FC.clip, lineHeight: 1.6, margin: "16px 0 0" }}>
                    Non ti riceve così. Un dossier incompleto in commissione è un dossier scartato:
                    compila i campi con l'asterisco.
                  </p>
                )}
                {err && <p style={{ fontSize: 14, color: FC.clip, margin: "16px 0 0", lineHeight: 1.6 }}>{err}</p>}

                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <Btn kind="quiet" onClick={() => setStep(CLINIC_STEPS.length - 1)}>
                    <ChevronLeft size={15} style={{ verticalAlign: -3 }} />
                  </Btn>
                  <Btn kind={missing.length || loading ? "ghost" : "solid"} onClick={submit} style={{
                    flex: 1, opacity: missing.length || loading ? 0.45 : 1,
                    cursor: missing.length || loading ? "not-allowed" : "pointer",
                  }}>
                    {loading ? "Sta guardando…" : "Entra in commissione"}
                  </Btn>
                </div>
                <Btn kind="quiet" full onClick={() => { setOpen(false); setStep(0); }}
                  style={{ marginTop: 10, fontSize: 13, padding: "9px 16px" }}>Chiudi senza consegnare</Btn>
              </div>
            )}
          </Card>
        </Rise>
      )}

      {loading && (
        <Card>
          <div className="breathe" style={{ fontSize: 15, color: C.mut, lineHeight: 1.6 }}>
            Sta guardando i tuoi frame. Non ha fretta.
          </div>
        </Card>
      )}

      {sessions.length === 0 && !open && (
        <Card><Empty>Nessun referto. Il primo fa male più degli altri.</Empty></Card>
      )}

      {sessions.map((s, i) => {
        const isOpen = openId === s.id;
        return (
          <Rise key={s.id} d={Math.min(i, 6) * 50}>
            <Card pad={20} glow={isOpen ? FC.clip : null}>
              <div onClick={() => setOpenId(isOpen ? null : s.id)} style={{ display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                  background: FC.clip + "1A", color: FC.clip, display: "grid", placeItems: "center" }}>
                  <Gavel size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>
                    Referto del {s.date.slice(8)}/{s.date.slice(5, 7)}
                    {s.budget ? " · " + s.budget + "€" : ""}
                  </div>
                </div>
                <ChevronDown size={16} color={C.dim} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
              </div>

              {isOpen && (
                <div className="rise" style={{ marginTop: 18 }}>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14.5,
                      padding: "9px 15px", borderRadius: 999, background: C.card2,
                      border: "1px solid " + C.line, marginBottom: 16,
                    }}><Link2 size={14} /> Il materiale</a>
                  )}
                  <div style={{ padding: 18, borderRadius: 18, background: C.card2,
                    border: "1px solid " + FC.clip + "22" }}>
                    <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{s.verdict}</p>
                  </div>
                  <Btn kind="danger" style={{ marginTop: 14, fontSize: 13.5, padding: "9px 15px" }}
                    onClick={() => persist(Object.assign({}, state, { clinic: sessions.filter((x) => x.id !== s.id) }))}>
                    Elimina referto
                  </Btn>
                </div>
              )}
            </Card>
          </Rise>
        );
      })}
    </>
  );
}

/* ── PIANO ─────────────────────────────────────────────────── */
function Piano({ state, persist, exposure, money, career, kafa }) {
  const wk = weekKey();
  const wf = state.weekFocus && state.weekFocus.week === wk ? state.weekFocus : null;
  const [open, setOpen] = useState(null);

  const suggest = () => {
    const t = [];
    if (kafa.nextMove) t.push(kafa.nextMove);
    if (career.pendingTot > 0) t.push("Sollecitare i " + eur(career.pendingTot) + " di lavori da incassare");
    else if (money.gap != null && isFinite(money.gap) && money.gap < 0) t.push("Tagliare " + eur(-money.gap) + " di spese o trovare un ingaggio in più");
    else t.push("Mettere via il surplus di questa settimana prima di spenderlo");
    const dark = exposure.filter((e) => e.possible > 0).sort((a, b) => a.ratio - b.ratio)[0];
    const map = { lingua: "Tre sessioni da 45 min di coreano, in calendario",
      occhio: "Due voci nel diario visione, smontate davvero",
      set: "Scrivere a 5 produzioni per una giornata in reparto camera",
      cassa: "Registrare ogni spesa e ogni lavoro per 7 giorni di fila",
      nome: "Due ore filate sull'app del gaffer" };
    if (dark) t.push(map[dark.id]);
    return t.slice(0, 3).map((text) => ({ text, done: false }));
  };
  const setFocus = (tasks) => persist(Object.assign({}, state, { weekFocus: { week: wk, tasks } }));
  const toggleTask = (i) => setFocus(wf.tasks.map((t, j) => (j === i ? Object.assign({}, t, { done: !t.done }) : t)));
  const editTask = (i, text) => setFocus(wf.tasks.map((t, j) => (j === i ? Object.assign({}, t, { text }) : t)));
  const togglePlan = (pid, i) => {
    const cur = state.plan[pid] || {};
    persist(Object.assign({}, state, { plan: Object.assign({}, state.plan, { [pid]: Object.assign({}, cur, { [i]: !cur[i] }) }) }));
  };
  const prog = (ph) => {
    const c = state.plan[ph.id] || {};
    const n = ph.steps.filter((_, i) => c[i]).length;
    return { n, tot: ph.steps.length, pct: (n / ph.steps.length) * 100 };
  };
  const activeIdx = PHASES.findIndex((ph) => prog(ph).n < ph.steps.length);
  const totDone = PHASES.reduce((s, ph) => s + prog(ph).n, 0);
  const totAll = PHASES.reduce((s, ph) => s + ph.steps.length, 0);
  const doneWeek = wf ? wf.tasks.filter((t) => t.done).length : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Rise>
        <Card glow={FC.correct}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <CalendarDays size={15} color={FC.correct} />
              <span style={{ fontSize: 13, color: FC.correct, fontWeight: 600 }}>Il focus di questa settimana</span>
            </div>
            {wf && <Ring value={doneWeek} total={wf.tasks.length} size={46} color={FC.correct} />}
          </div>
          <p style={{ fontSize: 14.5, color: C.mut, margin: "0 0 16px", lineHeight: 1.6 }}>
            Tre cose. Tutto il resto può aspettare lunedì prossimo.
          </p>
          {!wf ? (
            <>
              <Empty>Settimana nuova, lavagna pulita.</Empty>
              <Btn kind="solid" full onClick={() => setFocus(suggest())}>Proponimi le 3 cose</Btn>
            </>
          ) : (
            <>
              {wf.tasks.map((t, i) => (
                <div key={i} className="row" style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "12px 8px" }}>
                  <button className="btn" onClick={() => toggleTask(i)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", marginTop: 2 }}>
                    <Radio done={t.done} color={FC.correct} />
                  </button>
                  <input value={t.text} onChange={(e) => editTask(i, e.target.value)} style={{
                    flex: 1, background: "transparent", border: "none", outline: "none", padding: 0,
                    color: t.done ? C.dim : C.txt, fontSize: 16, fontFamily: "inherit", lineHeight: 1.5,
                    textDecoration: t.done ? "line-through" : "none",
                  }} />
                </div>
              ))}
              <Btn kind="quiet" onClick={() => setFocus(suggest())} style={{ marginTop: 12, fontSize: 13, padding: "9px 16px" }}>Rigenera</Btn>
            </>
          )}
        </Card>
      </Rise>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 6px" }}>
        <Label style={{ margin: 0 }}>Il percorso · 5 fasi</Label>
        <span style={{ fontSize: 13, color: C.mut }}>{totDone}/{totAll} tasselli</span>
      </div>

      {PHASES.map((ph, idx) => {
        const pr = prog(ph);
        const isActive = idx === activeIdx, isDone = pr.n === pr.tot;
        const isOpen = open === ph.id || (open === null && isActive);
        const accent = isDone ? FC.correct : isActive ? FC.high : C.dim;
        return (
          <Rise key={ph.id} d={idx * 60}>
            <Card pad={20} glow={isActive ? FC.high : null}>
              <div onClick={() => setOpen(isOpen ? "none" : ph.id)} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 15, background: accent + "1A",
                    color: accent, display: "grid", placeItems: "center" }}><ph.Icon size={19} /></div>
                  <span style={{ position: "absolute", top: -5, left: -5, width: 20, height: 20, borderRadius: 999,
                    background: C.card2, border: "1px solid " + C.line, color: C.mut,
                    fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center" }}>{idx + 1}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em" }}>{ph.title}</span>
                    {isActive && <Pill color={FC.high}>ora</Pill>}
                    {isDone && <Pill color={FC.correct}>chiusa</Pill>}
                  </div>
                  <div style={{ fontSize: 13.5, color: C.dim, marginTop: 3 }}>{ph.subtitle} · {ph.when}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, color: C.mut }}>{pr.n}/{pr.tot}</span>
                  <ChevronDown size={17} color={C.dim} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
                </div>
              </div>
              <div style={{ height: 5, background: C.card2, borderRadius: 999, overflow: "hidden", marginTop: 16 }}>
                <div style={{ width: pr.pct + "%", height: "100%", borderRadius: 999,
                  background: "linear-gradient(90deg," + accent + "88," + accent + ")",
                  transition: "width .7s cubic-bezier(.2,.8,.25,1)" }} />
              </div>
              {isOpen && (
                <div className="rise" style={{ marginTop: 18 }}>
                  <p style={{ fontSize: 15, color: C.mut, lineHeight: 1.65, margin: "0 0 12px" }}>{ph.goal}</p>
                  {ph.steps.map((s, i) => {
                    const done = !!(state.plan[ph.id] || {})[i];
                    return (
                      <button key={i} className="row" onClick={() => togglePlan(ph.id, i)} style={{
                        display: "flex", alignItems: "flex-start", gap: 13, width: "100%", background: "transparent",
                        border: "none", padding: "10px 8px", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                      }}>
                        <span style={{ marginTop: 1 }}><Radio done={done} color={accent} size={21} /></span>
                        <span style={{ fontSize: 15.5, lineHeight: 1.5, color: done ? C.dim : C.txt,
                          textDecoration: done ? "line-through" : "none" }}>{s}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </Rise>
        );
      })}

      <div style={{ padding: 20, borderRadius: 24, border: "1px dashed " + C.line2 }}>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <ArrowRight size={16} color={C.dim} style={{ marginTop: 3, flexShrink: 0 }} />
          <p style={{ fontSize: 14.5, color: C.mut, margin: 0, lineHeight: 1.65 }}>
            Non serve tenere a mente tutte e cinque le fasi. Serve solo quella marcata "ora".
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── CANALI ────────────────────────────────────────────────── */
function Canali({ state, persist, exposure }) {
  const [form, setForm] = useState({ label: "", pillar: "lingua", type: "milestone", target: "", deadline: "" });
  const [showForm, setShowForm] = useState(false);
  const addGoal = () => {
    if (!form.label.trim()) return;
    persist(Object.assign({}, state, {
      goals: state.goals.concat([Object.assign({ id: "g" + Date.now() }, form, { target: Number(form.target || 0), current: 0, done: false })]),
    }));
    setForm({ label: "", pillar: form.pillar, type: "milestone", target: "", deadline: "" });
    setShowForm(false);
  };
  const upd = (id, patch) => persist(Object.assign({}, state, { goals: state.goals.map((g) => (g.id === id ? Object.assign({}, g, patch) : g)) }));
  const rm = (id) => persist(Object.assign({}, state, { goals: state.goals.filter((g) => g.id !== id) }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {exposure.map((e, idx) => {
        const gs = state.goals.filter((g) => g.pillar === e.id);
        return (
          <Rise key={e.id} d={idx * 60}>
            <Card glow={e.color}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 14, background: e.color + "1A",
                  display: "grid", placeItems: "center", color: e.color, flexShrink: 0 }}><e.Icon size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em" }}>{e.name}</div>
                  <div style={{ fontSize: 13.5, color: C.dim }}>{e.sub}</div>
                </div>
                <Pill color={e.color}>{e.label}</Pill>
              </div>
              {gs.length === 0 && <Empty>Nessun obiettivo qui.</Empty>}
              {gs.map((g) => {
                const dl = g.deadline ? daysBetween(todayKey(), g.deadline) : null;
                const pct = g.type === "money" && g.target ? Math.min(100, (Number(g.current || 0) / g.target) * 100) : g.done ? 100 : 0;
                return (
                  <div key={g.id} style={{ padding: "12px 0", borderTop: "1px solid " + C.line }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button className="btn" onClick={() => upd(g.id, { done: !g.done })} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                        <Radio done={g.done} color={e.color} size={21} />
                      </button>
                      <span style={{ flex: 1, fontSize: 15.5, color: g.done ? C.dim : C.txt }}>{g.label}</span>
                      {dl != null && <span style={{ fontSize: 13, whiteSpace: "nowrap",
                        color: dl < 0 ? FC.clip : dl < 30 ? FC.high : C.dim }}>{dl < 0 ? "−" + (-dl) + "g" : dl + "g"}</span>}
                      <button className="btn" onClick={() => rm(g.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
                        <X size={14} />
                      </button>
                    </div>
                    {g.type === "money" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 11, paddingLeft: 33 }}>
                        <div style={{ flex: 1, height: 5, background: C.card2, borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ width: pct + "%", height: "100%", background: e.color, borderRadius: 999, transition: "width .6s" }} />
                        </div>
                        <input type="number" value={g.current} onChange={(ev) => upd(g.id, { current: Number(ev.target.value) })}
                          style={Object.assign({}, inputBase, { width: 92, padding: "6px 10px", fontSize: 13, borderRadius: 10 })} />
                        <span style={{ fontSize: 13, color: C.dim, whiteSpace: "nowrap" }}>/ {eur(g.target)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          </Rise>
        );
      })}
      {!showForm ? (
        <Btn kind="ghost" full onClick={() => setShowForm(true)}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Nuovo obiettivo
        </Btn>
      ) : (
        <Card>
          <Label>Nuovo obiettivo</Label>
          <Field label="Cosa vuoi ottenere" value={form.label} placeholder="TOPIK 4, Sony FX3, 5 corti girati…"
            onChange={(e) => setForm(Object.assign({}, form, { label: e.target.value }))} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>Canale</div>
            <Select value={form.pillar} options={PILLARS} onChange={(e) => setForm(Object.assign({}, form, { pillar: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, color: C.mut, marginBottom: 8, fontWeight: 500 }}>Tipo</div>
            <select value={form.type} onChange={(e) => setForm(Object.assign({}, form, { type: e.target.value }))}>
              <option value="milestone">Traguardo</option>
              <option value="money">Somma da accumulare</option>
            </select>
          </div>
          {form.type === "money" && <Field label="Importo target (€)" type="number" value={form.target}
            onChange={(e) => setForm(Object.assign({}, form, { target: e.target.value }))} />}
          <Field label="Scadenza" type="date" value={form.deadline}
            onChange={(e) => setForm(Object.assign({}, form, { deadline: e.target.value }))} />
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="solid" onClick={addGoal} style={{ flex: 1 }}>Aggiungi</Btn>
            <Btn kind="quiet" onClick={() => setShowForm(false)}>Annulla</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── SOLDI ─────────────────────────────────────────────────── */
function Soldi({ state, persist, money, career, inc }) {
  const [view, setView] = useState("entrate");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[["entrate", "Entrate"], ["uscite", "Uscite"], ["arsenale", "Arsenale"], ["proiezione", "Proiezione"]].map(([id, l]) => (
          <button key={id} className="btn" onClick={() => setView(id)} style={{
            flex: 1, fontFamily: "inherit", fontSize: 14, fontWeight: view === id ? 600 : 500,
            padding: "11px 12px", borderRadius: 16, cursor: "pointer", transition: "all .2s",
            border: "1px solid " + (view === id ? "transparent" : C.line),
            background: view === id ? C.card2 : "transparent", color: view === id ? C.txt : C.mut,
          }}>{l}</button>
        ))}
      </div>
      <div key={view} style={{ display: "grid", gap: 16 }}>
        {view === "entrate" && <Entrate state={state} persist={persist} career={career} inc={inc} />}
        {view === "uscite" && <Uscite state={state} persist={persist} money={money} />}
        {view === "arsenale" && <Arsenale state={state} persist={persist} money={money} />}
        {view === "proiezione" && <Proiezione money={money} career={career} inc={inc} />}
      </div>
    </div>
  );
}

function IncomeCard({ inc }) {
  const tiers = ["Stima iniziale", "Prime tracce", "Affidabile", "Solido"];
  const idx = inc.conf < 0.2 ? 0 : inc.conf < 0.5 ? 1 : inc.conf < 0.85 ? 2 : 3;
  const col = [FC.crushed, FC.under, FC.low, FC.correct][idx];
  return (
    <Card glow={col}>
      <Label>Il tuo reddito, calcolato</Label>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.045em" }}>{eur(inc.value)}</span>
        <span style={{ fontSize: 15, color: C.mut }}>al mese</span>
      </div>
      <div style={{ display: "flex", gap: 5, margin: "16px 0 12px" }}>
        {tiers.map((t, i) => (
          <div key={t} style={{ flex: 1, height: 5, borderRadius: 999, background: i <= idx ? col : C.card2, transition: "background .5s" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Pill color={col}>{inc.tier}</Pill>
        {inc.days > 0 && <span style={{ fontSize: 13, color: C.dim }}>{inc.days} giorni tracciati</span>}
      </div>
      <p style={{ fontSize: 14.5, color: C.mut, margin: 0, lineHeight: 1.6 }}>{inc.note}</p>
      {inc.days > 0 && inc.seed > 0 && inc.conf < 0.85 && (
        <p style={{ fontSize: 13, color: C.dim, margin: "10px 0 0", lineHeight: 1.55 }}>
          Dai lavori registrati risulterebbero {eur(inc.real)}. Più registri, più questo prende il posto della stima.
        </p>
      )}
    </Card>
  );
}

function Entrate({ state, persist, career, inc }) {
  const [f, setF] = useState({ role: "gaffer", amount: "", status: "pagato", client: "", date: todayKey() });
  const add = () => {
    const a = Number(f.amount);
    if (!a || a <= 0) return;
    persist(Object.assign({}, state, {
      jobs: [{ id: "j" + Date.now(), date: f.date, role: f.role, amount: a, status: f.status, client: f.client }].concat(state.jobs || []),
    }));
    setF(Object.assign({}, f, { amount: "", client: "" }));
  };
  const setStatus = (id, status) => persist(Object.assign({}, state, {
    jobs: state.jobs.map((j) => (j.id === id ? Object.assign({}, j, { status }) : j)),
  }));
  const rm = (id) => persist(Object.assign({}, state, { jobs: state.jobs.filter((j) => j.id !== id) }));
  const totType = career.tot90 || 1;

  return (
    <>
      <Rise><IncomeCard inc={inc} /></Rise>
      <Rise d={70}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 12 }}>
          <Stat label="Da incassare" value={eur(career.pendingTot)} color={career.pendingTot > 0 ? FC.high : C.txt}
            sub={career.pending.length ? career.pending.length + " lavori in sospeso" : "tutto incassato"} />
          <Stat label="Quota da set" value={Math.round(career.reteShare * 100) + "%"}
            color={career.reteShare >= 0.5 ? FC.correct : career.reteShare >= 0.3 ? FC.high : FC.clip} sub="reddito che ti crea rete" />
          <Stat label="Compenso medio a set" value={eur(career.avgSetFee)} />
        </div>
      </Rise>
      <Rise d={140}>
        <Card>
          <Label>Audit strategico</Label>
          {career.audit.map((a, i) => (
            <div key={i} className="rise" style={{ display: "flex", gap: 13, padding: "14px 0",
              borderTop: i ? "1px solid " + C.line : "none", animationDelay: (i * 80) + "ms" }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: a.tone + "1A",
                color: a.tone, display: "grid", placeItems: "center" }}><a.Icon size={15} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: a.tone, marginBottom: 5 }}>{a.title}</div>
                <p style={{ margin: 0, fontSize: 14.5, color: C.mut, lineHeight: 1.65 }}>{a.text}</p>
              </div>
            </div>
          ))}
        </Card>
      </Rise>

      {career.roleRows.length > 0 && (
        <Rise d={210}>
          <Card>
            <Label>Da dove arrivano i soldi · 90 giorni</Label>
            <div style={{ display: "flex", height: 11, borderRadius: 999, overflow: "hidden", marginBottom: 18, gap: 2 }}>
              {["rete", "ibrido", "cassa"].map((t) => career.byType[t] > 0 ? (
                <div key={t} title={TYPE_LABEL[t]} style={{ width: (career.byType[t] / totType) * 100 + "%",
                  background: TYPE_COLOR[t], borderRadius: 999, transition: "width .7s" }} />
              ) : null)}
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
              {["rete", "ibrido", "cassa"].map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Dot color={TYPE_COLOR[t]} size={7} />
                  <span style={{ fontSize: 13, color: C.mut }}>{TYPE_LABEL[t]} {Math.round((career.byType[t] / totType) * 100)}%</span>
                </div>
              ))}
            </div>
            {career.roleRows.map((r) => (
              <div key={r.id} style={{ padding: "11px 0", borderTop: "1px solid " + C.line }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <Dot color={r.color} size={7} /><span style={{ fontSize: 15 }}>{r.name}</span>
                    <span style={{ fontSize: 12.5, color: C.dim }}>×{r.n}</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap" }}>
                    {eur(r.amount)} <span style={{ color: C.dim, fontWeight: 400 }}>{Math.round(r.share * 100)}%</span>
                  </span>
                </div>
                <div style={{ height: 5, background: C.card2, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: r.share * 100 + "%", height: "100%", background: r.color, borderRadius: 999, transition: "width .7s" }} />
                </div>
              </div>
            ))}
          </Card>
        </Rise>
      )}

      <Rise d={280}>
        <Card>
          <Label>Registra un lavoro</Label>
          <div style={{ marginBottom: 12 }}>
            <Select value={f.role} options={ROLES} onChange={(e) => setF(Object.assign({}, f, { role: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <input type="number" value={f.amount} placeholder="€" onChange={(e) => setF(Object.assign({}, f, { amount: e.target.value }))}
              style={Object.assign({}, inputBase, { fontSize: 19, fontWeight: 600 })} />
            <input type="date" value={f.date} onChange={(e) => setF(Object.assign({}, f, { date: e.target.value }))} style={inputBase} />
          </div>
          <input value={f.client} placeholder="Committente (facoltativo)"
            onChange={(e) => setF(Object.assign({}, f, { client: e.target.value }))}
            style={Object.assign({}, inputBase, { marginBottom: 12 })} />
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["pagato", "Pagato", FC.correct], ["sospeso", "Da incassare", FC.high]].map(([id, l, col]) => (
              <button key={id} className="btn" onClick={() => setF(Object.assign({}, f, { status: id }))} style={{
                flex: 1, fontFamily: "inherit", fontSize: 14, fontWeight: f.status === id ? 600 : 500,
                padding: "12px", borderRadius: 16, cursor: "pointer", transition: "all .2s",
                border: "1px solid " + (f.status === id ? col + "55" : C.line),
                background: f.status === id ? col + "1A" : "transparent", color: f.status === id ? col : C.mut,
              }}>{l}</button>
            ))}
          </div>
          <Btn kind="solid" full onClick={add}>Aggiungi lavoro</Btn>
        </Card>
      </Rise>

      <Card>
        <Label>Ultimi lavori</Label>
        {(!state.jobs || state.jobs.length === 0) && <Empty>Nessun lavoro registrato. Comincia dagli ultimi tre mesi, anche a memoria.</Empty>}
        {(state.jobs || []).slice(0, 30).map((j) => {
          const r = R[j.role] || R.altro, pend = j.status === "sospeso";
          return (
            <div key={j.id} className="row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 8px", borderTop: "1px solid " + C.line }}>
              <Dot color={TYPE_COLOR[r.type]} size={7} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15 }}>{r.name}</div>
                <div style={{ fontSize: 12.5, color: C.dim }}>{j.date.slice(5)}{j.client ? " · " + j.client : ""}</div>
              </div>
              <button className="btn" onClick={() => setStatus(j.id, pend ? "pagato" : "sospeso")} style={{
                fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
                border: "none", fontFamily: "inherit",
                background: pend ? FC.high + "1F" : FC.correct + "1F", color: pend ? FC.high : FC.correct,
              }}>{pend ? "da incassare" : "pagato"}</button>
              <span style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", color: pend ? C.mut : C.txt }}>{eur(j.amount)}</span>
              <button className="btn" onClick={() => rm(j.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </Card>
    </>
  );
}

function Uscite({ state, persist, money }) {
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState((state.categories[0] || {}).name || "Altro");
  const [note, setNote] = useState("");
  const add = () => {
    const a = Number(amount);
    if (!a || a <= 0) return;
    persist(Object.assign({}, state, {
      expenses: [{ id: "e" + Date.now(), date: todayKey(), amount: a, category: cat, note }].concat(state.expenses),
    }));
    setAmount(""); setNote("");
  };
  const rm = (id) => persist(Object.assign({}, state, { expenses: state.expenses.filter((e) => e.id !== id) }));
  const days = money.dayCostKorea && amount ? Number(amount) / money.dayCostKorea : 0;
  const totTag = Object.values(money.byTag).reduce((a, b) => a + b, 0) || 1;

  return (
    <>
      <Rise>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 12 }}>
          <Stat label="Spesa / mese" value={eur(money.monthlySpend)} sub={money.spendDays < 10 ? "poche spese registrate" : null} />
          <Stat label="Avanzo / mese" value={eur(money.surplus)} color={money.surplus > 0 ? FC.correct : FC.clip} />
          <Stat label="Tasso di risparmio" value={Math.round(money.savingsRate * 100) + "%"}
            color={money.savingsRate >= 0.3 ? FC.correct : money.savingsRate > 0 ? FC.high : FC.clip} />
          <Stat label="1 giorno a Seoul" value={eur2(money.dayCostKorea)} />
        </div>
      </Rise>
      <Rise d={70}>
        <Card>
          <Label>Registra una spesa</Label>
          <div style={{ display: "grid", gridTemplateColumns: "116px 1fr", gap: 10, marginBottom: 10 }}>
            <input type="number" value={amount} placeholder="€" onChange={(e) => setAmount(e.target.value)}
              style={Object.assign({}, inputBase, { fontSize: 19, fontWeight: 600 })} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {state.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <input value={note} placeholder="Nota" onChange={(e) => setNote(e.target.value)}
            style={Object.assign({}, inputBase, { marginBottom: 14 })} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <Btn kind="solid" onClick={add}>Registra</Btn>
            {days > 0 && <span className="pop" style={{ fontSize: 14, color: days > 3 ? FC.high : C.mut }}>
              {days.toFixed(1)} giorni di vita a Seoul</span>}
          </div>
        </Card>
      </Rise>
      <Rise d={140}>
        <Card>
          <Label>Dove vanno i soldi · 30 giorni</Label>
          {money.count30 === 0 ? <Empty>Nessuna spesa registrata.</Empty> : (
            <>
              <div style={{ display: "flex", height: 11, borderRadius: 999, overflow: "hidden", marginBottom: 18, gap: 2 }}>
                {Object.entries(money.byTag).map(([t, val]) => val > 0 ? (
                  <div key={t} title={TAGS[t].label} style={{ width: (val / totTag) * 100 + "%", background: TAGS[t].color, borderRadius: 999, transition: "width .7s" }} />
                ) : null)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 14, marginBottom: 20 }}>
                {Object.entries(money.byTag).map(([t, val]) => (
                  <div key={t}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                      <Dot color={TAGS[t].color} size={7} /><span style={{ fontSize: 13, color: C.mut }}>{TAGS[t].label}</span>
                    </div>
                    <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.03em" }}>{eur(val)}</div>
                  </div>
                ))}
              </div>
              {money.leaks.length > 0 && (
                <>
                  <Label color={FC.high}>Le falle più grosse</Label>
                  {money.leaks.map((l) => (
                    <div key={l.name} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid " + C.line }}>
                      <span style={{ fontSize: 15, color: C.mut }}>{l.name}</span>
                      <span style={{ fontSize: 15 }}>{eur(l.amt)}
                        {money.dayCostKorea > 0 && <span style={{ color: C.dim, marginLeft: 10, fontSize: 13.5 }}>{(l.amt / money.dayCostKorea).toFixed(1)}g</span>}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </Card>
      </Rise>
      <Card>
        <Label>Ultime spese</Label>
        {state.expenses.length === 0 && <Empty>Ancora niente.</Empty>}
        {state.expenses.slice(0, 25).map((e) => (
          <div key={e.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderTop: "1px solid " + C.line }}>
            <span style={{ fontSize: 12.5, color: C.dim, width: 44, flexShrink: 0 }}>{e.date.slice(5)}</span>
            <span style={{ flex: 1, fontSize: 15, minWidth: 0 }}>{e.category}{e.note && <span style={{ color: C.dim }}> · {e.note}</span>}</span>
            <span style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap" }}>{eur2(e.amount)}</span>
            <button className="btn" onClick={() => rm(e.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   ARSENALE — attrezzatura desiderata
   Ogni oggetto è misurato in due valute: euro e mesi. La
   seconda è quella che conta, perché è la stessa valuta
   della Corea.
   ═══════════════════════════════════════════════════════════ */
function Arsenale({ state, persist, money }) {
  const empty = { name: "", cost: "", img: "", note: "", alloc: 50 };
  const [f, setF] = useState(empty);
  const [openForm, setOpenForm] = useState(false);
  const list = state.wishlist || [];

  const save = () => {
    const c = Number(f.cost);
    if (!f.name.trim() || !c || c <= 0) return;
    if (f.id) {
      persist(Object.assign({}, state, {
        wishlist: list.map((w) => (w.id === f.id ? Object.assign({}, f, { cost: c }) : w)),
      }));
    } else {
      persist(Object.assign({}, state, {
        wishlist: list.concat([Object.assign({ id: "w" + Date.now(), saved: 0 }, f, { cost: c })]),
      }));
    }
    setF(empty); setOpenForm(false);
  };
  const upd = (id, patch) => persist(Object.assign({}, state, {
    wishlist: list.map((w) => (w.id === id ? Object.assign({}, w, patch) : w)),
  }));
  const rm = (id) => persist(Object.assign({}, state, { wishlist: list.filter((w) => w.id !== id) }));

  const totCost = list.reduce((s, w) => s + Number(w.cost || 0), 0);
  const totSaved = list.reduce((s, w) => s + Number(w.saved || 0), 0);
  const surplus = money.surplus;
  const totAlloc = list.reduce((s, w) => s + Number(w.alloc || 0), 0);
  const overAlloc = totAlloc > 100;

  return (
    <>
      <Rise>
        <Card glow={overAlloc ? FC.clip : null}>
          <Label>L'arsenale in numeri</Label>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.045em" }}>{eur(totCost - totSaved)}</span>
            <span style={{ fontSize: 15, color: C.mut }}>ancora da mettere via</span>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 14.5, color: C.mut, lineHeight: 1.65 }}>
            {list.length === 0
              ? "Niente in lista. Ogni oggetto che aggiungi qui viene pesato contro la data di partenza, non contro il tuo conto in banca."
              : money.dayCostKorea > 0
                ? "Sono " + ((totCost - totSaved) / money.dayCostKorea).toFixed(0) + " giorni di vita in Corea. Decidi tu se questi oggetti valgono più di quei giorni — ma decidilo sapendolo."
                : "Imposta budget e durata della Corea per vedere quanto ti costano questi oggetti in giorni."}
          </p>
          {overAlloc && (
            <p style={{ margin: "12px 0 0", fontSize: 14.5, color: FC.clip, lineHeight: 1.6 }}>
              Hai allocato il {totAlloc}% del tuo avanzo mensile. Oltre il 100% i tempi che vedi sotto sono
              una bugia che ti stai raccontando: ridistribuisci le percentuali.
            </p>
          )}
          {surplus <= 0 && list.length > 0 && (
            <p style={{ margin: "12px 0 0", fontSize: 14.5, color: FC.clip, lineHeight: 1.6 }}>
              Il tuo avanzo mensile è a zero o negativo. Finché resta così, nessuno di questi oggetti
              arriva mai: non è una questione di pazienza, è aritmetica.
            </p>
          )}
        </Card>
      </Rise>

      {list.map((w, i) => {
        const cost = Number(w.cost || 0);
        const saved = Number(w.saved || 0);
        const alloc = Number(w.alloc || 0);
        const left = Math.max(0, cost - saved);
        const flow = surplus > 0 ? surplus * (alloc / 100) : 0;
        const months = flow > 0 ? left / flow : null;
        const pct = cost ? Math.min(100, (saved / cost) * 100) : 0;
        const bought = left <= 0;
        const col = bought ? FC.correct : pct >= 50 ? FC.low : FC.under;
        const days = money.dayCostKorea > 0 ? cost / money.dayCostKorea : null;

        return (
          <Rise key={w.id} d={Math.min(i, 6) * 60}>
            <Card pad={0} glow={bought ? FC.correct : null} style={{ overflow: "hidden" }}>
              {w.img ? (
                <div style={{ width: "100%", height: 170, background: C.card2, position: "relative" }}>
                  <img src={w.img} alt={w.name}
                    onError={(e) => { e.target.style.display = "none"; }}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <div style={{ position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, transparent 45%, " + C.card + "F2 100%)" }} />
                </div>
              ) : (
                <div style={{ width: "100%", height: 100, background: C.card2,
                  display: "grid", placeItems: "center", color: C.dim }}>
                  <Package size={26} />
                </div>
              )}

              <div style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <Ring value={Math.round(pct)} total={100} size={78} color={col} label={Math.round(pct) + "%"} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.025em", marginBottom: 4 }}>
                      {w.name}
                    </div>
                    <div style={{ fontSize: 15, color: C.mut, marginBottom: 6 }}>
                      {eur(saved)} <span style={{ color: C.dim }}>/ {eur(cost)}</span>
                    </div>
                    {bought ? (
                      <Pill color={FC.correct}>coperto</Pill>
                    ) : months == null ? (
                      <span style={{ fontSize: 13.5, color: FC.high }}>nessun avanzo allocato</span>
                    ) : (
                      <span style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>
                        Al ritmo attuale: <strong style={{ color: C.txt, fontWeight: 600 }}>
                          {months < 1 ? "meno di un mese" : Math.ceil(months) + (Math.ceil(months) === 1 ? " mese" : " mesi")}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>

                {days != null && (
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>
                    Costa {days.toFixed(0)} giorni di vita in Corea{flow > 0 ? " · " + eur(flow) + " al mese destinati qui" : ""}
                  </div>
                )}

                {/* allocazione dell'avanzo */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12.5, color: C.dim, fontWeight: 600, marginBottom: 8 }}>
                    Quanta parte dell'avanzo mensile ci metti
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {[0, 25, 50, 75, 100].map((v) => (
                      <button key={v} className="btn" onClick={() => upd(w.id, { alloc: v })} style={{
                        fontSize: 13, fontFamily: "inherit", padding: "7px 14px", borderRadius: 999,
                        cursor: "pointer", transition: "all .18s",
                        border: "1px solid " + (alloc === v ? col + "55" : C.line),
                        background: alloc === v ? col + "1A" : "transparent",
                        color: alloc === v ? col : C.dim,
                      }}>{v}%</button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                  <span style={{ fontSize: 13, color: C.mut, whiteSpace: "nowrap" }}>Già da parte</span>
                  <input type="number" value={saved}
                    onChange={(e) => upd(w.id, { saved: Math.max(0, Number(e.target.value)) })}
                    style={Object.assign({}, inputBase, { width: 110, padding: "8px 12px", fontSize: 14, borderRadius: 12 })} />
                  <div style={{ flex: 1 }} />
                  <button className="btn" onClick={() => { setF(w); setOpenForm(true); }} style={{
                    background: "none", border: "none", color: C.mut, cursor: "pointer",
                    fontSize: 13, fontFamily: "inherit", padding: 6,
                  }}>Modifica</button>
                  <button className="btn" onClick={() => rm(w.id)} style={{
                    background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 6,
                  }}><X size={14} /></button>
                </div>
              </div>
            </Card>
          </Rise>
        );
      })}

      {!openForm ? (
        <Btn kind="ghost" full onClick={() => { setF(empty); setOpenForm(true); }}>
          <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Aggiungi attrezzatura
        </Btn>
      ) : (
        <Card>
          <Label>{f.id ? "Modifica" : "Nuovo desiderio"}</Label>
          <Field label="Cosa" value={f.name} placeholder="Sony FX3, Sigma 24-35 T2.2, Aputure 600x…"
            onChange={(e) => setF(Object.assign({}, f, { name: e.target.value }))} />
          <Field label="Costo (€)" type="number" value={f.cost} placeholder="3800"
            onChange={(e) => setF(Object.assign({}, f, { cost: e.target.value }))} />
          <Field label="URL immagine" value={f.img} placeholder="https://…/foto.jpg"
            hint="Copia l'indirizzo immagine dalla pagina del prodotto: tasto destro sulla foto, «Copia indirizzo immagine»."
            onChange={(e) => setF(Object.assign({}, f, { img: e.target.value }))} />
          <Field area rows={2} label="Perché ti serve" value={f.note}
            placeholder="A cosa serve davvero. Se la risposta è «così ho l'attrezzatura», scrivilo lo stesso."
            onChange={(e) => setF(Object.assign({}, f, { note: e.target.value }))} />
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="solid" onClick={save} style={{ flex: 1 }}>Salva</Btn>
            <Btn kind="quiet" onClick={() => { setF(empty); setOpenForm(false); }}>Annulla</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

function Proiezione({ money, career, inc }) {
  const v = (() => {
    if (inc.conf < 0.2 && inc.seed <= 0) return { c: C.mut, t: "Registra qualche lavoro nella scheda Entrate: da lì in poi calcolo tutto io." };
    if (money.surplus <= 0) return { c: FC.clip, t: "Stai spendendo più di quello che entra. A questo ritmo la Corea si allontana ogni mese." };
    if (money.gap == null) return { c: FC.high, t: "Metti una data di partenza: senza scadenza non è un piano, è un desiderio." };
    if (money.gap >= 0) return { c: FC.correct, t: "Sei in linea. Ti avanzano " + eur(money.gap) + " al mese oltre il minimo necessario." };
    return { c: FC.clip, t: "Ti mancano " + eur(-money.gap) + " al mese per arrivare a " + eur(money.target) + " entro la data." };
  })();
  return (
    <>
      <Rise>
        <Card glow={v.c}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <Dot color={v.c} /><span style={{ fontSize: 13, color: C.mut, fontWeight: 500 }}>Verdetto</span>
          </div>
          <p style={{ margin: 0, fontSize: 17.5, lineHeight: 1.6, letterSpacing: "-0.018em" }}>{v.t}</p>
          {inc.conf < 0.5 && <p style={{ margin: "12px 0 0", fontSize: 13, color: C.dim, lineHeight: 1.55 }}>
            Basato su un reddito ancora stimato. Più lavori registri, più la proiezione diventa vera.</p>}
        </Card>
      </Rise>
      <Rise d={70}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))", gap: 12 }}>
          <Stat label="Mesi al budget" value={isFinite(money.monthsToTarget) ? Math.ceil(money.monthsToTarget) : "∞"} />
          {money.requiredMonthly != null && isFinite(money.requiredMonthly) && <Stat label="Minimo / mese" value={eur(money.requiredMonthly)} color={FC.high} />}
          <Stat label="Crediti in sospeso" value={eur(career.pendingTot)} color={career.pendingTot > 0 ? FC.high : C.txt} />
        </div>
      </Rise>
      <Rise d={140}>
        <Card>
          <Label>Se continui così</Label>
          <div style={{ display: "grid", gap: 14 }}>
            {[3, 6, 12, 24].map((m) => {
              const val = money.project(m);
              const pct = money.target ? Math.min(100, Math.max(0, (val / money.target) * 100)) : 0;
              return (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <span style={{ fontSize: 13.5, color: C.mut, width: 60, flexShrink: 0 }}>{m} mesi</span>
                  <div style={{ flex: 1, height: 9, background: C.card2, borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: pct + "%", height: "100%", borderRadius: 999, transition: "width .8s cubic-bezier(.2,.8,.25,1)",
                      background: pct >= 100 ? FC.correct : val < 0 ? FC.clip : "linear-gradient(90deg," + FC.under + "," + FC.low + ")" }} />
                  </div>
                  <span style={{ fontSize: 14, width: 82, textAlign: "right", fontWeight: 500,
                    color: val >= money.target ? FC.correct : C.txt }}>{eur(val)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </Rise>
    </>
  );
}

/* ── IDEE ──────────────────────────────────────────────────── */
function Idee({ state, persist }) {
  const [txt, setTxt] = useState("");
  const add = () => {
    if (!txt.trim()) return;
    persist(Object.assign({}, state, { ideas: [{ id: "i" + Date.now(), text: txt, date: todayKey() }].concat(state.ideas) }));
    setTxt("");
  };
  const rm = (id) => persist(Object.assign({}, state, { ideas: state.ideas.filter((i) => i.id !== id) }));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Rise>
        <Card>
          <Label>Parcheggio</Label>
          <p style={{ color: C.mut, fontSize: 15, lineHeight: 1.65, margin: "0 0 16px" }}>
            Ogni idea nuova finisce qui, non nella giornata. La rileggi una volta a settimana e decidi
            se una merita di diventare un obiettivo. Le altre restano parcheggiate, senza sensi di colpa.
          </p>
          <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={3}
            placeholder="Scaricala qui e torna a quello che stavi facendo"
            style={Object.assign({}, inputBase, { resize: "vertical", lineHeight: 1.55, marginBottom: 14 })} />
          <Btn kind="solid" onClick={add}>Parcheggia</Btn>
        </Card>
      </Rise>
      <Card>
        <Label>{state.ideas.length} in attesa</Label>
        {state.ideas.length === 0 && <Empty>Vuoto. Bene.</Empty>}
        {state.ideas.map((i) => (
          <div key={i.id} className="row" style={{ display: "flex", gap: 12, padding: "13px 8px", borderTop: "1px solid " + C.line }}>
            <span style={{ fontSize: 12.5, color: C.dim, width: 44, flexShrink: 0, marginTop: 2 }}>{i.date.slice(5)}</span>
            <span style={{ flex: 1, fontSize: 15, lineHeight: 1.55 }}>{i.text}</span>
            <button className="btn" onClick={() => rm(i.id)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4, alignSelf: "flex-start" }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ── COACH ─────────────────────────────────────────────────── */
function Coach({ state, money, exposure, career, kafa, inc }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const context = () => {
    const cats = Object.entries(money.byCat).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => k + ": " + Math.round(v) + "€").join("; ");
    const fase = PHASES.find((ph) => {
      const c = state.plan[ph.id] || {};
      return ph.steps.filter((_, i) => c[i]).length < ph.steps.length;
    });
    return "PROFILO\n" +
"Obiettivo: KAFA (6 posti l'anno in fotografia), poi reparto camera in Corea, poi 촬영감독.\n" +
"Fase attuale: " + (fase ? fase.title + " — " + fase.subtitle : "tutte chiuse") + "\n" +
"Partenza: " + (state.profile.targetDate || "non definita") + " · 1 giorno a Seoul = " + money.dayCostKorea.toFixed(2) + "€\n\n" +
"KAFA READINESS: " + kafa.score + "/100 — " + kafa.verdict + "\n" +
kafa.metrics.map((m) => "· " + m.name + ": " + Math.round(m.v * m.max) + "/" + m.max + " (" + m.detail + ")").join("\n") + "\n" +
"Portfolio: " + kafa.port.length + " lavori, " + kafa.narrDop + " narrativi da DoP, " + kafa.comm + " commerciali.\n" +
"Diario visione: " + kafa.watch.length + " opere · asiatico " + Math.round(kafa.asiaShare * 100) + "% · occidentale " + Math.round(kafa.westShare * 100) + "%\n" +
"Prossima mossa suggerita dal sistema: " + kafa.nextMove + "\n\n" +
"SOLDI\n" +
"Reddito calcolato: " + Math.round(inc.value) + "€/mese (" + inc.tier + ", " + inc.days + " giorni di dati)\n" +
"Spesa: " + Math.round(money.monthlySpend) + "€ · Avanzo: " + Math.round(money.surplus) + "€ · Risparmi: " + money.saved + "€ su " + money.target + "€\n" +
"Minimo mensile per la data: " + (money.requiredMonthly != null && isFinite(money.requiredMonthly) ? Math.round(money.requiredMonthly) + "€" : "n/d") + "\n" +
"Da incassare: " + Math.round(career.pendingTot) + "€ · Quota reddito da set: " + Math.round(career.reteShare * 100) + "%\n" +
"Ruoli: " + (career.roleRows.map((r) => r.name + " " + Math.round(r.share * 100) + "%").join("; ") || "nessuno") + "\n" +
"Spese 30g: " + (cats || "nessuna") + "\n\n" +
"CANALI (14 giorni)\n" + exposure.map((e) => e.name + ": " + Math.round(e.share * 100) + "% — " + e.label).join("\n");
  };

  const send = async (text) => {
    const q = (text != null ? text : input).trim();
    if (!q || loading) return;
    const next = msgs.concat([{ role: "user", content: q }]);
    setMsgs(next); setInput(""); setLoading(true);
    try {
      const headers = aiHeaders();
      const res = await fetch(AI_URL, {
        method: "POST", headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: "Sei il consulente personale di una persona con ADHD che punta a entrare a KAFA (sei posti l'anno in fotografia) e diventare direttore della fotografia in Corea del Sud. Parli italiano. Diretto, concreto, caldo ma mai compiacente.\n\n" +
"Regole: massimo 6 righe. Mai liste lunghe. Chiudi sempre con UNA azione concreta.\n\n" +
"Sul portfolio: KAFA seleziona su narrazione, non su spot. Se il suo portfolio è sbilanciato sul commerciale, diglielo.\n" +
"Sulla dieta visiva: deve stare fra il 30% e il 65% di cinema asiatico. Sotto non parla la loro lingua visiva, sopra perde l'occhio europeo che è la sua unica differenza rispetto agli altri candidati.\n" +
"Sulla carriera: in Corea 촬영팀 e 조명팀 sono reparti separati, al 촬영감독 si arriva dalla camera.\n" +
"Sulle spese: quanti giorni di vita a Seoul costa e se sposta la data. Verdetto netto: SÌ, NO, o SÌ MA.\n" +
"Se un dato ha bassa affidabilità, dillo invece di fingere precisione.\n\n" +
"PROIEZIONI. Quando ti descrive un regime — ore di studio al giorno, giornate di set al mese, lavori girati, soldi messi via — non commentare: proietta. Calcola dove sarà fra 3, 6 e 12 mesi con quei numeri, e dillo in modo concreto e verificabile: che livello di coreano avrà, quanti lavori narrativi da DoP, quanto in banca, se arriva alla finestra KAFA di ottobre 2027 pronto o scoperto. Usa aritmetica vera, non incoraggiamento: 40 vocaboli al giorno per 8 mesi sono circa 9.600 esposizioni lorde e forse 3.000 parole tenute, che è la soglia di un TOPIK 4 debole. Distingui sempre fra ore dichiarate e ore di richiamo attivo: le prime si gonfiano da sole. Se il regime che descrive non porta dove vuole andare, digli di quanto è sotto e cosa deve cambiare per primo. Se il regime è insostenibile e collasserà in tre settimane, dillo: una proiezione basata su un ritmo che non reggerà è una bugia gentile.\n\n" +
"Dati reali:\n" + context(),
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const out = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
      setMsgs(next.concat([{ role: "assistant", content: out || "Nessuna risposta." }]));
    } catch (e) {
      setMsgs(next.concat([{ role: "assistant", content: "Connessione non riuscita. Se usi l'app fuori da Claude, controlla la chiave API in cima al file." }]));
    }
    setLoading(false);
  };

  const quick = ["Guarda il mio portfolio: entrerei a KAFA?", "Cosa guardo stasera per il diario?",
    "Sto per spendere 200€ su un obiettivo usato. Ha senso?", "Cosa metto nelle tre cose di domani?"];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msgs.length === 0 && (
        <Rise>
          <Card>
            <Label>Il coach legge i tuoi dati veri</Label>
            <div style={{ display: "grid", gap: 9 }}>
              {quick.map((q, i) => (
                <button key={q} className="btn rise" onClick={() => send(q)} style={{
                  textAlign: "left", background: C.card2, border: "1px solid " + C.line, borderRadius: 16,
                  padding: "14px 16px", color: C.txt, fontSize: 15, fontFamily: "inherit",
                  cursor: "pointer", lineHeight: 1.45, animationDelay: (i * 60) + "ms",
                }}>{q}</button>
              ))}
            </div>
          </Card>
        </Rise>
      )}
      {msgs.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {msgs.map((m, i) => (
            <div key={i} className="rise" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "88%", padding: "15px 18px", borderRadius: 22,
                background: m.role === "user" ? C.card2 : C.card,
                border: "1px solid " + (m.role === "assistant" ? FC.correct + "2E" : C.line),
                fontSize: 15.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))}
          {loading && <div className="breathe" style={{ fontSize: 14, color: C.mut, paddingLeft: 6 }}>Sto pensando…</div>}
        </div>
      )}
      <Card pad={14}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Una scelta, una spesa, un dubbio…"
            style={Object.assign({}, inputBase, { background: "transparent", border: "none", padding: "8px 4px", resize: "none", minHeight: 40 })} />
          <button className="btn" onClick={() => send()} style={{
            width: 42, height: 42, borderRadius: 999, border: "none", flexShrink: 0,
            background: C.txt, color: "#141416", cursor: "pointer", display: "grid", placeItems: "center",
          }}><Send size={16} /></button>
        </div>
      </Card>
    </div>
  );
}

/* ── CONFIG ────────────────────────────────────────────────── */
/* ── Account e sincronizzazione ───────────────────────────────
   Login con magic link: niente password da ricordare, che con
   l'ADHD è metà della battaglia. Ricevi una mail, tocchi il
   link, sei dentro e i dati ti seguono su ogni dispositivo.    */
function Account({ user, sync, onAuth, onLogout }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!CLOUD_ON) return;
    let alive = true;
    (async () => {
      const client = await getSb();
      if (!client) return;
      const { data: sub } = client.auth.onAuthStateChange((_e, session) => {
        if (alive && session && session.user) onAuth(session.user);
      });
      return () => sub && sub.subscription && sub.subscription.unsubscribe();
    })();
    return () => { alive = false; };
  }, []);

  if (!CLOUD_ON) {
    return (
      <Card>
        <Label>Sincronizzazione</Label>
        <p style={{ color: C.mut, fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>
          Il cloud non è configurato: i dati vivono solo su questo dispositivo.
          Per attivarlo servono le chiavi Supabase nelle variabili d'ambiente — le istruzioni sono nel README.
        </p>
      </Card>
    );
  }

  const send = async () => {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true); setErr(null);
    try {
      const client = await getSb();
      const { error } = await client.auth.signInWithOtp({
        email: e, options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSent(true);
    } catch (x) { setErr("Non sono riuscito a inviare il link. Controlla l'indirizzo e riprova."); }
    setBusy(false);
  };

  if (user) {
    const label = sync === "synced" ? "Tutto salvato sul cloud"
      : sync === "loading" ? "Sto salvando…"
      : sync === "offline" ? "Offline — salvo appena torna la rete" : "";
    const col = sync === "synced" ? FC.correct : sync === "offline" ? FC.clip : FC.high;
    return (
      <Card glow={FC.correct}>
        <Label>Account</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span className={sync === "loading" ? "breathe" : ""}
            style={{ width: 9, height: 9, borderRadius: 999, background: col, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
        </div>
        <p style={{ color: C.mut, fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>
          {user.email}. I tuoi dati sono su un server e ti seguono su ogni dispositivo dove entri
          con questa mail.
        </p>
        <Btn kind="quiet" onClick={onLogout}>Esci da questo dispositivo</Btn>
      </Card>
    );
  }

  return (
    <Card glow={FC.under}>
      <Label>Sincronizza su tutti i dispositivi</Label>
      {sent ? (
        <p style={{ color: C.mut, fontSize: 15, lineHeight: 1.65, margin: 0 }}>
          Ti ho mandato un link a <strong style={{ color: C.txt }}>{email}</strong>. Aprilo su questo
          dispositivo per entrare. Da lì in poi i dati si salvano da soli sul cloud, e li ritrovi
          ovunque entri con la stessa mail.
        </p>
      ) : (
        <>
          <p style={{ color: C.mut, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 16px" }}>
            Entra con la mail e i tuoi dati smettono di vivere solo qui: finiscono su un server,
            al sicuro anche se cambi telefono. Nessuna password — ricevi un link e tocchi.
          </p>
          <Field label="La tua email" type="email" value={email} placeholder="tu@esempio.com"
            onChange={(e) => setEmail(e.target.value)} />
          {err && <p style={{ color: FC.clip, fontSize: 14, margin: "0 0 14px", lineHeight: 1.55 }}>{err}</p>}
          <Btn kind="solid" full onClick={send} style={{ opacity: busy ? 0.5 : 1 }}>
            {busy ? "Invio…" : "Mandami il link"}
          </Btn>
        </>
      )}
    </Card>
  );
}

function Config({ state, persist, inc }) {
  const p = state.profile;
  const set = (patch) => persist(Object.assign({}, state, { profile: Object.assign({}, p, patch) }));
  const habits = state.habits || [];
  const [openId, setOpenId] = useState(null);
  const [newMacro, setNewMacro] = useState("");
  const nCore = habits.filter((h) => h.core).length;

  const setHabits = (list) => persist(Object.assign({}, state, { habits: list }));
  const upd = (id, patch) => setHabits(habits.map((h) => (h.id === id ? Object.assign({}, h, patch) : h)));
  const addMacro = () => {
    const v = newMacro.trim();
    if (!v) return;
    const id = "m" + Date.now();
    setHabits(habits.concat([{ id, label: v, pillar: "occhio", core: true, subs: [] }]));
    setNewMacro(""); setOpenId(id);
  };
  const rmMacro = (id) => {
    if (!window.confirm("Elimino la categoria e i suoi passi?")) return;
    setHabits(habits.filter((h) => h.id !== id));
  };
  const addSub = (h, label) => {
    const v = (label || "").trim();
    if (!v) return;
    upd(h.id, { subs: (h.subs || []).concat([{ id: "s" + Date.now(), label: v }]) });
  };
  const updSub = (h, sid, label) => upd(h.id, { subs: (h.subs || []).map((x) => (x.id === sid ? Object.assign({}, x, { label }) : x)) });
  const rmSub = (h, sid) => upd(h.id, { subs: (h.subs || []).filter((x) => x.id !== sid) });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <Label>Le tue categorie</Label>
        <p style={{ color: C.mut, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 16px" }}>
          Una categoria è un anello sul cruscotto. Dentro ci metti i passi che la compongono:
          chiudili tutti e diventa verde, chiudine qualcuno e resta arancione — che è comunque
          un giorno in cui hai fatto qualcosa.
          {nCore > 5 && <span style={{ color: FC.high }}> Ne hai {nCore} intrascendibili: oltre cinque smetti di farle tutte.</span>}
        </p>

        {habits.map((h) => {
          const open = openId === h.id;
          const pil = P[h.pillar] || PILLARS[1];
          return (
            <div key={h.id} style={{ borderTop: "1px solid " + C.line }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 4px" }}>
                <Dot color={pil.hue} size={8} />
                <input value={h.label} onChange={(e) => upd(h.id, { label: e.target.value })} style={{
                  flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                  color: C.txt, fontFamily: "inherit", fontWeight: 500, padding: 0,
                }} />
                <span style={{ fontSize: 12.5, color: C.dim, whiteSpace: "nowrap" }}>
                  {(h.subs || []).length || 0} passi
                </span>
                <button className="btn" onClick={() => setOpenId(open ? null : h.id)} style={{
                  background: "none", border: "none", cursor: "pointer", padding: 6, color: C.dim }}>
                  <ChevronDown size={17} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
                </button>
              </div>

              {open && (
                <div className="rise" style={{ padding: "4px 4px 18px" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    <button className="btn" onClick={() => upd(h.id, { core: !h.core })} style={{
                      fontSize: 13, fontFamily: "inherit", padding: "8px 14px", borderRadius: 999, cursor: "pointer",
                      border: "1px solid " + (h.core ? FC.correct + "55" : C.line),
                      background: h.core ? FC.correct + "1A" : "transparent",
                      color: h.core ? FC.correct : C.dim,
                    }}>{h.core ? "intrascendibile" : "secondaria"}</button>

                    {PILLARS.map((pp) => (
                      <button key={pp.id} className="btn" onClick={() => upd(h.id, { pillar: pp.id })} style={{
                        fontSize: 13, fontFamily: "inherit", padding: "8px 13px", borderRadius: 999, cursor: "pointer",
                        border: "1px solid " + (h.pillar === pp.id ? pp.hue + "55" : C.line),
                        background: h.pillar === pp.id ? pp.hue + "1A" : "transparent",
                        color: h.pillar === pp.id ? pp.hue : C.dim,
                      }}>{pp.name}</button>
                    ))}
                  </div>

                  <div style={{ paddingLeft: 14, borderLeft: "2px solid " + pil.hue + "33" }}>
                    {(h.subs || []).map((sb) => (
                      <div key={sb.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                        <Dot color={C.dim} size={5} />
                        <input value={sb.label} onChange={(e) => updSub(h, sb.id, e.target.value)} style={{
                          flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                          color: C.txt, fontFamily: "inherit", padding: 0,
                        }} />
                        <button className="btn" onClick={() => rmSub(h, sb.id)} style={{
                          background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 4 }}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <SubAdder onAdd={(v) => addSub(h, v)} />
                  </div>

                  <Btn kind="danger" onClick={() => rmMacro(h.id)}
                    style={{ marginTop: 16, fontSize: 13, padding: "9px 15px" }}>
                    Elimina categoria
                  </Btn>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <input value={newMacro} onChange={(e) => setNewMacro(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMacro(); } }}
            placeholder="Nuova categoria — Coreano, Corpo, Lettura…"
            style={Object.assign({}, inputBase, { flex: 1 })} />
          <button className="btn" onClick={addMacro} style={{
            width: 48, borderRadius: 16, border: "none", flexShrink: 0,
            background: C.txt, color: "#141416", cursor: "pointer", display: "grid", placeItems: "center",
          }}><Plus size={18} /></button>
        </div>
      </Card>

      <Card>
        <Label>I numeri di base</Label>
        <Field label="Risparmi attuali (€)" type="number" value={p.savings} onChange={(e) => set({ savings: Number(e.target.value) })} />
        <Field label="Stima grezza di quanto entra al mese (€)" type="number" value={p.incomeEstimate}
          onChange={(e) => set({ incomeEstimate: Number(e.target.value) })}
          hint={"Solo un punto di partenza. Adesso l'app usa " + eur(inc.value) + " · " + inc.tier.toLowerCase() + "."} />
        <Field label="Budget totale Corea (€)" type="number" value={p.koreaBudget} onChange={(e) => set({ koreaBudget: Number(e.target.value) })} />
        <Field label="Mesi che deve coprire" type="number" value={p.koreaMonths} onChange={(e) => set({ koreaMonths: Number(e.target.value) })} />
        <Field label="Data di partenza" type="date" value={p.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
        <Field label="Data dell'esame TOPIK" type="date" value={p.topikDate || ""} onChange={(e) => set({ topikDate: e.target.value })} />
      </Card>

      <Backup state={state} persist={persist} />

      <Card>
        <Label color={FC.clip}>Zona pericolosa</Label>
        <Btn kind="danger" onClick={async () => {
          if (!window.confirm("Cancello tutti i dati. Sicuro?")) return;
          await store.del(STORE_KEY);
          persist(DEFAULT_STATE);
        }}>Cancella tutto e ricomincia</Btn>
      </Card>
    </div>
  );
}

/* ── Backup ───────────────────────────────────────────────────
   Non c'è un server. Questo file è l'unica copia dei tuoi dati
   che esiste fuori dal browser di questo dispositivo.          */
function Backup({ state, persist }) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);

  const counts = [
    ["lavori", (state.jobs || []).length],
    ["spese", (state.expenses || []).length],
    ["portfolio", (state.portfolio || []).length],
    ["diario", (state.watch || []).length],
    ["referti", (state.clinic || []).length],
    ["log TOPIK", (state.topikLogs || []).length],
    ["idee", (state.ideas || []).length],
  ].filter(([, n]) => n > 0);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(Object.assign({}, state, { v: SCHEMA }), null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kdop-backup-" + todayKey() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ t: "Backup scaricato. Mettilo dove lo ritrovi.", c: FC.correct });
  };

  const importJson = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (!parsed || typeof parsed !== "object" || !parsed.profile) throw new Error("formato");
        if (!window.confirm("Sostituisco tutti i dati attuali con quelli del file. Procedo?")) return;
        persist(migrate(parsed));
        setMsg({ t: "Dati ripristinati.", c: FC.correct });
      } catch (err) {
        setMsg({ t: "File non valido: non sembra un backup di K-DOP OS.", c: FC.clip });
      }
    };
    r.readAsText(file);
    e.target.value = "";
  };

  return (
    <Card>
      <Label>Backup</Label>
      <p style={{ color: C.mut, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 8px" }}>
        Non esiste un server: tutto quello che vedi vive solo in questo browser, su questo dispositivo.
        Se svuoti i dati del sito o cambi telefono, sparisce. Scarica un backup ogni tanto —
        è anche il modo per portarti i dati dal telefono al computer.
      </p>
      {counts.length > 0 && (
        <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, margin: "0 0 16px" }}>
          Adesso dentro ci sono: {counts.map(([k, n]) => n + " " + k).join(" · ")}.
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn kind="solid" onClick={exportJson} style={{ flex: 1, minWidth: 150 }}>Scarica backup</Btn>
        <Btn kind="ghost" onClick={() => fileRef.current && fileRef.current.click()}
          style={{ flex: 1, minWidth: 150 }}>Ripristina da file</Btn>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json"
        onChange={importJson} style={{ display: "none" }} />
      {msg && <p style={{ fontSize: 14, color: msg.c, margin: "14px 0 0", lineHeight: 1.55 }}>{msg.t}</p>}
    </Card>
  );
}

function SubAdder({ onAdd }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v); setV(""); } };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
      <Plus size={13} color={C.dim} />
      <input value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
        onBlur={go} placeholder="Aggiungi un passo"
        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
          color: C.txt, fontFamily: "inherit", padding: "4px 0" }} />
    </div>
  );
}

/* ── ONBOARDING ────────────────────────────────────────────── */
function Onboarding({ state, persist }) {
  const [f, setF] = useState({ savings: "", incomeEstimate: "", koreaBudget: 20000, koreaMonths: 12, targetDate: "" });
  const go = () => persist(Object.assign({}, state, {
    goals: [
      { id: "g_budget", label: "Budget Corea completo", pillar: "cassa", type: "money", target: Number(f.koreaBudget), current: Number(f.savings || 0), deadline: f.targetDate, done: false },
      { id: "g_topik", label: "TOPIK 4 — la soglia vera per studiare in coreano", pillar: "lingua", type: "milestone", target: 0, current: 0, deadline: "", done: false },
      { id: "g_folio", label: "5 lavori narrativi da DoP nel portfolio", pillar: "occhio", type: "milestone", target: 0, current: 0, deadline: "", done: false },
      { id: "g_set", label: "10 giornate in reparto camera", pillar: "set", type: "milestone", target: 0, current: 0, deadline: "", done: false },
    ],
    profile: Object.assign({}, state.profile, {
      savings: Number(f.savings || 0), incomeEstimate: Number(f.incomeEstimate || 0),
      koreaBudget: Number(f.koreaBudget || 0), koreaMonths: Number(f.koreaMonths || 24),
      targetDate: f.targetDate, onboarded: true,
    }),
  }));

  return (
    <div style={Object.assign({}, shell, { maxWidth: 500 })}>
      <Styles />
      <Rise>
        <div style={{ marginBottom: 28, marginTop: 20 }}>
          <div style={{ fontSize: 13, color: C.dim, fontWeight: 500, marginBottom: 8 }}>K-DOP OS</div>
          <h1 style={{ fontSize: 35, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.04em", lineHeight: 1.08 }}>
            Sei posti.<br />Uno è tuo.
          </h1>
          <p style={{ color: C.mut, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
            Cinque numeri per partire, anche a occhio. Il resto lo calcola il sistema mentre lavori.
          </p>
        </div>
      </Rise>
      <Rise d={100}>
        <Card>
          <Field label="Quanto hai da parte adesso (€)" type="number" value={f.savings}
            onChange={(e) => setF(Object.assign({}, f, { savings: e.target.value }))} />
          <Field label="A occhio, quanto entra in un mese normale (€)" type="number" value={f.incomeEstimate}
            hint="Una cifra grezza va benissimo: è solo il punto di partenza."
            onChange={(e) => setF(Object.assign({}, f, { incomeEstimate: e.target.value }))} />
          <Field label="Budget che ti serve per la Corea (€)" type="number" value={f.koreaBudget}
            onChange={(e) => setF(Object.assign({}, f, { koreaBudget: e.target.value }))} />
          <Field label="Per quanti mesi deve durare" type="number" value={f.koreaMonths}
            onChange={(e) => setF(Object.assign({}, f, { koreaMonths: e.target.value }))} />
          <Field label="Quando parti" type="date" value={f.targetDate}
            onChange={(e) => setF(Object.assign({}, f, { targetDate: e.target.value }))} />
          <Btn kind="solid" full onClick={go} style={{ marginTop: 8, padding: "16px" }}>Comincia</Btn>
        </Card>
      </Rise>
    </div>
  );
}
