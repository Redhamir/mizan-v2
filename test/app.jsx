/**
 * MIZAN v1 — مِيزَان — Finance Islamique Personnelle
 * UI : v6 Trade Republic · APIs réelles · Single file
 * ──────────────────────────────────────────────────
 * SANS CLÉ  : CoinGecko (BTC/ETH) · Frankfurter BCE · Aladhan (Hijri)
 * CLÉ LIBRE : GoldAPI.io 200 req/mois · Zoya screening · Gemini 2.0 Flash · Groq Llama 3.1
 * STOCKAGE  : localStorage uniquement — aucun serveur
 * ZAKAT     : Moteur AAOIFI Std. 9 — arrondi ihtiyat (haut)
 * BUDGET    : Import CSV/OFX bancaire (BNP, Boursorama, LCL…)
 */

import {
  useState, useRef, useEffect, useCallback,
  createContext, useContext, useMemo
} from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, CartesianGrid
} from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTES ISLAMIQUES
// ══════════════════════════════════════════════════════════════════════════════
const NISSAB_GOLD_G   = 85;    // AAOIFI Std. 9, §3.2
const NISSAB_SILVER_G = 595;   // École Hanafite — seuil argent
const ZAKAT_RATE      = 0.025; // 1/40 — ijmâ' de tous les madhabs
const HAWL_TOTAL_DAYS = 354;   // Année lunaire islamique
const TROY_OZ_G       = 31.1035;

// Taux zakatable par type d'actif (AAOIFI Std. 9 + Std. 21)
const ZAK_RATES = {
  cash: 1.0, gold: 1.0, silver: 1.0, crypto: 1.0,
  action: 0.25, etf: 0.25, immo_rev: 1.0, autre: 1.0,
};

// Mots-clés détection HARAM dans transactions
const HARAM_KW = [
  "casino","betclic","winamax","pmu","fdj","loto","jeux","paris sportif",
  "tabac","nicotine","cigarette","marlboro","philip morris",
  "alcool","vins","bière","biere","champagne","whisky","cognac","ricard",
  "hennessy","gordon","vodka","gin ","rhum","pastis","armagnac","moët",
  "poker","pokerstars","unibet","bwin","zetbet",
  "nicolas vins","cave à vins","vinothèque",
];

// ══════════════════════════════════════════════════════════════════════════════
// CONTEXTE MIZAN
// ══════════════════════════════════════════════════════════════════════════════
const MizanCtx = createContext(null);
const useMizan = () => useContext(MizanCtx);

// ══════════════════════════════════════════════════════════════════════════════
// LOCALSTORAGE
// ══════════════════════════════════════════════════════════════════════════════
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(`mz_${k}`); return v ? JSON.parse(v) : def; } catch(_e) { return def; } },
  set: (k, v)  => { try { localStorage.setItem(`mz_${k}`, JSON.stringify(v)); } catch(_e) {} },
  del: (k)     => { try { localStorage.removeItem(`mz_${k}`); } catch(_e) {} },
};

// ══════════════════════════════════════════════════════════════════════════════
// PARAMÈTRES PAR DÉFAUT
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_SETTINGS = {
  madhab:      "hanafi",
  displayName: "Redha",
  goldApiKey:  "",
  zoyaApiKey:  "",
  geminiKey:   "",
  groqKey:     "",
  iaProvider:  "gemini",
};

// ══════════════════════════════════════════════════════════════════════════════
// API LAYER
// ══════════════════════════════════════════════════════════════════════════════
const API = {
  async fetchCrypto() {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=eur"
    );
    const d = await r.json();
    return { btc: (d.bitcoin ? d.bitcoin.eur : null), eth: (d.ethereum ? d.ethereum.eur : null) };
  },

  async fetchMetals(key) {
    if (!key) return null;
    const hd = { "x-access-token": key, "Content-Type": "application/json" };
    const [gr, sr] = await Promise.all([
      fetch("https://www.goldapi.io/api/XAU/EUR", { headers: hd }),
      fetch("https://www.goldapi.io/api/XAG/EUR", { headers: hd }),
    ]);
    const [gd, sd] = await Promise.all([gr.json(), sr.json()]);
    return {
      goldPerGram:   gd.price_gram_24k,
      silverPerGram: sd.price_gram_24k || (sd.price / TROY_OZ_G),
    };
  },

  async fetchFX() {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,SAR");
    return (await r.json()).rates;
  },

  async fetchHijri() {
    const d = new Date().toLocaleDateString("en-GB").split("/").join("-");
    const r = await fetch(`https://api.aladhan.com/v1/gToH?date=${d}`);
    const j = await r.json();
    return (j.data ? j.data.hijri : null);
  },

  async checkHalal(ticker, key) {
    if (!key || !ticker) return null;
    const r = await fetch("https://api.zoya.finance/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query { stock(ticker:"${ticker}") { halalStatus complianceScore haramRevenuePct } }`
      }),
    });
    const d = await r.json();
    return (d.data ? d.data.stock : null) || null;
  },

  async askGemini(messages, system, key) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(m => ({
            role: m.r === "user" ? "user" : "model",
            parts: [{ text: m.t }],
          })),
        }),
      }
    );
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const c0=d.candidates&&d.candidates[0]; const c0c=c0&&c0.content; const c0cp=c0c&&c0c.parts&&c0c.parts[0]; return c0cp?c0cp.text:"";
  },

  async askGroq(messages, system, key) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: system },
          ...messages.map(m => ({ role: m.r === "user" ? "user" : "assistant", content: m.t })),
        ],
        temperature: 0.4,
        max_tokens: 1024,
      }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const ch0=d.choices&&d.choices[0]; return ch0&&ch0.message?ch0.message.content:"";
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// MOTEUR ZAKAT (AAOIFI Standard No. 9)
// ══════════════════════════════════════════════════════════════════════════════
const zRound = n => Math.ceil(n * 100) / 100;

function computeZakat(assets, prices, madhab, hawlStart) {
  const useGold = madhab !== "hanafi";
  const nissabEur = useGold
    ? (prices.goldPerGram || 0)   * NISSAB_GOLD_G
    : (prices.silverPerGram || 0) * NISSAB_SILVER_G;

  const rows = assets.map(a => {
    let base = a.v;
    const type = (a.tp ? a.tp.toLowerCase() : "") || "";

    if (type === "métal" && a.t === "XAU" && prices.goldPerGram)
      base = a.qty * prices.goldPerGram;
    else if (type === "métal" && a.t === "XAG" && prices.silverPerGram)
      base = a.qty * prices.silverPerGram;
    else if (type === "crypto" && a.t === "BTC" && prices.btc)
      base = a.qty * prices.btc;
    else if (type === "crypto" && a.t === "ETH" && prices.eth)
      base = a.qty * prices.eth;
    else if (type === "immo")
      base = a.annualRevenue || 0;

    const rateKey = type === "immo" ? "immo_rev" : type === "etf" ? "etf" : type === "action" ? "action" : type === "métal" ? (a.t === "XAU" ? "gold" : "silver") : type === "crypto" ? "crypto" : type === "cash" ? "cash" : "autre";
    const rate = ZAK_RATES[rateKey] || 1.0;
    const zakatable = zRound(base * rate);
    const zakat = zRound(zakatable * ZAKAT_RATE);
    return { ...a, zakBase: base, zakRate: rate, zakatable, zakat };
  });

  const totalZakatable = zRound(rows.reduce((s, r) => s + r.zakatable, 0));
  const totalZakat = zRound(rows.reduce((s, r) => s + r.zakat, 0));
  const obligatoire = nissabEur > 0 && totalZakatable >= nissabEur;

  let hawlElapsed = 0, hawlLeft = HAWL_TOTAL_DAYS, hawlPct = 0;
  if (hawlStart && obligatoire) {
    hawlElapsed = Math.floor((Date.now() - new Date(hawlStart)) / 86400000);
    hawlLeft    = Math.max(0, HAWL_TOTAL_DAYS - hawlElapsed);
    hawlPct     = Math.min(100, (hawlElapsed / HAWL_TOTAL_DAYS) * 100);
  }

  return { rows, totalZakatable, totalZakat, nissabEur, obligatoire, hawlElapsed, hawlLeft, hawlPct };
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV PARSER
// ══════════════════════════════════════════════════════════════════════════════
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

function isHaramTx(desc) {
  const d = (desc || "").toLowerCase();
  return HARAM_KW.some(kw => d.includes(kw));
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = ((lines[0].match(/;/g)||[]).length) >= ((lines[0].match(/,/g)||[]).length) ? ";" : ",";
  return lines.slice(1).map(line => {
    const cols = line.split(sep).map(c => c.replace(/^"|"$/g, "").trim());
    const amtIdx  = cols.findIndex(c => /^-?\d+[.,]\d{2}$/.test(c.replace(/\s/g, "")));
    const dateIdx = cols.findIndex(c => /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4}/.test(c));
    const amount  = amtIdx  >= 0 ? parseFloat(cols[amtIdx].replace(",", ".")) : 0;
    const date    = dateIdx >= 0 ? cols[dateIdx] : new Date().toISOString().slice(0, 10);
    const desc    = cols.filter((_, i) => i !== amtIdx && i !== dateIdx).join(" ").slice(0, 80) || "Transaction";
    const haram   = isHaramTx(desc);
    if (!amount) return null;
    return { id: uid(), r: "user", n: desc, c: haram ? "Haram" : amount > 0 ? "Revenu" : "Dépense", cat: "autre", d: date, a: amount, ok: !haram, sub: haram ? "⚠ Haram détecté" : "" };
  }).filter(Boolean);
}

const fEur = (n, dec = 2) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n || 0);

// ══════════════════════════════════════════════════════════════════════════════
// THEME SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
const ThemeContext = createContext(null);
const useT = () => useContext(ThemeContext);
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const T_LIGHT = {
  bg:"#FFFFFF",bgSoft:"#F5F5F3",bgCard:"#FAFAF9",bgMuted:"#EFEFED",bgHover:"#F0F0EE",
  text1:"#0C0C0B",text2:"#333330",text3:"#70706A",text4:"#ABABA5",
  border:"#E5E2DA",border2:"#D0CCC4",
  gold:"#B8750A",goldL:"#D4921E",goldBg:"rgba(184,117,10,0.07)",goldBd:"rgba(184,117,10,0.22)",
  green:"#0A8C4A",greenBg:"rgba(10,140,74,0.08)",greenBd:"rgba(10,140,74,0.22)",
  red:"#CC2F3E",redBg:"rgba(204,47,62,0.08)",redBd:"rgba(204,47,62,0.22)",
  orange:"#C96B00",orangeBg:"rgba(201,107,0,0.08)",orangeBd:"rgba(201,107,0,0.22)",
  blue:"#1D5FD4",blueBg:"rgba(29,95,212,0.08)",
  purple:"#7C3AED",purpleBg:"rgba(124,58,237,0.08)",
  r4:"4px",r6:"6px",r8:"8px",r10:"10px",r12:"12px",r16:"16px",
  shadow:"0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04)",
  shadowMd:"0 4px 24px rgba(0,0,0,.08)",dark:false,
};

const T_DARK = {
  bg:"#111111",bgSoft:"#0A0A0A",bgCard:"#1A1A1A",bgMuted:"#222222",bgHover:"#252525",
  text1:"#F2F2EF",text2:"#C8C8C4",text3:"#888884",text4:"#555552",
  border:"#2A2A2A",border2:"#333333",
  gold:"#D4921E",goldL:"#E8A832",goldBg:"rgba(212,146,30,0.10)",goldBd:"rgba(212,146,30,0.25)",
  green:"#1DB86A",greenBg:"rgba(29,184,106,0.10)",greenBd:"rgba(29,184,106,0.25)",
  red:"#E84040",redBg:"rgba(232,64,64,0.10)",redBd:"rgba(232,64,64,0.25)",
  orange:"#F5922E",orangeBg:"rgba(245,146,46,0.10)",orangeBd:"rgba(245,146,46,0.25)",
  blue:"#4A8AFF",blueBg:"rgba(74,138,255,0.10)",
  purple:"#A78BFA",purpleBg:"rgba(167,139,250,0.10)",
  r4:"4px",r6:"6px",r8:"8px",r10:"10px",r12:"12px",r16:"16px",
  shadow:"0 1px 3px rgba(0,0,0,.3), 0 4px 12px rgba(0,0,0,.2)",
  shadowMd:"0 4px 24px rgba(0,0,0,.4)",dark:true,
};

// ══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════════════════════════════
const PORTFOLIO_HISTORY = [
  {m:"Jan",v:48200,bench:46000},{m:"Fév",v:51300,bench:47800},
  {m:"Mar",v:49800,bench:47200},{m:"Avr",v:54100,bench:49500},
  {m:"Mai",v:53000,bench:48900},{m:"Jun",v:57800,bench:52300},
  {m:"Jul",v:61200,bench:54100},{m:"Aoû",v:59400,bench:52800},
  {m:"Sep",v:63700,bench:55900},{m:"Oct",v:67200,bench:57400},
  {m:"Nov",v:71500,bench:60200},{m:"Déc",v:74350,bench:62100},
];

const PATRIMOINE_PERIODS = {
  "1J": [{m:"8h",v:73900},{m:"10h",v:74100},{m:"12h",v:73800},{m:"14h",v:74350},{m:"16h",v:74350}],
  "7J": [{m:"L",v:72100},{m:"Ma",v:72800},{m:"Me",v:73200},{m:"J",v:72900},{m:"V",v:73500},{m:"S",v:74100},{m:"D",v:74350}],
  "1M": PORTFOLIO_HISTORY.slice(-4).map((d,i)=>({m:d.m,v:64000+i*3400})),
  "3M": PORTFOLIO_HISTORY.slice(-3),
  "YTD": PORTFOLIO_HISTORY,
  "1A":  PORTFOLIO_HISTORY,
  "TOUT":[{m:"2020",v:22000},{m:"2021",v:35000},{m:"2022",v:41000},{m:"2023",v:55000},{m:"2024",v:65000},{m:"2025",v:74350}],
};

const ASSETS_DEFAULT = [
  {id:"a1",i:"🕌",n:"iShares MSCI World Islamic",t:"ISAC",tp:"ETF",cat:"Actions & Fonds",score:98,st:"HALAL",src:"Zoya",v:28400,repartition:38.2,ch:+0.8,div:0,haramPct:0,gain:1200,acquired:"2022-03",ter:0.3,secteur:"Multi-secteur",geo:"Monde",qty:100},
  {id:"a2",i:"🍎",n:"Apple Inc.",t:"AAPL",tp:"Action",cat:"Actions & Fonds",score:91,st:"HALAL",src:"Zoya",v:18700,repartition:25.1,ch:+1.1,div:215.2,haramPct:0,gain:3200,acquired:"2021-08",ter:0,secteur:"Technologie",geo:"USA",qty:100},
  {id:"a3",i:"🥇",n:"Or physique (100g)",t:"XAU",tp:"Métal",cat:"Métaux",score:null,st:"HALAL",src:"Règle fixe",v:11900,repartition:16.0,ch:+0.3,div:0,haramPct:0,gain:800,acquired:"2020-01",ter:0,secteur:"Matières premières",geo:"—",qty:100},
  {id:"a4",i:"₿",n:"Bitcoin",t:"BTC",tp:"Crypto",cat:"Crypto",score:87,st:"HALAL",src:"Zoya",v:8940,repartition:12.0,ch:+2.4,div:0,haramPct:0,gain:2100,acquired:"2021-02",ter:0,secteur:"Crypto",geo:"—",qty:0.1},
  {id:"a5",i:"🏠",n:"Studio Lyon 3e",t:"IMM",tp:"Immo",cat:"Immobilier",score:null,st:"HALAL",src:"Déclaration",v:62000,repartition:8.2,ch:0,div:4800,haramPct:0,gain:0,acquired:"2019-06",ter:0,secteur:"Immobilier",geo:"France",qty:1,annualRevenue:4800},
  {id:"a6",i:"📦",n:"Amazon (AMZN)",t:"AMZN",tp:"Action",cat:"Actions & Fonds",score:72,st:"QUESTIONABLE",src:"Zoya",v:5200,repartition:7.0,ch:-0.4,div:186.5,haramPct:3.2,gain:340,acquired:"2023-01",ter:0,secteur:"Commerce",geo:"USA",qty:30},
  {id:"a7",i:"🖥",n:"Microsoft (MSFT)",t:"MSFT",tp:"Action",cat:"Actions & Fonds",score:68,st:"QUESTIONABLE",src:"Zoya",v:4100,repartition:5.5,ch:+0.6,div:124.8,haramPct:1.8,gain:210,acquired:"2023-03",ter:0,secteur:"Technologie",geo:"USA",qty:10},
  {id:"a8",i:"💎",n:"Argent physique (500g)",t:"XAG",tp:"Métal",cat:"Métaux",score:null,st:"HALAL",src:"Règle fixe",v:3900,repartition:5.2,ch:-0.1,div:0,haramPct:0,gain:120,acquired:"2022-11",ter:0,secteur:"Matières premières",geo:"—",qty:500},
  {id:"a9",i:"🌲",n:"G3F Forêt France",t:"G3F",tp:"Autre",cat:"Autre",score:null,st:"HALAL",src:"Déclaration",v:2500,repartition:3.4,ch:0,div:180,haramPct:0,gain:0,acquired:"2023-06",ter:1.2,secteur:"Forêt",geo:"France",qty:1},
  {id:"a10",i:"❌",n:"Amundi CW8 (Synthétique)",t:"CW8",tp:"ETF",cat:"Actions & Fonds",score:null,st:"HARAM",src:"SWAP=Riba",v:0,repartition:0,ch:0,div:0,haramPct:100,gain:0,acquired:"2021-01",ter:0.12,secteur:"ETF synthétique",geo:"Monde",qty:0},
];

const TRANSACTIONS = [
  {i:"🛒",n:"Carrefour Market",c:"Alimentation",cat:"logement",d:"28 Fév",a:-87.40,ok:true,sub:"Courses"},
  {i:"🚇",n:"RATP Pass Navigo",c:"Transport",cat:"transport",d:"01 Mar",a:-86.40,ok:true,sub:"Transports en commun"},
  {i:"📱",n:"Orange Mobile",c:"Téléphonie",cat:"abonnements",d:"01 Mar",a:-19.99,ok:true,sub:"Abonnement"},
  {i:"⚠️",n:"NICOLAS Vins",c:"Alcool",cat:"loisirs",d:"25 Fév",a:-43.60,ok:false,sub:"Haram — Alcool"},
  {i:"💊",n:"Pharmacie Centre",c:"Santé",cat:"sante",d:"24 Fév",a:-28.50,ok:true,sub:"Pharmacie"},
  {i:"💰",n:"Virement salaire",c:"Revenu",cat:"revenus",d:"28 Fév",a:+3200,ok:true,sub:"Salaire net"},
  {i:"🍕",n:"Domino's Pizza",c:"Restauration",cat:"loisirs",d:"27 Fév",a:-22.90,ok:true,sub:"Livraison repas"},
  {i:"📚",n:"Amazon Books",c:"Culture",cat:"loisirs",d:"26 Fév",a:-34.99,ok:true,sub:"Livres"},
  {i:"⚽",n:"Betclic",c:"Jeux/Paris",cat:"loisirs",d:"23 Fév",a:-15.00,ok:false,sub:"Maysir — Paris sportifs"},
  {i:"🌿",n:"Virement Sadaqah",c:"Aumône",cat:"zakat",d:"20 Fév",a:-50.00,ok:true,sub:"Purification"},
];

const ENVELOPPES_INIT = [
  {id:"logement",name:"Logement",icon:"🏠",budget:720,spent:620,color:"#6366F1",items:[{name:"Loyer",amount:500,spent:500},{name:"Charges",amount:120,spent:120},{name:"Électricité",amount:60,spent:0},{name:"Internet",amount:40,spent:0}]},
  {id:"alimentation",name:"Alimentation",icon:"🛒",budget:400,spent:287,color:"#10B981",items:[{name:"Courses",amount:300,spent:287},{name:"Marchés bio",amount:100,spent:0}]},
  {id:"transport",name:"Transport",icon:"🚇",budget:150,spent:86.4,color:"#3B82F6",items:[{name:"Navigo",amount:86.4,spent:86.4},{name:"Carburant",amount:63.6,spent:0}]},
  {id:"sante",name:"Santé",icon:"💊",budget:80,spent:28.5,color:"#EF4444",items:[{name:"Pharmacie",amount:50,spent:28.5},{name:"Mutuelle",amount:30,spent:0}]},
  {id:"loisirs",name:"Loisirs & Culture",icon:"🎭",budget:150,spent:57.9,color:"#F59E0B",items:[{name:"Livres",amount:50,spent:34.99},{name:"Restaurants",amount:60,spent:22.9},{name:"Sorties",amount:40,spent:0}]},
  {id:"abonnements",name:"Abonnements",icon:"📱",budget:60,spent:19.99,color:"#8B5CF6",items:[{name:"Orange Mobile",amount:19.99,spent:19.99},{name:"Netflix",amount:15.99,spent:0},{name:"Spotify",amount:9.99,spent:0},{name:"Assurance",amount:15,spent:0}]},
  {id:"investissements",name:"Investissements Halal",icon:"📈",budget:500,spent:0,color:"#B8750A",items:[{name:"ISAC ETF Islamique",amount:300,spent:0},{name:"Bitcoin",amount:100,spent:0},{name:"Épargne G3F",amount:100,spent:0}]},
  {id:"zakat",name:"Zakat & Sadaqah",icon:"☪",budget:100,spent:50,color:"#059669",items:[{name:"Sadaqah purification",amount:50,spent:50},{name:"Zakat mensuelle",amount:50,spent:0}]},
];

const PLUS_VALUES_FISCAL = [
  {n:"Apple (AAPL)",icon:"🍎",gain:3200,duree:"31 mois",regime:"CTO — Flat Tax 30%",taux:30,ir:960,ps:550.4,net:1689.6},
  {n:"Bitcoin (BTC)",icon:"₿",gain:2100,duree:"37 mois",regime:"Crypto Art. 150 VH",taux:30,ir:630,ps:361.2,net:1108.8},
  {n:"ISAC (PEA)",icon:"🕌",gain:1200,duree:"24 mois",regime:"PEA > 5 ans → 0% IR",taux:17.2,ir:0,ps:206.4,net:993.6},
  {n:"Studio Lyon",icon:"🏠",gain:0,duree:"81 mois",regime:"Immo — exo durée",taux:36.2,ir:0,ps:0,net:0},
];

// ══════════════════════════════════════════════════════════════════════════════
// CSS GLOBAL
// ══════════════════════════════════════════════════════════════════════════════
function GlobalStyles({ dark }) {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin:0; padding:0; }
      html, body, #root { height:100%; font-family:${FONT}; }
      body { background:${dark?"#0A0A0A":"#F5F5F3"}; }
      ::-webkit-scrollbar { width:5px; height:5px; }
      ::-webkit-scrollbar-track { background:transparent; }
      ::-webkit-scrollbar-thumb { background:${dark?"#333":"#D0CCC4"}; border-radius:3px; }
      *:focus-visible { outline:2px solid ${dark?"#D4921E":"#B8750A"} !important; outline-offset:2px !important; }
      input[type=range] { -webkit-appearance:none; width:100%; height:3px; border-radius:2px; background:${dark?"#333":"#E5E2DA"}; outline:none; cursor:pointer; }
      input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:${dark?"#D4921E":"#B8750A"}; cursor:pointer; border:3px solid ${dark?"#1A1A1A":"#FFF"}; box-shadow:0 0 0 1px ${dark?"#D4921E":"#B8750A"}; }
      @keyframes mzDot { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
      @keyframes mzPulse { 0%{box-shadow:0 0 0 0 rgba(184,117,10,0.4)} 70%{box-shadow:0 0 0 12px rgba(184,117,10,0)} 100%{box-shadow:0 0 0 0 rgba(184,117,10,0)} }
      @media (prefers-reduced-motion:reduce) { *, ::before, ::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }}
    `}</style>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BASE COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════
function Card({ children, style={}, accent=false, onClick, role, ariaLabel }) {
  const T = useT();
  return (
    <div onClick={onClick} role={role} aria-label={ariaLabel}
      tabIndex={onClick?0:undefined}
      onKeyDown={onClick?(e)=>{ if(e.key==="Enter"||e.key===" ")onClick(e); }:undefined}
      style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.r10,
        position:"relative",overflow:"hidden",cursor:onClick?"pointer":"default",
        outline:"none",boxShadow:T.shadow,...style}}>
      {accent && (
        <div aria-hidden="true" style={{position:"absolute",top:0,left:0,right:0,height:2,
          background:`linear-gradient(90deg,transparent,${T.gold} 30%,${T.goldL} 60%,transparent)`}}/>
      )}
      {children}
    </div>
  );
}

function Label({ children, style={}, id }) {
  const T = useT();
  return (
    <span id={id} style={{fontSize:10,fontWeight:800,letterSpacing:"1px",
      textTransform:"uppercase",color:T.text3,fontFamily:FONT,...style}}>
      {children}
    </span>
  );
}

function BigNum({ children, size=32, color, style={} }) {
  const T = useT();
  return (
    <div style={{fontSize:size,fontWeight:800,
      letterSpacing:size>24?"-1.5px":"-0.5px",lineHeight:1.05,
      color:color||T.text1,fontFamily:FONT,...style}}>
      {children}
    </div>
  );
}

function PnLTag({ val, suffix="%" }) {
  const T = useT();
  const up = val >= 0;
  return (
    <span style={{fontSize:12,fontWeight:800,color:up?T.green:T.red,fontFamily:FONT}}>
      {up?"+":""}{typeof val==="number"?val.toFixed(2):val}{suffix}
    </span>
  );
}

function PnLBadge({ children, up }) {
  const T = useT();
  return (
    <span style={{display:"inline-block",fontSize:11,fontWeight:700,
      padding:"2px 7px",borderRadius:T.r4,
      background:up?T.greenBg:T.redBg,color:up?T.green:T.red,
      border:`1px solid ${up?T.greenBd:T.redBd}`,fontFamily:FONT}}>
      {children}
    </span>
  );
}

function StatusBadge({ st }) {
  const T = useT();
  const M = {
    HALAL:       {bg:T.greenBg,c:T.green,bd:T.greenBd,dot:"●"},
    HARAM:       {bg:T.redBg,c:T.red,bd:T.redBd,dot:"✕"},
    QUESTIONABLE:{bg:T.orangeBg,c:T.orange,bd:T.orangeBd,dot:"▲"},
  };
  const s = M[st]||{bg:T.bgMuted,c:T.text3,bd:T.border,dot:"○"};
  return (
    <span role="status" aria-label={`Statut: ${st}`}
      style={{display:"inline-flex",alignItems:"center",gap:4,
        padding:"2px 8px",borderRadius:T.r4,
        fontSize:10,fontWeight:800,letterSpacing:"0.5px",
        background:s.bg,color:s.c,border:`1px solid ${s.bd}`,
        textTransform:"uppercase",fontFamily:FONT}}>
      <span aria-hidden="true" style={{fontSize:7}}>{s.dot}</span>{st}
    </span>
  );
}

function ScoreBar({ score, st }) {
  const T = useT();
  const color = st==="HALAL"?T.green:st==="QUESTIONABLE"?T.orange:T.red;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}
        style={{flex:1,height:3,borderRadius:2,background:T.bgMuted,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${score}%`,background:color,transition:"width .4s ease",borderRadius:2}}/>
      </div>
      <span style={{fontSize:11,fontWeight:800,color,width:22,textAlign:"right",fontFamily:FONT}}>{score}</span>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  const T = useT();
  return (
    <button role="switch" aria-checked={on} aria-label={label}
      onClick={()=>onChange(!on)}
      style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",
        background:on?T.green:T.bgMuted,position:"relative",flexShrink:0,
        transition:"background .2s",outline:"none"}}>
      <div style={{position:"absolute",top:3,width:18,height:18,borderRadius:"50%",
        background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.25)",
        transition:"left .2s ease",left:on?23:3}}/>
    </button>
  );
}

function Divider({ style={} }) {
  const T = useT();
  return <div role="separator" style={{height:1,background:T.border,...style}}/>;
}

function InfoBtn({ title="Voir documentation" }) {
  const T = useT();
  return (
    <button aria-label={title} title={title}
      style={{width:18,height:18,borderRadius:"50%",border:`1px solid ${T.border2}`,
        background:"transparent",color:T.text3,fontSize:9,cursor:"pointer",
        display:"inline-flex",alignItems:"center",justifyContent:"center",
        fontWeight:800,flexShrink:0,outline:"none",marginLeft:4}}>
      <span aria-hidden="true">ℹ</span>
    </button>
  );
}

function ChartTooltip({ active, payload, label }) {
  const T = useT();
  if (!active||!(payload ? payload.length : null)) return null;
  return (
    <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.r8,
      padding:"10px 14px",boxShadow:T.shadowMd}}>
      <div style={{fontSize:11,color:T.text3,marginBottom:4,fontFamily:FONT}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{fontSize:13,fontWeight:800,color:p.color||T.text1,letterSpacing:"-0.3px",fontFamily:FONT}}>
          {typeof p.value==="number"?`${(p.value).toLocaleString("fr-FR")} €`:p.value}
        </div>
      ))}
    </div>
  );
}

function SubTabs({ tabs, active, onSelect, style={} }) {
  const T = useT();
  return (
    <div role="tablist" style={{display:"flex",gap:4,borderBottom:`1px solid ${T.border}`,paddingBottom:0,...style}}>
      {tabs.map(tab=>(
        <button key={tab.id} role="tab" aria-selected={active===tab.id}
          onClick={()=>onSelect(tab.id)}
          style={{padding:"8px 16px",fontSize:13,fontWeight:active===tab.id?800:600,
            background:"none",border:"none",cursor:"pointer",
            color:active===tab.id?T.text1:T.text3,
            borderBottom:`2px solid ${active===tab.id?T.gold:"transparent"}`,
            marginBottom:-1,transition:"all .15s",outline:"none",fontFamily:FONT}}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ label, value, delta, deltaUp, sub, accent, onClick, style={} }) {
  const T = useT();
  return (
    <Card accent={accent} onClick={onClick} style={{padding:"20px 24px",...style}}>
      <Label>{label}</Label>
      <BigNum size={24} style={{marginTop:8,marginBottom:delta?4:0}}>{value}</BigNum>
      {delta && <PnLBadge up={deltaUp}>{delta}</PnLBadge>}
      {sub && <div style={{fontSize:11,color:T.text3,marginTop:4,fontFamily:FONT}}>{sub}</div>}
    </Card>
  );
}

function SectionHeader({ title, sub, badge }) {
  const T = useT();
  return (
    <div style={{marginBottom:4}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <h1 style={{fontSize:22,fontWeight:900,color:T.text1,letterSpacing:"-0.5px",fontFamily:FONT}}>{title}</h1>
        {badge && (
          <span style={{fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:T.r4,
            background:T.goldBg,color:T.gold,border:`1px solid ${T.goldBd}`,
            letterSpacing:".8px",textTransform:"uppercase",fontFamily:FONT}}>
            {badge}
          </span>
        )}
      </div>
      {sub && <p style={{fontSize:12,color:T.text3,marginTop:4,fontFamily:FONT}}>{sub}</p>}
    </div>
  );
}

function PeriodTabs({ active, onChange }) {
  const T = useT();
  const periods = ["1J","7J","1M","3M","YTD","1A","TOUT"];
  return (
    <div style={{display:"flex",gap:2}}>
      {periods.map(p=>(
        <button key={p} onClick={()=>onChange(p)}
          style={{padding:"5px 10px",fontSize:11,fontWeight:active===p?800:600,
            background:active===p?T.gold:"transparent",
            color:active===p?"#fff":T.text3,
            border:`1px solid ${active===p?T.gold:T.border}`,
            borderRadius:T.r6,cursor:"pointer",outline:"none",
            transition:"all .15s",fontFamily:FONT}}>
          {p}
        </button>
      ))}
    </div>
  );
}

function FloatingAIButton({ onClick }) {
  const T = useT();
  return (
    <button onClick={onClick} aria-label="Ouvrir IA Cortex"
      style={{position:"fixed",bottom:28,right:28,
        width:52,height:52,borderRadius:"50%",border:"none",
        background:`linear-gradient(135deg,${T.gold},${T.goldL})`,
        color:"#fff",fontSize:22,cursor:"pointer",
        boxShadow:"0 4px 20px rgba(184,117,10,0.45)",
        display:"flex",alignItems:"center",justifyContent:"center",
        animation:"mzPulse 2s ease-in-out 3",zIndex:200,outline:"none"}}>
      <span aria-hidden="true">🤖</span>
    </button>
  );
}

function NotificationPanel({ notifications=[], onClose }) {
  const T = useT();
  const ref = useRef(null);
  useEffect(()=>{
    const fn=(e)=>{ if(ref.current&&!ref.current.contains(e.target))onClose(); };
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[onClose]);
  return (
    <div ref={ref} aria-modal="true" role="dialog" aria-label="Notifications"
      style={{position:"absolute",top:56,right:16,width:340,
        background:T.bgCard,border:`1px solid ${T.border}`,
        borderRadius:T.r12,boxShadow:T.shadowMd,zIndex:100,overflow:"hidden"}}>
      <div style={{padding:"16px 20px 12px",borderBottom:`1px solid ${T.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:14,fontWeight:800,color:T.text1,fontFamily:FONT}}>Notifications</span>
        <button onClick={onClose} aria-label="Fermer"
          style={{background:"none",border:"none",color:T.text3,cursor:"pointer",fontSize:16,outline:"none"}}>×</button>
      </div>
      <div style={{maxHeight:360,overflowY:"auto"}}>
        {notifications.length===0 && (
          <div style={{padding:"20px",textAlign:"center",fontSize:12,color:T.text3,fontFamily:FONT}}>Aucune alerte</div>
        )}
        {notifications.map(n=>(
          <div key={n.id} style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,
            background:n.type==="haram"?T.redBg:"transparent"}}>
            <div style={{fontSize:12,fontWeight:800,color:n.type==="haram"?T.red:T.orange,fontFamily:FONT}}>{n.title}</div>
            <div style={{fontSize:11,color:T.text2,marginTop:3,fontFamily:FONT}}>{n.body}</div>
            <div style={{fontSize:10,color:T.text4,marginTop:4,fontFamily:FONT}}>{n.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function DashboardPage() {
  const T = useT();
  const { assets, zakatResult, transactions } = useMizan();
  const totalV = assets.reduce((s,a)=>s+a.v,0);
  const halalV = assets.filter(a=>a.st==="HALAL").reduce((s,a)=>s+a.v,0);
  const halalPct = totalV>0?(halalV/totalV*100).toFixed(1):"0";
  const totalGain = assets.reduce((s,a)=>s+(a.gain||0),0);

  const CAT_COLORS = {"Actions & Fonds":"#6366F1","Métaux":"#D4921E","Crypto":"#F59E0B","Immobilier":"#10B981","Autre":"#3B82F6"};
  const ALLOC = Object.entries(
    assets.reduce((acc,a)=>{ acc[a.cat]=(acc[a.cat]||0)+a.v; return acc; }, {})
  ).filter(entry=>entry[1]>0).map(entry=>({name:entry[0],v:entry[1],c:CAT_COLORS[entry[0]]||"#888"}));

  const PERF_METRICS = [
    {l:"CAGR 3A",v:"+14,2%",up:true},{l:"Sharpe",v:"1.42",up:true},
    {l:"MDD",v:"-8,4%",up:false},{l:"Vol. ann.",v:"11,2%",up:null},
    {l:"VaR 95%",v:"-4,1%",up:false},{l:"Beta",v:"0.87",up:null},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        <MetricCard label="Patrimoine total" value={`${totalV.toLocaleString("fr-FR")} €`}
          delta="+18,4% YTD" deltaUp={true} accent={true}/>
        <MetricCard label="Zakat estimée" value={`${zakatResult.totalZakat.toFixed(0)} €`}
          sub={zakatResult.hawlElapsed > 0 ? `${zakatResult.hawlElapsed} / ${HAWL_TOTAL_DAYS} jours Hawl` : "Hawl non démarré"}/>
        <MetricCard label="CAGR 3 ans" value="+14,2 %" delta="+1,1pt vs MSCI Islamic" deltaUp={true}/>
        <MetricCard label="Portefeuille Halal" value={`${halalPct} %`}
          sub={`${halalV.toLocaleString("fr-FR")} € / ${totalV.toLocaleString("fr-FR")} €`}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:12}}>
        <Card style={{padding:"20px 20px 12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <Label>Performance — Année en cours</Label>
              <BigNum size={28} style={{marginTop:6}}>{totalV.toLocaleString("fr-FR")} €</BigNum>
              <PnLBadge up={true}>+{totalGain.toLocaleString("fr-FR")} € · +18,4%</PnLBadge>
            </div>
            <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>vs MSCI Islamic World</div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={PORTFOLIO_HISTORY} margin={{top:0,right:0,bottom:0,left:0}}>
              <defs>
                <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={T.gold} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={T.gold} stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={T.blue} stopOpacity={0.15}/>
                  <stop offset="95%" stopColor={T.blue} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="m" tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip content={<ChartTooltip/>}/>
              <Area type="monotone" dataKey="v" stroke={T.gold} strokeWidth={2} fill="url(#gGold)" name="MIZAN"/>
              <Area type="monotone" dataKey="bench" stroke={T.blue} strokeWidth={1.5} fill="url(#gBlue)" strokeDasharray="4 2" name="MSCI Islamic"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card style={{padding:"20px"}}>
          <Label>Répartition</Label>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={ALLOC} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="v" strokeWidth={0}>
                {ALLOC.map((e,i)=><Cell key={i} fill={e.c}/>)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ALLOC.map((e,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:e.c,flexShrink:0}}/>
                  <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{e.name}</span>
                </div>
                <span style={{fontSize:11,fontWeight:800,color:T.text1,fontFamily:FONT}}>
                  {(e.v/totalV*100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card style={{padding:"20px"}}>
          <Label style={{marginBottom:12,display:"block"}}>Métriques de performance</Label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {PERF_METRICS.map((m,i)=>(
              <div key={i} style={{background:T.bgSoft,borderRadius:T.r8,padding:"12px 14px"}}>
                <Label style={{display:"block",marginBottom:6}}>{m.l}</Label>
                <div style={{fontSize:16,fontWeight:800,fontFamily:FONT,
                  color:m.up===null?T.text1:m.up?T.green:T.red}}>{m.v}</div>
              </div>
            ))}
          </div>
        </Card>
        {(()=>{
          const haramAssets = assets.filter(a=>a.st==="HARAM"&&a.v>0);
          const questionable = assets.filter(a=>a.st==="QUESTIONABLE");
          const haramTxs = transactions.filter(t=>!t.ok);
          const alerts = [
            ...haramAssets.map(a=>({id:`h_${a.id}`,type:"haram",title:`${a.t} — HARAM`,body:a.n})),
            ...questionable.map(a=>{const p=(a.div||0)*(a.haramPct||0)/100;return p>0.01?{id:`q_${a.id}`,type:"warning",title:`${a.t} — Purification`,body:`${p.toFixed(2)}€ à purifier`}:null;}).filter(Boolean),
            ...haramTxs.slice(0,2).map(t=>({id:`t_${t.id||t.n}`,type:"haram",title:"Transaction HARAM",body:`${t.n} · ${t.a.toFixed(2)}€`})),
          ].slice(0,4);
          if(alerts.length===0) return (
            <Card style={{padding:"20px"}}>
              <Label style={{marginBottom:12,display:"block"}}>Alertes actives</Label>
              <div style={{fontSize:12,color:T.green,fontFamily:FONT}}>✓ Aucune alerte — portefeuille conforme</div>
            </Card>
          );
          return (
            <Card style={{padding:"20px"}}>
              <Label style={{marginBottom:12,display:"block"}}>Alertes actives</Label>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {alerts.map(n=>(
                  <div key={n.id} style={{display:"flex",gap:10,padding:"10px 12px",borderRadius:T.r8,
                    background:n.type==="haram"?T.redBg:T.orangeBg,
                    border:`1px solid ${n.type==="haram"?T.redBd:T.orangeBd}`}}>
                    <span aria-hidden="true">{n.type==="haram"?"🚫":"⚠️"}</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:800,color:n.type==="haram"?T.red:T.orange,fontFamily:FONT}}>{n.title}</div>
                      <div style={{fontSize:11,color:T.text2,fontFamily:FONT}}>{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : PATRIMOINE
// ══════════════════════════════════════════════════════════════════════════════
function PatrimoinePage() {
  const T = useT();
  const { assets } = useMizan();
  const [period, setPeriod] = useState("YTD");
  const [catFilter, setCatFilter] = useState("Tous");
  const [expandedCats, setExpandedCats] = useState(new Set(["Actions & Fonds","Métaux"]));

  const totalV = assets.reduce((s,a)=>s+a.v,0);
  const totalGain = assets.reduce((s,a)=>s+(a.gain||0),0);
  const gainPct = totalV>0?(totalGain/totalV*100).toFixed(2):0;

  const chartData = PATRIMOINE_PERIODS[period]||PORTFOLIO_HISTORY;
  const firstV = chartData[0]?chartData[0].v:0;
  const lastV = chartData[chartData.length-1]?chartData[chartData.length-1].v:0;
  const periodGain = lastV - firstV;
  const periodGainPct = firstV>0?(periodGain/firstV*100).toFixed(2):0;

  const cats = [...new Set(assets.map(a=>a.cat))];
  const assetsByCat = cats.reduce((acc,cat)=>{ acc[cat]=assets.filter(a=>a.cat===cat).sort((a,b)=>b.v-a.v); return acc; }, {});

  const toggleCat = (cat) => {
    setExpandedCats(prev=>{const s=new Set(prev);s.has(cat)?s.delete(cat):s.add(cat);return s;});
  };

  const CAT_COLORS = {"Actions & Fonds":"#6366F1","Métaux":"#D4921E","Crypto":"#F59E0B","Immobilier":"#10B981","Autre":"#3B82F6"};
  const ALLOC = cats.map(cat=>({
    name:cat,
    v:(assetsByCat[cat]?assetsByCat[cat].reduce((s,a)=>s+a.v,0):0)||0,
    c:CAT_COLORS[cat]||"#888",
  })).filter(a=>a.v>0);

  const SECTORS = [
    {name:"Technologie",pct:48,c:"#6366F1"},{name:"Finance Halal",pct:12,c:"#10B981"},
    {name:"Santé",pct:8,c:"#EF4444"},{name:"Commerce",pct:10,c:"#F59E0B"},
    {name:"Forêt/Immo",pct:14,c:"#3B82F6"},{name:"Autre",pct:8,c:"#888"},
  ];
  const GEOS = [
    {name:"USA",pct:62,c:"#6366F1"},{name:"Europe",pct:18,c:"#10B981"},
    {name:"Monde (ETF)",pct:12,c:"#3B82F6"},{name:"France",pct:8,c:"#D4921E"},
  ];
  const scoreSectoriel = 3;
  const scoreGeo = 4;
  const terMoyen = ((28400*0.3+2500*1.2)/(totalV||1)*100/100).toFixed(2);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:12}}>
        <Card style={{padding:"20px 20px 12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div>
              <Label>Patrimoine brut · {new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</Label>
              <BigNum size={34} style={{marginTop:8}}>{totalV.toLocaleString("fr-FR")} €</BigNum>
            </div>
            <PeriodTabs active={period} onChange={setPeriod}/>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{top:4,right:0,bottom:0,left:0}}>
              <defs>
                <linearGradient id="gPat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={T.gold} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={T.gold} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="m" tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} axisLine={false} tickLine={false}/>
              <YAxis hide={true}/>
              <Tooltip content={<ChartTooltip/>}/>
              <Area type="monotone" dataKey="v" stroke={periodGain>=0?T.green:T.red} strokeWidth={2} fill="url(#gPat)" name="Patrimoine"/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card style={{padding:"20px"}}>
          <Label>Performance</Label>
          <div style={{marginTop:16,padding:"16px",background:T.bgSoft,borderRadius:T.r8}}>
            <Label style={{fontSize:9}}>Plus-value latente — {period}</Label>
            <BigNum size={22} color={periodGain>=0?T.green:T.red} style={{marginTop:6}}>
              {periodGain>=0?"+":""}{periodGain.toLocaleString("fr-FR")} €
            </BigNum>
            <PnLBadge up={periodGain>=0}>{periodGain>=0?"+":""}{periodGainPct}%</PnLBadge>
          </div>
          <Divider style={{margin:"16px 0"}}/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:T.text3,fontFamily:FONT,fontWeight:600}}>Total investi</span>
              <span style={{fontSize:12,fontWeight:800,fontFamily:FONT,color:T.text1}}>{(totalV-totalGain).toLocaleString("fr-FR")} €</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:T.text3,fontFamily:FONT,fontWeight:600}}>Plus-value totale</span>
              <span style={{fontSize:12,fontWeight:800,fontFamily:FONT,color:T.green}}>+{totalGain.toLocaleString("fr-FR")} €</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:T.text3,fontFamily:FONT,fontWeight:600}}>Rendement</span>
              <span style={{fontSize:12,fontWeight:800,fontFamily:FONT,color:T.green}}>+{gainPct}%</span>
            </div>
          </div>
        </Card>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:12}}>
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <Label>Actifs</Label>
            <div style={{display:"flex",gap:8}}>
              {["Tous","Actions","ETF","Crypto","Immo","Métaux","Autre"].map(f=>(
                <button key={f} onClick={()=>setCatFilter(f)}
                  style={{padding:"4px 10px",fontSize:10,fontWeight:700,borderRadius:T.r4,
                    background:catFilter===f?T.gold:"transparent",
                    color:catFilter===f?"#fff":T.text3,
                    border:`1px solid ${catFilter===f?T.gold:T.border}`,
                    cursor:"pointer",outline:"none",fontFamily:FONT}}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 100px 120px 110px 120px",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
            {["Nom","Répartition","Valeur ▼","+/- value YTD","Statut"].map(h=>(
              <span key={h} style={{fontSize:10,fontWeight:800,color:T.text3,fontFamily:FONT,textTransform:"uppercase",letterSpacing:"0.5px"}}>{h}</span>
            ))}
          </div>
          {cats.filter(cat=>catFilter==="Tous"||(assetsByCat[cat]&&assetsByCat[cat].some(a=>a.tp===catFilter||cat===catFilter))).map(cat=>{
            const catAssets = assetsByCat[cat]||[];
            if(catAssets.length===0) return null;
            const catTotal = catAssets.reduce((s,a)=>s+a.v,0);
            const catGain = catAssets.reduce((s,a)=>s+a.gain,0);
            const isExpanded = expandedCats.has(cat);
            const allocItem = ALLOC.find(a=>a.name===cat);
            return (
              <div key={cat}>
                <button onClick={()=>toggleCat(cat)}
                  style={{width:"100%",display:"grid",gridTemplateColumns:"1fr 100px 120px 110px 120px",
                    gap:8,padding:"12px 0",background:"none",border:"none",
                    borderBottom:`1px solid ${T.border}`,cursor:"pointer",outline:"none",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span aria-hidden="true" style={{fontSize:12,color:T.text3,fontWeight:800}}>{isExpanded?"▼":"▶"}</span>
                    <div style={{width:10,height:10,borderRadius:"50%",background:allocItem?allocItem.c:T.text3,flexShrink:0}}/>
                    <span style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT}}>{cat}</span>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:T.text2,fontFamily:FONT,textAlign:"right"}}>
                    {catTotal>0?(catTotal/totalV*100).toFixed(1):0}%
                  </span>
                  <span style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT,textAlign:"right"}}>
                    {catTotal.toLocaleString("fr-FR")} €
                  </span>
                  <span style={{textAlign:"right"}}>
                    {catGain!==0&&<PnLBadge up={catGain>=0}>{catGain>=0?"+":""}{catGain.toLocaleString("fr-FR")} €</PnLBadge>}
                  </span>
                  <span/>
                </button>
                {isExpanded && catAssets.map(a=>(
                  <div key={a.t} style={{display:"grid",gridTemplateColumns:"1fr 100px 120px 110px 120px",
                    gap:8,padding:"10px 0 10px 24px",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span aria-hidden="true" style={{fontSize:16,width:22,textAlign:"center"}}>{a.i}</span>
                      <div>
                        <div style={{fontSize:12,fontWeight:800,color:T.text1,fontFamily:FONT}}>{a.t}</div>
                        <div style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{a.n.length>28?a.n.slice(0,28)+"…":a.n}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.text2,fontFamily:FONT}}>{a.repartition}%</div>
                      {a.score&&<ScoreBar score={a.score} st={a.st}/>}
                    </div>
                    <span style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT,textAlign:"right"}}>
                      {a.v.toLocaleString("fr-FR")} €
                    </span>
                    <span style={{textAlign:"right"}}>
                      {a.gain!==0&&<PnLBadge up={a.gain>=0}>{a.gain>=0?"+":""}{a.gain.toLocaleString("fr-FR")} €</PnLBadge>}
                    </span>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <StatusBadge st={a.st}/>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card style={{padding:"20px"}}>
            <Label>Répartition</Label>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={ALLOC} cx="50%" cy="50%" innerRadius={38} outerRadius={60} dataKey="v" strokeWidth={0}>
                  {ALLOC.map((e,i)=><Cell key={i} fill={e.c}/>)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{fontSize:14,fontWeight:900,color:T.text1,textAlign:"center",marginTop:-4,fontFamily:FONT}}>
              {totalV.toLocaleString("fr-FR")} €
            </div>
            <div style={{fontSize:10,color:T.text3,textAlign:"center",fontFamily:FONT,marginBottom:10}}>Total</div>
            {ALLOC.map((e,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:8,height:8,borderRadius:2,background:e.c}}/>
                  <span style={{fontSize:10,color:T.text2,fontFamily:FONT,fontWeight:600}}>{e.name}</span>
                </div>
                <span style={{fontSize:10,fontWeight:800,color:T.text1,fontFamily:FONT}}>{(e.v/totalV*100).toFixed(0)}%</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <Label>Scanner de frais</Label>
            <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:T.r4,background:T.greenBg,color:T.green,border:`1px solid ${T.greenBd}`,fontFamily:FONT}}>EXCELLENT</span>
          </div>
          <BigNum size={28} color={T.green}>{terMoyen}%</BigNum>
          <div style={{fontSize:11,color:T.text3,marginTop:4,fontFamily:FONT}}>TER moyen pondéré</div>
          <Divider style={{margin:"14px 0"}}/>
          {[{n:"ISAC (islamique)",ter:"0,30%"},{n:"G3F Forêt",ter:"1,20%"},{n:"Actions directes",ter:"0,00%"}].map((f,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{f.n}</span>
              <span style={{fontSize:11,fontWeight:800,color:T.text1,fontFamily:FONT}}>{f.ter}</span>
            </div>
          ))}
        </Card>
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <Label>Diversification sectorielle</Label>
            <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:T.r4,background:T.redBg,color:T.red,border:`1px solid ${T.redBd}`,fontFamily:FONT}}>INSUFFISANTE</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <BigNum size={36} color={T.orange}>{scoreSectoriel}</BigNum>
            <div style={{fontSize:13,color:T.text3,fontFamily:FONT}}>/10</div>
          </div>
          <div style={{fontSize:11,color:T.red,fontFamily:FONT,marginBottom:12}}>48% en Technologie — surexposition critique</div>
          {SECTORS.map((s,i)=>(
            <div key={i} style={{marginBottom:7}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:10,color:T.text2,fontFamily:FONT,fontWeight:600}}>{s.name}</span>
                <span style={{fontSize:10,fontWeight:800,color:T.text1,fontFamily:FONT}}>{s.pct}%</span>
              </div>
              <div style={{height:3,background:T.bgMuted,borderRadius:2}}>
                <div style={{height:"100%",width:`${s.pct}%`,background:s.c,borderRadius:2}}/>
              </div>
            </div>
          ))}
        </Card>
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <Label>Diversification géographique</Label>
            <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:T.r4,background:T.redBg,color:T.red,border:`1px solid ${T.redBd}`,fontFamily:FONT}}>INSUFFISANTE</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <BigNum size={36} color={T.orange}>{scoreGeo}</BigNum>
            <div style={{fontSize:13,color:T.text3,fontFamily:FONT}}>/10</div>
          </div>
          <div style={{fontSize:11,color:T.orange,fontFamily:FONT,marginBottom:12}}>62% USA — dépendance au dollar US</div>
          {GEOS.map((g,i)=>(
            <div key={i} style={{marginBottom:7}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:10,color:T.text2,fontFamily:FONT,fontWeight:600}}>{g.name}</span>
                <span style={{fontSize:10,fontWeight:800,color:T.text1,fontFamily:FONT}}>{g.pct}%</span>
              </div>
              <div style={{height:3,background:T.bgMuted,borderRadius:2}}>
                <div style={{height:"100%",width:`${g.pct}%`,background:g.c,borderRadius:2}}/>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Card style={{padding:"20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <Label>Profil de l'investisseur</Label>
          <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:T.r4,background:T.blueBg,color:T.blue,border:`1px solid rgba(29,95,212,.22)`,fontFamily:FONT}}>MEMBRE MIZAN PRO</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginTop:20}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:700,color:T.text1,fontFamily:FONT}}>Profil de risque <InfoBtn title="Votre tolérance au risque sur une échelle de 1 à 10"/></span>
              <span style={{fontSize:14,fontWeight:900,color:T.gold,fontFamily:FONT}}>6/10</span>
            </div>
            <input type="range" min={1} max={10} value={6} readOnly aria-label="Profil de risque : 6/10" style={{width:"100%"}}/>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              <span style={{fontSize:9,color:T.text4,fontFamily:FONT}}>Prudent</span>
              <span style={{fontSize:9,color:T.text4,fontFamily:FONT}}>Dynamique</span>
            </div>
          </div>
          <div style={{borderLeft:`1px solid ${T.border}`,paddingLeft:16}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text1,marginBottom:8,fontFamily:FONT}}>Matelas de sécurité <InfoBtn title="3 à 6 mois de dépenses recommandés"/></div>
            <BigNum size={20}>4 mois</BigNum>
            <div style={{fontSize:11,color:T.green,marginTop:4,fontFamily:FONT,fontWeight:700}}>✓ Objectif atteint (≥ 3 mois)</div>
          </div>
          <div style={{borderLeft:`1px solid ${T.border}`,paddingLeft:16}}>
            <div style={{fontSize:13,fontWeight:700,color:T.text1,marginBottom:8,fontFamily:FONT}}>Ratio d'endettement <InfoBtn title="Dettes / Actifs — objectif < 33%"/></div>
            <BigNum size={20} color={T.green}>8,1 %</BigNum>
            <div style={{fontSize:11,color:T.green,marginTop:4,fontFamily:FONT,fontWeight:700}}>✓ Excellent ({"<"} 33%)</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : HALAL & ZAKAT
// ══════════════════════════════════════════════════════════════════════════════
function HalalPage() {
  const T = useT();
  const { zakatResult, zakatState, setZakatState, settings, prices, toast, assets, setAssets } = useMizan();
  const [sub, setSub] = useState("zakat");
  const [screeningLoading, setScreeningLoading] = useState({});

  const zr = zakatResult;
  const HAWL_PCT = zr.hawlPct.toFixed(1);
  const HAWL_DAYS = zr.hawlElapsed;
  const HAWL_TOTAL = HAWL_TOTAL_DAYS;

  const startHawl = () => {
    if (zakatState.hawlStart && !window.confirm("Réinitialiser le Hawl ?")) return;
    setZakatState(s => ({...s, hawlStart: new Date().toISOString()}));
    toast("Hawl démarré — 354 jours commencent aujourd'hui");
  };

  const payZakat = () => {
    const amount = zr.totalZakat;
    setZakatState(s => ({
      ...s, hawlStart: new Date().toISOString(), lastPayment: new Date().toISOString(),
      history: [...(s.history||[]), {date:new Date().toLocaleDateString("fr-FR"),amount,madhab:settings.madhab,nissab:Math.round(zr.nissabEur)}],
    }));
    toast(`Zakat de ${fEur(amount)} enregistrée ✓`);
  };

  const screenAsset = async (asset) => {
    if (!settings.zoyaApiKey) { toast("Clé Zoya manquante — voir Paramètres","warn"); return; }
    if (!asset.t||["XAU","XAG","IMM"].includes(asset.t)) { toast("Screening non applicable","warn"); return; }
    setScreeningLoading(s=>({...s,[asset.id]:true}));
    try {
      const result = await API.checkHalal(asset.t, settings.zoyaApiKey);
      if (result) {
        setAssets(prev=>prev.map(a=>a.id===asset.id?{...a,st:result.halalStatus||a.st,score:result.complianceScore||a.score,haramPct:result.haramRevenuePct||a.haramPct,src:"Zoya ✓"}:a));
        toast(`${asset.t} : ${result.halalStatus}`);
      } else { toast(`${asset.t} non trouvé sur Zoya`,"warn"); }
    } catch(e) { toast(`Erreur Zoya: ${e.message}`,"error"); }
    finally { setScreeningLoading(s=>({...s,[asset.id]:false})); }
  };

  const NISSAB_OR = (prices.goldPerGram||94.5) * 85;
  const NISSAB_AG = (prices.silverPerGram||1.08) * 595;
  const MADHAB_LABELS = {hanafi:"Hanafite",maliki:"Malikite",shafii:"Shafi'ite",hanbali:"Hanbalite"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <SubTabs active={sub} onSelect={setSub} tabs={[
        {id:"zakat",label:"Zakat al-Mal"},{id:"purif",label:"Purification"},
        {id:"nissab",label:"Nissab & Hawl"},{id:"screen",label:"Screening"},
      ]}/>

      {sub==="zakat" && (
        <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,marginTop:4}}>
          <Card style={{padding:"24px",display:"flex",flexDirection:"column",alignItems:"center"}}>
            <Label style={{marginBottom:16}}>Hawl · Année Islamique</Label>
            <svg width={160} height={160} aria-label={`Hawl : ${HAWL_PCT}%`}>
              <circle cx={80} cy={80} r={64} fill="none" stroke={T.bgMuted} strokeWidth={10}/>
              <circle cx={80} cy={80} r={64} fill="none"
                stroke="url(#hGrad)" strokeWidth={10}
                strokeDasharray={`${2*Math.PI*64*parseFloat(HAWL_PCT)/100} ${2*Math.PI*64}`}
                strokeLinecap="round" transform="rotate(-90 80 80)"/>
              <defs><linearGradient id="hGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={T.gold}/><stop offset="100%" stopColor={T.goldL}/>
              </linearGradient></defs>
              <text x={80} y={74} textAnchor="middle" fontSize={26} fontWeight={900} fontFamily={FONT} fill={T.text1}>{HAWL_PCT}%</text>
              <text x={80} y={94} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily={FONT} fill={T.text3}>{HAWL_DAYS}/{HAWL_TOTAL}j</text>
            </svg>
            <div style={{fontSize:13,fontWeight:800,color:T.gold,marginTop:12,fontFamily:FONT}}>
              {zr.hawlLeft > 0 ? `≈ ${zr.hawlLeft} jours avant Zakat` : "⚠ Zakat due !"}
            </div>
            <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6,width:"100%"}}>
              {!zakatState.hawlStart
                ? <button onClick={startHawl} style={{padding:"7px 0",borderRadius:T.r6,background:T.gold,color:"#fff",fontSize:11,fontWeight:800,border:"none",cursor:"pointer",fontFamily:FONT}}>▶ Démarrer le Hawl</button>
                : <button onClick={startHawl} style={{padding:"7px 0",borderRadius:T.r6,background:T.bgMuted,color:T.text3,fontSize:11,fontWeight:700,border:`1px solid ${T.border}`,cursor:"pointer",fontFamily:FONT}}>↺ Réinitialiser</button>
              }
              {zr.hawlPct >= 100 && zr.obligatoire && (
                <button onClick={payZakat} style={{padding:"7px 0",borderRadius:T.r6,background:T.green,color:"#fff",fontSize:11,fontWeight:800,border:"none",cursor:"pointer",fontFamily:FONT}}>✓ Enregistrer paiement</button>
              )}
            </div>
          </Card>
          <Card style={{padding:"20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <Label>Détail Zakat al-Mal</Label>
              <span style={{fontSize:10,color:T.text3,fontFamily:FONT}}>Réf. AAOIFI Std. No. 9</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 80px 60px 80px",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
              {["Actif","Base","Coeff.","Zakat"].map(h=>(
                <span key={h} style={{fontSize:10,fontWeight:800,color:T.text3,fontFamily:FONT,textTransform:"uppercase"}}>{h}</span>
              ))}
            </div>
            {zr.rows.filter(r=>r.zakatable>0||r.tp==="Immo").map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 60px 80px",gap:8,padding:"10px 0",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14}}>{r.i}</span>
                  <span style={{fontSize:12,fontWeight:700,color:T.text1,fontFamily:FONT}}>{r.t}</span>
                </div>
                <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{(r.zakBase||0).toLocaleString("fr-FR",{maximumFractionDigits:0})} €</span>
                <span style={{fontSize:11,color:T.text3,fontFamily:FONT,fontWeight:700}}>{Math.round((r.zakRate||0)*100)}%</span>
                <span style={{fontSize:13,fontWeight:800,color:T.gold,fontFamily:FONT}}>{(r.zakat||0).toFixed(2)} €</span>
              </div>
            ))}
            <div style={{padding:"14px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:14,fontWeight:800,color:T.text1,fontFamily:FONT}}>Total Zakat due</span>
              <BigNum size={24} color={T.gold}>{zr.totalZakat.toFixed(2)} €</BigNum>
            </div>
          </Card>
        </div>
      )}

      {sub==="purif" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card style={{padding:"20px",background:T.orangeBg,border:`1px solid ${T.orangeBd}`}}>
            <div style={{fontSize:14,fontWeight:800,color:T.orange,fontFamily:FONT}}>⚠ Purification (Tazkiyah) requise</div>
            <div style={{fontSize:12,color:T.text2,marginTop:8,fontFamily:FONT,lineHeight:1.6}}>
              Vos actifs QUESTIONABLE génèrent des revenus partiellement non-conformes. Vous devez verser en Sadaqah la quote-part haram de vos dividendes et plus-values. Réf. AAOIFI Std. No. 21 §3.2.
            </div>
          </Card>
          {assets.filter(a=>a.st==="QUESTIONABLE"&&(a.div>0||a.gain>0)).map((p,i)=>{
            const divPurif = (p.div||0)*(p.haramPct||0)/100;
            const gainPurif = (p.gain||0)*(p.haramPct||0)/100;
            const total = divPurif+gainPurif;
            return (
              <Card key={i} style={{padding:"20px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:800,color:T.text1,fontFamily:FONT}}>{p.n}</div>
                    <StatusBadge st={p.st}/>
                  </div>
                  <BigNum size={22} color={T.orange}>{total.toFixed(2)} € à purifier</BigNum>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:16}}>
                  {[
                    {l:"Valeur",v:`${p.v.toLocaleString("fr-FR")} €`},
                    {l:"% Haram",v:`${p.haramPct}%`},
                    {l:"Purif. dividendes",v:`${divPurif.toFixed(2)} €`},
                    {l:"Purif. plus-value",v:`${gainPurif.toFixed(2)} €`},
                  ].map((d,j)=>(
                    <div key={j} style={{background:T.bgSoft,borderRadius:T.r8,padding:"10px 12px"}}>
                      <Label>{d.l}</Label>
                      <div style={{fontSize:14,fontWeight:800,color:T.text1,marginTop:4,fontFamily:FONT}}>{d.v}</div>
                    </div>
                  ))}
                </div>
                <button style={{marginTop:14,padding:"8px 20px",borderRadius:T.r6,background:T.green,color:"#fff",fontSize:12,fontWeight:800,border:"none",cursor:"pointer",fontFamily:FONT}}>
                  ✓ Marquer comme purifiée
                </button>
              </Card>
            );
          })}
        </div>
      )}

      {sub==="nissab" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <Card style={{padding:"20px"}}>
            <Label style={{marginBottom:14,display:"block"}}>Conditions du Nissab ({MADHAB_LABELS[settings.madhab]})</Label>
            {[
              {l:`Nissab Or (85g × ${prices.goldPerGram?prices.goldPerGram.toFixed(2):"?"}€)`,v:fEur(NISSAB_OR,0),ok:true,note:"Hawl > 354j requis"},
              {l:`Nissab Argent (595g × ${prices.silverPerGram?prices.silverPerGram.toFixed(3):"?"}€)`,v:fEur(NISSAB_AG,0),ok:true,note:settings.madhab==="hanafi"?"Nissab argent = seuil min (Hanafi)":"Nissab or appliqué"},
              {l:"Votre patrimoine zakatable",v:fEur(zr.totalZakatable,0),ok:zr.obligatoire,note:zr.obligatoire?"Au-dessus du nissab ✓":"En dessous du nissab"},
              {l:"Hawl continu atteint",v:zr.hawlPct>=100?"Oui ✓":zakatState.hawlStart?`${zr.hawlLeft} jours restants`:"Non démarré",ok:zr.hawlPct>=100,note:`${HAWL_TOTAL_DAYS} jours lunaires requis`},
            ].map((c,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:T.text1,fontFamily:FONT}}>{c.l}</div>
                  <div style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{c.note}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:13,fontWeight:800,color:c.ok?T.green:T.orange,fontFamily:FONT}}>{c.v}</div>
                </div>
              </div>
            ))}
          </Card>
          <Card style={{padding:"20px"}}>
            <Label style={{marginBottom:14,display:"block"}}>Profil Sharia</Label>
            {[
              {l:"École juridique",v:MADHAB_LABELS[settings.madhab]||"Hanafite",icon:"📚"},
              {l:"Calendrier",v:"Hijri lunaire (354j)",icon:"🌙"},
              {l:"Taux Zakat",v:"2,5% (1/40 — ijmâ')",icon:"📊"},
              {l:"Tolérance screening",v:"Modérée — score ≥ 60",icon:"⚖"},
              {l:"Bijoux zakatable",v:"Non (usage personnel)",icon:"💍"},
              {l:"API screening",v:settings.zoyaApiKey?"Zoya ✓":"Zoya (clé manquante)",icon:"🔍"},
            ].map((r,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
                <div style={{fontSize:12,fontWeight:700,color:T.text1,fontFamily:FONT}}><span aria-hidden="true">{r.icon} </span>{r.l}</div>
                <div style={{fontSize:12,fontWeight:800,color:T.gold,fontFamily:FONT}}>{r.v}</div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {sub==="screen" && (
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <Label>Screening AAOIFI Std. No. 21</Label>
            {!settings.zoyaApiKey && <span style={{fontSize:10,color:T.orange,fontFamily:FONT}}>⚠ Clé Zoya requise pour le screening live</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px 100px 120px 100px 90px",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
            {["Actif","Score","Secteur","% Illicite","Statut","Action"].map(h=>(
              <span key={h} style={{fontSize:10,fontWeight:800,color:T.text3,fontFamily:FONT,textTransform:"uppercase"}}>{h}</span>
            ))}
          </div>
          {assets.filter(a=>a.v>0||a.st==="HARAM").map((a,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 100px 120px 100px 90px",gap:8,padding:"10px 0",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14}}>{a.i}</span>
                <div>
                  <div style={{fontSize:12,fontWeight:800,color:T.text1,fontFamily:FONT}}>{a.t}</div>
                  <div style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{a.src}</div>
                </div>
              </div>
              <div>{a.score?<ScoreBar score={a.score} st={a.st}/>:<span style={{fontSize:10,color:T.text3,fontFamily:FONT}}>—</span>}</div>
              <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{a.secteur}</span>
              <span style={{fontSize:11,fontWeight:800,color:a.haramPct>0?T.red:T.green,fontFamily:FONT}}>{a.haramPct}%</span>
              <StatusBadge st={a.st}/>
              <button onClick={()=>screenAsset(a)}
                disabled={!settings.zoyaApiKey||screeningLoading[a.id]||["XAU","XAG","IMM","G3F"].includes(a.t)}
                style={{padding:"4px 8px",borderRadius:T.r4,border:`1px solid ${T.border}`,
                  background:"transparent",color:T.text3,fontSize:10,fontWeight:700,
                  cursor:settings.zoyaApiKey?"pointer":"not-allowed",fontFamily:FONT,
                  opacity:settings.zoyaApiKey&&!["XAU","XAG","IMM","G3F"].includes(a.t)?1:0.4}}>
                {screeningLoading[a.id]?"…":"Zoya"}
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BUDGET SANKEY SVG
// ══════════════════════════════════════════════════════════════════════════════
function BudgetSankey({ revenus, enveloppes }) {
  const T = useT();
  const W = 700, H = 320, BAR_W = 28, PAD = 20;
  const leftX = 60, midX = 280, rightX = 530;
  const leftH = H - 2*PAD;
  const totalBudget = enveloppes.reduce((s,e)=>s+e.budget, 0);

  let midCursor = PAD;
  const midNodes = enveloppes.map(env=>{
    const h = Math.max(4, (env.budget/totalBudget)*leftH);
    const node = {...env, y: midCursor, h};
    midCursor += h + 3;
    return node;
  });

  const bezier = (x1,y1,x2,y2) => {
    const cx = (x1+x2)/2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
      <rect x={leftX} y={PAD} width={BAR_W} height={leftH} rx={4} fill="#6366F1" opacity={0.85}/>
      <text x={leftX-6} y={PAD+leftH/2} textAnchor="end" fontSize={11} fontWeight={800} fontFamily={FONT} fill={T.text3}>{revenus.toLocaleString("fr-FR")} €</text>
      {midNodes.map((node, i) => {
        const midBarMidY = node.y + node.h/2;
        const totalSpent = node.items.reduce((s,it)=>s+it.spent,0);
        let rightCursor = node.y;
        const rightBars = node.items.filter(it=>it.spent>0).map(it=>{
          const h = node.h * (it.spent/Math.max(totalSpent,0.01));
          const bar = {name:it.name, y:rightCursor, h:Math.max(2,h)};
          rightCursor += Math.max(2,h) + 1;
          return bar;
        });
        return (
          <g key={node.id}>
            <path d={bezier(leftX+BAR_W, PAD+i*(leftH/enveloppes.length), midX, node.y)}
              stroke={node.color} strokeWidth={Math.max(1,node.h*0.7)} fill="none" opacity={0.25}/>
            <rect x={midX} y={node.y} width={BAR_W} height={node.h} rx={3} fill={node.color} opacity={0.85}/>
            <text x={midX+BAR_W+6} y={midBarMidY+4} fontSize={9} fontWeight={700} fontFamily={FONT} fill={T.text3}>
              {node.name.length>14?node.name.slice(0,14)+"…":node.name}: {node.budget}€
            </text>
            {rightBars.map((rb,j)=>(
              <g key={j}>
                <path d={bezier(midX+BAR_W, midBarMidY, rightX, rb.y+rb.h/2)}
                  stroke={node.color} strokeWidth={Math.max(1,rb.h*0.6)} fill="none" opacity={0.2}/>
                <rect x={rightX} y={rb.y} width={BAR_W} height={rb.h} rx={2} fill={node.color} opacity={0.7}/>
                <text x={rightX+BAR_W+6} y={rb.y+rb.h/2+4} fontSize={8} fontWeight={600} fontFamily={FONT} fill={T.text4}>
                  {rb.name.length>16?rb.name.slice(0,16)+"…":rb.name}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : BUDGET
// ══════════════════════════════════════════════════════════════════════════════
function BudgetPage() {
  const T = useT();
  const { transactions, setTxs, toast } = useMizan();
  const [sub, setSub] = useState("enveloppes");
  const [enveloppes, setEnveloppes] = useState(ENVELOPPES_INIT);
  const [expandedEnv, setExpandedEnv] = useState(new Set(["logement"]));
  const [csvError, setCsvError] = useState("");

  const handleCSVImport = (e) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target.result);
        if (parsed.length === 0) { setCsvError("Aucune transaction détectée — vérifiez le format CSV"); return; }
        setTxs(prev => {
          const existingIds = new Set(prev.map(t=>t.id));
          const newOnes = parsed.filter(t=>!existingIds.has(t.id));
          return [...prev, ...newOnes];
        });
        const haramCount = parsed.filter(t=>!t.ok).length;
        toast(`${parsed.length} transactions importées${haramCount>0?" · "+haramCount+" haram détectées":""}`);
        setCsvError("");
        setSub("transactions");
      } catch(err) { setCsvError("Erreur de lecture: " + err.message); }
    };
    reader.readAsText(file);
  };

  const REVENUS = 3200;
  const totalBudget = enveloppes.reduce((s,e)=>s+e.budget,0);
  const totalSpent  = enveloppes.reduce((s,e)=>s+e.spent,0);
  const envInv = enveloppes.find(e=>e.id==="investissements");
  const totalInvest = envInv ? envInv.budget : 0;
  const tauxEpargne = ((REVENUS-totalBudget+totalInvest)/REVENUS*100).toFixed(1);
  const tauxEpargneMax = ((REVENUS-totalSpent)/REVENUS*100).toFixed(1);

  const toggleEnv = (id) => setExpandedEnv(prev=>{
    const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s;
  });

  const sankeyEnvs = enveloppes.filter(e=>e.id!=="investissements"&&e.id!=="zakat");

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        <MetricCard label="Revenus du mois" value={`${REVENUS.toLocaleString("fr-FR")} €`} accent/>
        <MetricCard label="Dépenses" value={`${totalSpent.toLocaleString("fr-FR")} €`}
          delta={`${(totalSpent/totalBudget*100).toFixed(0)}% du budget`} deltaUp={false}/>
        <MetricCard label="Investissements" value={`${totalInvest.toLocaleString("fr-FR")} €`} sub="Programme mensuel"/>
        <MetricCard label="Taux d'épargne" value={`${tauxEpargne} %`} sub={`Possible : ${tauxEpargneMax}%`}/>
      </div>

      <SubTabs active={sub} onSelect={setSub} tabs={[
        {id:"enveloppes",label:"Enveloppes"},
        {id:"cashflow",label:"Cashflow"},
        {id:"transactions",label:"Transactions"},
      ]}/>

      {sub==="enveloppes" && (
        <div>
          <div style={{fontSize:12,color:T.text3,fontFamily:FONT,marginBottom:14,padding:"10px 14px",
            background:T.blueBg,borderRadius:T.r8,border:`1px solid ${T.border}`}}>
            💡 La méthode des enveloppes vous permet d'allouer chaque euro de votre salaire à un usage précis avant de le dépenser.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12}}>
            {enveloppes.map(env=>{
              const pct = env.budget>0?(env.spent/env.budget*100):0;
              const remaining = env.budget - env.spent;
              const isExpanded = expandedEnv.has(env.id);
              const status = pct>=100?"over":pct>=80?"warn":"ok";
              const statusColor = status==="over"?T.red:status==="warn"?T.orange:T.green;
              return (
                <Card key={env.id} style={{padding:"18px 20px"}}>
                  <button onClick={()=>toggleEnv(env.id)}
                    style={{width:"100%",background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left",outline:"none"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:36,height:36,borderRadius:T.r8,background:`${env.color}15`,border:`1px solid ${env.color}30`,
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                          {env.icon}
                        </div>
                        <div>
                          <div style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT}}>{env.name}</div>
                          <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>{env.spent.toFixed(0)} / {env.budget} € budgétés</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:15,fontWeight:900,color:remaining>=0?statusColor:T.red,fontFamily:FONT}}>
                          {remaining>=0?remaining.toFixed(0):"-"+Math.abs(remaining).toFixed(0)} €
                        </div>
                        <div style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{remaining>=0?"restant":"dépassé"}</div>
                      </div>
                    </div>
                    <div style={{height:6,background:T.bgMuted,borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${Math.min(pct,100)}%`,
                        background:pct>=100?T.red:pct>=80?T.orange:env.color,borderRadius:3,transition:"width .4s ease"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                      <span style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{pct.toFixed(0)}% utilisé</span>
                      <span style={{fontSize:10,color:T.text4,fontFamily:FONT}}>{isExpanded?"▲":"▼"} Détail</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div style={{marginTop:14,borderTop:`1px solid ${T.border}`,paddingTop:12}}>
                      {env.items.map((item,j)=>{
                        const itemPct = item.amount>0?(item.spent/item.amount*100):0;
                        return (
                          <div key={j} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                              <span style={{fontSize:11,fontWeight:700,color:T.text1,fontFamily:FONT}}>{item.name}</span>
                              <span style={{fontSize:11,fontWeight:800,color:item.spent>0?T.text1:T.text4,fontFamily:FONT}}>
                                {item.spent.toFixed(0)} / {item.amount} €
                              </span>
                            </div>
                            <div style={{height:3,background:T.bgMuted,borderRadius:2}}>
                              <div style={{height:"100%",width:`${itemPct}%`,background:env.color,opacity:0.7,borderRadius:2}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {sub==="cashflow" && (
        <Card style={{padding:"24px"}}>
          <div style={{marginBottom:16}}>
            <Label>Flux de trésorerie — Fév. 2026</Label>
            <div style={{fontSize:12,color:T.text2,marginTop:6,fontFamily:FONT}}>
              Taux d'épargne : <strong style={{color:T.green}}>{tauxEpargne}%</strong> · 
              Revenus : <strong>{REVENUS.toLocaleString("fr-FR")} €</strong> → 
              Dépenses : <strong>{totalSpent.toLocaleString("fr-FR")} €</strong>. 
              Reste : <strong style={{color:T.gold}}>{(REVENUS-totalSpent-totalInvest).toLocaleString("fr-FR")} €</strong>
            </div>
          </div>
          <BudgetSankey revenus={REVENUS} enveloppes={sankeyEnvs}/>
        </Card>
      )}

      {sub==="transactions" && (
        <Card style={{padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <Label>Transactions ({transactions.length})</Label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {csvError && <span style={{fontSize:11,color:T.red,fontFamily:FONT}}>{csvError}</span>}
              <label style={{padding:"7px 16px",borderRadius:T.r6,background:T.gold,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:FONT}}>
                📂 Importer CSV
                <input type="file" accept=".csv,.tsv,.ofx" onChange={handleCSVImport} style={{display:"none"}}/>
              </label>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 120px 120px 80px 90px",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
            {["Transaction","Catégorie","Enveloppe","Date","Montant"].map(h=>(
              <span key={h} style={{fontSize:10,fontWeight:800,color:T.text3,fontFamily:FONT,textTransform:"uppercase"}}>{h}</span>
            ))}
          </div>
          {transactions.map((tr,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 120px 120px 80px 90px",
              gap:8,padding:"12px 0",borderBottom:`1px solid ${T.border}`,alignItems:"center",
              background:tr.ok?undefined:T.redBg}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16}}>{tr.i}</span>
                <div>
                  <div style={{fontSize:12,fontWeight:800,color:T.text1,fontFamily:FONT}}>{tr.n}</div>
                  <div style={{fontSize:10,color:T.text3,fontFamily:FONT}}>{tr.sub}</div>
                </div>
                {!tr.ok && <span style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:T.r4,background:T.red,color:"#fff",fontFamily:FONT}}>HARAM</span>}
              </div>
              <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{tr.c}</span>
              <span style={{fontSize:11,color:T.text3,fontFamily:FONT,fontWeight:600}}>{tr.cat}</span>
              <span style={{fontSize:11,color:T.text3,fontFamily:FONT}}>{tr.d}</span>
              <span style={{fontSize:13,fontWeight:800,color:tr.a>0?T.green:tr.ok?T.text1:T.red,fontFamily:FONT,textAlign:"right"}}>
                {tr.a>0?"+":""}{tr.a.toLocaleString("fr-FR",{minimumFractionDigits:2})} €
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsPage() {
  const T = useT();
  const [sub, setSub] = useState("simulateur");
  const [simState, setSimState] = useState({
    patrimoine:74350,repartitionBourse:70,investAnnuel:6000,repartitionInvest:70,
    annees:20,rendementBourse:8,rendementAutre:4,tauxImposBourse:17.2,
    tauxImposAutre:30,tauxRetrait:3.5,inflation:2.5,
  });
  const [calcState, setCalcState] = useState({capital:10000,mensuelle:200,horizon:20,rendement:7,periodicite:12});

  const upSim = (k,v) => setSimState(s=>({...s,[k]:parseFloat(v)||0}));
  const upCalc = (k,v) => setCalcState(s=>({...s,[k]:parseFloat(v)||0}));

  const simResult = useMemo(()=>{
    const {patrimoine,repartitionBourse,investAnnuel,repartitionInvest,annees,rendementBourse,rendementAutre,tauxImposBourse,tauxImposAutre,tauxRetrait} = simState;
    const pctB=repartitionBourse/100,pctA=1-pctB,pctIB=repartitionInvest/100,pctIA=1-pctIB;
    const rB=rendementBourse/100,rA=rendementAutre/100;
    let bourse=patrimoine*pctB,autre=patrimoine*pctA;
    const data=[{an:0,bourse,autre,total:patrimoine}];
    for(let y=1;y<=annees;y++){
      bourse=bourse*(1+rB)+investAnnuel*pctIB;
      autre=autre*(1+rA)+investAnnuel*pctIA;
      data.push({an:y,bourse:Math.round(bourse),autre:Math.round(autre),total:Math.round(bourse+autre)});
    }
    const last=data[data.length-1];
    const versements=patrimoine+investAnnuel*annees;
    const plusValue=last.total-versements;
    const impotB=Math.max(0,last.bourse-patrimoine*pctB-investAnnuel*pctIB*annees)*tauxImposBourse/100;
    const impotA=Math.max(0,last.autre-patrimoine*pctA-investAnnuel*pctIA*annees)*tauxImposAutre/100;
    const valeurNette=last.total-impotB-impotA;
    const revenuMensuel=Math.round(valeurNette*tauxRetrait/100/12);
    return {data,valeurFuture:last.total,plusValue,impotB,impotA,valeurNette,revenuMensuel,versements};
  },[simState]);

  const calcResult = useMemo(()=>{
    const {capital,mensuelle,horizon,rendement,periodicite}=calcState;
    const r=rendement/(100*periodicite),n=horizon*periodicite;
    const capitalFinal=capital*Math.pow(1+r,n)+mensuelle*(Math.pow(1+r,n)-1)/r*(12/periodicite);
    const versements=capital+mensuelle*12*horizon;
    const interets=capitalFinal-versements;
    const data=Array.from({length:horizon+1},(_,y)=>{
      const nn=y*periodicite;
      const cf=capital*Math.pow(1+r,nn)+(nn>0?mensuelle*(Math.pow(1+r,nn)-1)/r*(12/periodicite):0);
      const v=capital+mensuelle*12*y;
      return {an:y,total:Math.round(cf),versements:Math.round(v),interets:Math.max(0,Math.round(cf-v))};
    });
    return {capitalFinal:Math.round(capitalFinal),versements:Math.round(versements),interets:Math.round(interets),data};
  },[calcState]);

  const PASSIVE_INCOME=[{m:"Jan",v:320},{m:"Fév",v:380},{m:"Mar",v:400},{m:"Avr",v:420},{m:"Mai",v:410},{m:"Jun",v:450},{m:"Jul",v:440},{m:"Aoû",v:480},{m:"Sep",v:520},{m:"Oct",v:500},{m:"Nov",v:540},{m:"Déc",v:580}];

  const SliderField=({label,k,min,max,step=1,unit="",state,onUp})=>(
    <div style={{marginBottom:18}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:12,color:T.text3,fontFamily:FONT,fontWeight:600}}>{label}</span>
        <span style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT}}>
          {typeof state[k]==="number"?state[k].toLocaleString("fr-FR"):state[k]} {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={state[k]}
        onChange={e=>onUp(k,e.target.value)} aria-label={label}/>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <SubTabs active={sub} onSelect={setSub} tabs={[
        {id:"simulateur",label:"Simulateur de patrimoine"},
        {id:"calcul",label:"Rendement halal composé"},
        {id:"passif",label:"Revenus passifs"},
      ]}/>

      {sub==="simulateur" && (
        <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16,marginTop:4}}>
          <Card style={{padding:"24px"}}>
            <Label style={{marginBottom:20,display:"block"}}>Modifier la simulation</Label>
            <SliderField label="Patrimoine actuel" k="patrimoine" min={0} max={500000} step={1000} unit="EUR" state={simState} onUp={upSim}/>
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:11,fontWeight:800,color:T.gold,fontFamily:FONT}}>Bourse halal {simState.repartitionBourse}%</span>
                <span style={{fontSize:11,fontWeight:800,color:T.text3,fontFamily:FONT}}>Autre {100-simState.repartitionBourse}%</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={simState.repartitionBourse} onChange={e=>upSim("repartitionBourse",e.target.value)} aria-label="Répartition patrimoine"/>
            </div>
            <SliderField label="Investissements annuels" k="investAnnuel" min={0} max={50000} step={500} unit="EUR" state={simState} onUp={upSim}/>
            <SliderField label="Nombre d'années" k="annees" min={1} max={40} unit="ANS" state={simState} onUp={upSim}/>
            <SliderField label="Rendement bourse halal" k="rendementBourse" min={1} max={20} step={0.5} unit="%" state={simState} onUp={upSim}/>
            <SliderField label="Rendement autre" k="rendementAutre" min={0} max={15} step={0.5} unit="%" state={simState} onUp={upSim}/>
            <SliderField label="Taux d'imposition bourse" k="tauxImposBourse" min={0} max={45} step={0.1} unit="%" state={simState} onUp={upSim}/>
            <SliderField label="Taux de retrait (FIRE Halal)" k="tauxRetrait" min={1} max={6} step={0.1} unit="%" state={simState} onUp={upSim}/>
            <SliderField label="Inflation" k="inflation" min={0} max={8} step={0.1} unit="%" state={simState} onUp={upSim}/>
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card style={{padding:"24px"}}>
              <Label style={{marginBottom:4,display:"block"}}>Au bout de {simState.annees} ans, vous pouvez générer</Label>
              <BigNum size={36} color={T.gold}>{simResult.revenuMensuel.toLocaleString("fr-FR")} €/mois</BigNum>
              <div style={{fontSize:13,color:T.text2,marginTop:4,fontFamily:FONT}}>
                de revenu passif halal pour un capital de <strong style={{color:T.text1}}>{simResult.valeurNette.toLocaleString("fr-FR")} € net</strong>
              </div>
            </Card>
            <Card style={{padding:"20px 20px 12px"}}>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={simResult.data.filter((_,i)=>i%Math.max(1,Math.floor(simResult.data.length/20))===0||i===simResult.data.length-1)} margin={{top:4,right:0,bottom:0,left:0}}>
                  <defs>
                    <linearGradient id="gBourse" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={T.gold} stopOpacity={0.4}/><stop offset="95%" stopColor={T.gold} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gAutre" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={T.blue} stopOpacity={0.3}/><stop offset="95%" stopColor={T.blue} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="an" tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} tickFormatter={v=>`${v}a`} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Area type="monotone" dataKey="bourse" stackId="1" stroke={T.gold} fill="url(#gBourse)" name="Bourse halal"/>
                  <Area type="monotone" dataKey="autre" stackId="1" stroke={T.blue} fill="url(#gAutre)" name="Autre"/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
              {[
                {l:"Valeur future",v:`${simResult.valeurFuture.toLocaleString("fr-FR")} €`,c:T.text1},
                {l:"Dont plus-value",v:`${simResult.plusValue.toLocaleString("fr-FR")} €`,c:T.green},
                {l:"Valeur nette",v:`${simResult.valeurNette.toLocaleString("fr-FR")} €`,c:T.blue},
                {l:"Revenu mensuel",v:`${simResult.revenuMensuel.toLocaleString("fr-FR")} €`,c:T.gold},
              ].map((m,i)=>(
                <div key={i} style={{background:T.bgSoft,borderRadius:T.r10,padding:"14px 16px"}}>
                  <Label style={{display:"block",marginBottom:6}}>{m.l}</Label>
                  <div style={{fontSize:17,fontWeight:900,color:m.c,fontFamily:FONT}}>{m.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sub==="calcul" && (
        <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16,marginTop:4}}>
          <Card style={{padding:"24px"}}>
            <Label style={{marginBottom:20,display:"block"}}>Paramètres — Rendement Halal</Label>
            <div style={{fontSize:11,color:T.orange,fontFamily:FONT,marginBottom:16,padding:"8px 12px",background:T.orangeBg,borderRadius:T.r6}}>
              ⚠ L'Islam interdit les intérêts (Riba). Ce simulateur modélise des <strong>rendements halal</strong> issus de la participation aux bénéfices.
            </div>
            {[
              {label:"Capital initial",k:"capital",min:0,max:200000,step:1000,unit:"EUR"},
              {label:"Épargne mensuelle",k:"mensuelle",min:0,max:5000,step:50,unit:"EUR"},
              {label:"Horizon de placement",k:"horizon",min:1,max:40,step:1,unit:"ANNÉES"},
              {label:"Rendement annuel",k:"rendement",min:1,max:20,step:0.5,unit:"%"},
              {label:"Intervalle capitalisation",k:"periodicite",min:1,max:12,step:1,unit:"MOIS"},
            ].map(f=>(
              <div key={f.k} style={{marginBottom:18}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,color:T.text3,fontFamily:FONT,fontWeight:600}}>{f.label}</span>
                  <span style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT}}>{calcState[f.k].toLocaleString("fr-FR")} {f.unit}</span>
                </div>
                <input type="range" min={f.min} max={f.max} step={f.step} value={calcState[f.k]} onChange={e=>upCalc(f.k,e.target.value)} aria-label={f.label}/>
              </div>
            ))}
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card style={{padding:"24px",textAlign:"center"}}>
              <Label>Capital final</Label>
              <BigNum size={40} color={T.gold} style={{margin:"10px 0"}}>{calcResult.capitalFinal.toLocaleString("fr-FR")} €</BigNum>
              <div style={{display:"flex",justifyContent:"center",gap:40}}>
                <div>
                  <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>Versements</div>
                  <div style={{fontSize:16,fontWeight:800,color:T.blue,fontFamily:FONT}}>{calcResult.versements.toLocaleString("fr-FR")} €</div>
                </div>
                <div>
                  <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>Rendements</div>
                  <div style={{fontSize:16,fontWeight:800,color:T.green,fontFamily:FONT}}>{calcResult.interets.toLocaleString("fr-FR")} €</div>
                </div>
              </div>
            </Card>
            <Card style={{padding:"20px 20px 12px"}}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={calcResult.data} margin={{top:4,right:0,bottom:0,left:0}}>
                  <defs>
                    <linearGradient id="gVers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={T.blue} stopOpacity={0.4}/><stop offset="95%" stopColor={T.blue} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gInt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={T.gold} stopOpacity={0.5}/><stop offset="95%" stopColor={T.gold} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="an" tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} tickFormatter={v=>`${v}a`} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Area type="monotone" dataKey="versements" stroke={T.blue} fill="url(#gVers)" name="Versements"/>
                  <Area type="monotone" dataKey="total" stroke={T.gold} fill="url(#gInt)" name="Capital total"/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </div>
      )}

      {sub==="passif" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <MetricCard label="Revenus passifs (mois)" value="580 €" delta="+7,4% vs N-1" deltaUp/>
            <MetricCard label="Rendement global" value="3,8 %" sub="Dividendes + loyers + forêt"/>
            <MetricCard label="Objectif FIRE Halal" value="2 400 €/mois" sub="Dépenses × 1 / 3,5%"/>
          </div>
          <Card style={{padding:"20px 20px 12px"}}>
            <Label style={{marginBottom:14,display:"block"}}>Évolution des revenus passifs</Label>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={PASSIVE_INCOME} margin={{top:0,right:0,bottom:0,left:0}}>
                <XAxis dataKey="m" tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:T.text3,fontFamily:FONT,fontWeight:700}} axisLine={false} tickLine={false}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Bar dataKey="v" fill={T.gold} radius={[3,3,0,0]} name="Revenus passifs"/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : IMPÔTS
// ══════════════════════════════════════════════════════════════════════════════
function ImpotsPage() {
  const T = useT();
  const [sub, setSub] = useState("situation");
  const [tmb, setTmb] = useState(30);
  const [flatTaxOu, setFlatTaxOu] = useState("flat");

  const PEA_ENCOURS = 12500, PEA_PLAFOND = 150000;
  const TOTAL_PV = PLUS_VALUES_FISCAL.reduce((s,p)=>s+p.gain,0);
  const IMPOTS_FLAT = PLUS_VALUES_FISCAL.reduce((s,p)=>s+p.ir+p.ps,0);
  const IMPOTS_BAREME = PLUS_VALUES_FISCAL.reduce((s,p)=>s+(p.gain*tmb/100+p.ps),0);

  const REGIMES = [
    {cat:"PEA (> 5 ans)",taux:17.2,note:"0% IR + 17,2% PS seulement",icon:"🟢",tip:"Priorité absolue — toute action UE éligible halal.",color:T.green,score:10},
    {cat:"Assurance-Vie (> 8 ans)",taux:"7,5% + PS",note:"Abattement 4 600€/an",icon:"🟡",tip:"Idéal pour SCPI islamique & forêts.",color:T.gold,score:8},
    {cat:"Flat Tax / PFU",taux:30,note:"12,8% IR + 17,2% PS",icon:"🟠",tip:"Évitable avec PEA.",color:T.orange,score:5},
    {cat:"Crypto (Art. 150 VH)",taux:30,note:"Journal des cessions obligatoire (2086)",icon:"🟡",tip:"Cessions < 305€/an exonérées.",color:T.orange,score:5},
    {cat:"Métaux précieux",taux:11.5,note:"11,5% forfaitaire sur la vente brute",icon:"🟢",tip:"Abattement durée disponible.",color:T.green,score:7},
    {cat:"Immobilier (PV)",taux:36.2,note:"19% IR + 17,2% PS — abatt. par durée",icon:"🟡",tip:"Exonération IR 100% après 22 ans.",color:T.blue,score:6},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <SubTabs active={sub} onSelect={setSub} tabs={[
        {id:"situation",label:"Ma situation fiscale"},
        {id:"pv",label:"Plus-values"},
        {id:"enveloppes",label:"Enveloppes fiscales"},
        {id:"optim",label:"Optimisation"},
      ]}/>

      {sub==="situation" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card style={{padding:"20px"}}>
            <Label style={{marginBottom:16,display:"block"}}>Tranche Marginale d'Imposition (TMI)</Label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[0,11,30,41,45].map(t=>(
                <button key={t} onClick={()=>setTmb(t)}
                  style={{padding:"10px 20px",borderRadius:T.r8,fontSize:14,fontWeight:800,
                    background:tmb===t?T.gold:"transparent",color:tmb===t?"#fff":T.text2,
                    border:`2px solid ${tmb===t?T.gold:T.border}`,cursor:"pointer",outline:"none",fontFamily:FONT}}>
                  {t}%
                </button>
              ))}
            </div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
            <MetricCard label="Revenus imposables" value="38 400 €" sub="Salaire net déclaré"/>
            <MetricCard label="Impôt estimé (IR)" value="4 200 €" sub="Barème progressif"/>
            <MetricCard label="Taux effectif" value="10,9 %" sub="Vs TMI 30%"/>
            <MetricCard label="Plus-values latentes" value={`${TOTAL_PV.toLocaleString("fr-FR")} €`} sub="Impôts différés"/>
          </div>
          <Card style={{padding:"20px"}}>
            <Label style={{marginBottom:14,display:"block"}}>Flat Tax vs Barème progressif</Label>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {[{id:"flat",lb:"Flat Tax (PFU 30%)"},{id:"bareme",lb:`Barème (TMI ${tmb}%)`}].map(o=>(
                <button key={o.id} onClick={()=>setFlatTaxOu(o.id)}
                  style={{padding:"8px 18px",borderRadius:T.r6,fontSize:12,fontWeight:800,
                    background:flatTaxOu===o.id?T.text1:"transparent",color:flatTaxOu===o.id?T.bg:T.text2,
                    border:`1px solid ${flatTaxOu===o.id?T.text1:T.border}`,cursor:"pointer",outline:"none",fontFamily:FONT}}>
                  {o.lb}
                </button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <div style={{background:flatTaxOu==="flat"?T.greenBg:T.bgSoft,borderRadius:T.r10,padding:"16px 20px",border:`1px solid ${flatTaxOu==="flat"?T.greenBd:T.border}`}}>
                <div style={{fontSize:13,fontWeight:800,color:T.text1,marginBottom:4,fontFamily:FONT}}>Flat Tax (PFU 30%)</div>
                <BigNum size={28} color={flatTaxOu==="flat"?T.green:T.text1}>{IMPOTS_FLAT.toFixed(0)} €</BigNum>
              </div>
              <div style={{background:flatTaxOu==="bareme"?T.greenBg:T.bgSoft,borderRadius:T.r10,padding:"16px 20px",border:`1px solid ${flatTaxOu==="bareme"?T.greenBd:T.border}`}}>
                <div style={{fontSize:13,fontWeight:800,color:T.text1,marginBottom:4,fontFamily:FONT}}>Barème progressif (TMI {tmb}%)</div>
                <BigNum size={28} color={IMPOTS_BAREME<IMPOTS_FLAT?T.green:T.red}>{IMPOTS_BAREME.toFixed(0)} €</BigNum>
                {IMPOTS_BAREME<IMPOTS_FLAT
                  ? <div style={{fontSize:11,color:T.green,marginTop:8,fontWeight:800,fontFamily:FONT}}>✓ Économie {(IMPOTS_FLAT-IMPOTS_BAREME).toFixed(0)} €</div>
                  : <div style={{fontSize:11,color:T.red,marginTop:8,fontWeight:800,fontFamily:FONT}}>✗ Plus coûteux de {(IMPOTS_BAREME-IMPOTS_FLAT).toFixed(0)} €</div>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {sub==="pv" && (
        <Card style={{padding:"20px"}}>
          <Label style={{marginBottom:14,display:"block"}}>Plus-values par actif</Label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px 100px 140px 80px 80px 90px",gap:8,padding:"8px 0",borderBottom:`1px solid ${T.border}`,marginBottom:4}}>
            {["Actif","Plus-value","Durée","Régime","IR","PS","Net"].map(h=>(
              <span key={h} style={{fontSize:10,fontWeight:800,color:T.text3,fontFamily:FONT,textTransform:"uppercase"}}>{h}</span>
            ))}
          </div>
          {PLUS_VALUES_FISCAL.map((p,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 100px 140px 80px 80px 90px",gap:8,padding:"12px 0",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>{p.icon}</span>
                <span style={{fontSize:12,fontWeight:800,color:T.text1,fontFamily:FONT}}>{p.n}</span>
              </div>
              <span style={{fontSize:12,fontWeight:800,color:p.gain>0?T.green:T.text3,fontFamily:FONT}}>{p.gain>0?"+":""}{p.gain.toLocaleString("fr-FR")} €</span>
              <span style={{fontSize:11,color:T.text2,fontFamily:FONT,fontWeight:600}}>{p.duree}</span>
              <span style={{fontSize:10,color:T.text2,fontFamily:FONT,fontWeight:700,padding:"3px 7px",borderRadius:T.r4,background:T.bgMuted}}>{p.regime}</span>
              <span style={{fontSize:12,fontWeight:800,color:p.ir>0?T.red:T.green,fontFamily:FONT}}>{p.ir>0?"-"+p.ir.toFixed(0):"0"} €</span>
              <span style={{fontSize:12,fontWeight:800,color:T.orange,fontFamily:FONT}}>-{p.ps.toFixed(0)} €</span>
              <span style={{fontSize:13,fontWeight:900,color:T.text1,fontFamily:FONT}}>{p.net.toFixed(0)} €</span>
            </div>
          ))}
        </Card>
      )}

      {sub==="enveloppes" && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card style={{padding:"20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <Label>PEA — Plan d'Épargne en Actions</Label>
                <div style={{fontSize:13,fontWeight:800,color:T.text1,marginTop:6,fontFamily:FONT}}>
                  {PEA_ENCOURS.toLocaleString("fr-FR")} € / {PEA_PLAFOND.toLocaleString("fr-FR")} € plafond
                </div>
              </div>
              <PnLBadge up={true}>Ouvert — {((PEA_ENCOURS/PEA_PLAFOND)*100).toFixed(1)}% utilisé</PnLBadge>
            </div>
            <div style={{height:8,background:T.bgMuted,borderRadius:4,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",width:`${(PEA_ENCOURS/PEA_PLAFOND)*100}%`,
                background:`linear-gradient(90deg,${T.gold},${T.goldL})`,borderRadius:4}}/>
            </div>
            <div style={{fontSize:12,color:T.text2,fontFamily:FONT,lineHeight:1.6,background:T.bgSoft,borderRadius:T.r8,padding:"12px 14px"}}>
              <strong>Avantage :</strong> 0% IR + 17,2% PS après 5 ans. ETF islamiques physiques (ISAC, HIWO, ISEM) éligibles si domiciliés UE.
              <div style={{marginTop:6,color:T.green,fontWeight:700}}>✓ PEA ouvert depuis {">"}5 ans — avantage fiscal actif</div>
            </div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {REGIMES.map((r,i)=>(
              <Card key={i} style={{padding:"16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{fontSize:18}}>{r.icon}</div>
                  <div style={{display:"flex",gap:3}}>
                    {Array.from({length:10}).map((_,j)=>(
                      <div key={j} style={{width:4,height:12,borderRadius:1,background:j<r.score?r.color:T.bgMuted}}/>
                    ))}
                  </div>
                </div>
                <div style={{fontSize:12,fontWeight:800,color:T.text1,marginBottom:4,fontFamily:FONT}}>{r.cat}</div>
                <div style={{fontSize:11,color:T.text3,marginBottom:8,fontFamily:FONT}}>{r.note}</div>
                <div style={{fontSize:11,color:T.text2,fontFamily:FONT,lineHeight:1.5}}>{r.tip}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {sub==="optim" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {[
            {type:"ok",title:"PEA actif avec ISAC islamique",desc:"Votre ETF ISAC en PEA bénéficie de 0% IR. Continuez à augmenter vos versements jusqu'au plafond de 150k€.",saving:"~3 400 € économisés/an vs CTO"},
            {type:"ok",title:"Or et argent physiques — Régime avantageux",desc:"11,5% forfaitaire sur vente. Mieux que la flat tax à 30%.",saving:"Taux favorable"},
            {type:"warn",title:"Crypto — Journal de cessions à tenir",desc:"Chaque vente, échange ou achat en BTC est une cession imposable. Utilisez Waltio ou Cryptio (formulaire 2086).",action:"Mettre à jour le journal"},
            {type:"action",title:"Amazon & Microsoft en CTO → Déménager vers PEA",desc:"Vos actions US en CTO subissent la flat tax 30%. Réinvestir via ETF islamique en PEA.",action:"Réallouer dès cession",saving:"Économie potentielle : ~1 200 €/an"},
            {type:"action",title:"CW8 HARAM à solder — Impact fiscal nul",desc:"La cession du CW8 (valeur 0€) ne génère aucune plus-value imposable. Solder immédiatement.",action:"Solder immédiatement"},
          ].map((tip,i)=>(
            <Card key={i} style={{padding:"18px 20px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{display:"flex",gap:12}}>
                  <span style={{fontSize:18,flexShrink:0}}>{tip.type==="ok"?"✅":tip.type==="warn"?"⚠️":"🔴"}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT,marginBottom:4}}>{tip.title}</div>
                    <div style={{fontSize:12,color:T.text2,fontFamily:FONT,lineHeight:1.6}}>{tip.desc}</div>
                    {tip.saving && <div style={{fontSize:11,color:T.green,marginTop:6,fontWeight:800,fontFamily:FONT}}>{tip.saving}</div>}
                  </div>
                </div>
                {tip.action && (
                  <button style={{padding:"7px 16px",borderRadius:T.r6,fontSize:11,fontWeight:800,
                    background:tip.type==="action"?T.red:T.gold,color:"#fff",
                    border:"none",cursor:"pointer",fontFamily:FONT,flexShrink:0,marginLeft:16}}>
                    {tip.action}
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : IA CORTEX
// ══════════════════════════════════════════════════════════════════════════════
function CortexPage() {
  const T = useT();
  const { settings, zakatResult, assets, prices } = useMizan();
  const [msgs, setMsgs] = useState([
    {r:"ai",t:"بِسْمِ اللهِ — Assalamu alaykum ! Je suis votre assistant MIZAN. Comment puis-je vous aider ?"}
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(settings.iaProvider || "gemini");
  const endRef = useRef(null);
  useEffect(()=>{ if(endRef.current) endRef.current.scrollIntoView({behavior:"smooth"}); },[msgs,loading]);

  const SUGGESTIONS = [
    "Que dois-je savoir sur ma Zakat cette année ?",
    "Mes actifs QUESTIONABLE nécessitent-ils une purification ?",
    "Comment optimiser mon portefeuille halal ?",
    "Expliquez-moi le Nissab et le Hawl",
    "Quels sont mes risques de diversification ?",
  ];

  const buildContext = () => {
    const totalV = assets.reduce((s,a)=>s+a.v,0);
    const halalPct = totalV>0?(assets.filter(a=>a.st==="HALAL").reduce((s,a)=>s+a.v,0)/totalV*100).toFixed(0):0;
    return [
      `École: ${settings.madhab}`,
      `Patrimoine: ${Math.round(totalV/1000)}k€ (${halalPct}% halal)`,
      `Nissab: ${Math.round(zakatResult.nissabEur)}€ | Obligatoire: ${zakatResult.obligatoire?"oui":"non"}`,
      `Zakat due: ${zakatResult.totalZakat.toFixed(0)}€ | Hawl: ${zakatResult.hawlPct.toFixed(0)}%`,
      `BTC: ${prices.btc?Math.round(prices.btc)+"€":"inconnu"} | Or: ${prices.goldPerGram?prices.goldPerGram.toFixed(2)+"€/g":"inconnu"}`,
    ].join(" | ");
  };

  const SYSTEM = `Tu es l'assistant IA de MIZAN, application de finance islamique. Contexte: {CTX}. Règles: Tu expliques les résultats calculés par MIZAN. Tu ne recalcules JAMAIS. Tu cites AAOIFI. Tu réponds en français concis (max 200 mots).`;

  const send = async () => {
    if (!input.trim()) return;
    const q = input.trim();
    const history = [...msgs, {r:"user",t:q}];
    setMsgs(history);
    setInput("");
    setLoading(true);
    try {
      const key = model === "groq" ? settings.groqKey : settings.geminiKey;
      if (!key) throw new Error(`Clé API ${model==="groq"?"Groq":"Gemini"} manquante — ajoutez-la dans Paramètres`);
      const ctx = buildContext();
      const system = SYSTEM.replace("{CTX}", ctx);
      const reply = model === "groq" ? await API.askGroq(history, system, key) : await API.askGemini(history, system, key);
      setMsgs(m=>[...m,{r:"ai",t:reply}]);
    } catch(e) {
      setMsgs(m=>[...m,{r:"ai",t:`❌ Erreur: ${e.message}`}]);
    } finally { setLoading(false); }
  };

  const PROVIDERS = [
    {id:"gemini",lb:"☁ Gemini 2.0 Flash",hasKey:!!settings.geminiKey},
    {id:"groq",lb:"⚡ Groq Llama 3.1",hasKey:!!settings.groqKey},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 180px)",gap:0}}>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        {PROVIDERS.map(m=>(
          <button key={m.id} onClick={()=>setModel(m.id)}
            style={{padding:"6px 14px",fontSize:11,fontWeight:800,borderRadius:T.r6,
              background:model===m.id?T.text1:"transparent",color:model===m.id?T.bg:T.text2,
              border:`1px solid ${model===m.id?T.text1:T.border}`,cursor:"pointer",outline:"none",fontFamily:FONT}}>
            {m.lb} {!m.hasKey&&<span style={{color:T.orange}}>⚠</span>}
          </button>
        ))}
        {!(PROVIDERS.find(p=>p.id===model)&&PROVIDERS.find(p=>p.id===model).hasKey) && (
          <span style={{fontSize:11,color:T.orange,fontFamily:FONT}}>Clé manquante — configurer dans Paramètres</span>
        )}
        <button onClick={()=>setMsgs(msgs.slice(0,1))}
          style={{marginLeft:"auto",padding:"4px 10px",borderRadius:T.r4,background:"transparent",
            border:`1px solid ${T.border}`,color:T.text3,fontSize:10,cursor:"pointer",fontFamily:FONT}}>
          Effacer
        </button>
      </div>
      {msgs.length===1 && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
          {SUGGESTIONS.map((s,i)=>(
            <button key={i} onClick={()=>setInput(s)}
              style={{padding:"6px 12px",borderRadius:T.r6,background:T.goldBg,
                border:`1px solid ${T.goldBd}`,color:T.gold,fontSize:11,fontWeight:700,
                cursor:"pointer",fontFamily:FONT}}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12,padding:"4px 0"}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.r==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"72%",padding:"12px 16px",borderRadius:T.r10,
              background:m.r==="user"?T.text1:T.bgCard,color:m.r==="user"?T.bg:T.text1,
              border:m.r==="ai"?`1px solid ${T.border}`:"none",
              fontSize:13,fontFamily:FONT,fontWeight:500,lineHeight:1.6,whiteSpace:"pre-wrap"}}>
              {m.t}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{display:"flex",justifyContent:"flex-start"}}>
            <div style={{padding:"12px 16px",borderRadius:T.r10,background:T.bgCard,border:`1px solid ${T.border}`}}>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <span style={{fontSize:11,color:T.text3,fontFamily:FONT}}>Réflexion</span>
                {[0,1,2].map(j=>(
                  <div key={j} style={{width:7,height:7,borderRadius:"50%",background:T.gold,
                    animation:`mzDot 1.4s ease-in-out ${j*0.16}s infinite`}}/>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <div style={{marginTop:12,display:"flex",gap:8}}>
        <textarea
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
          placeholder="Posez votre question islamique / patrimoniale… (Entrée pour envoyer)"
          rows={2}
          style={{flex:1,padding:"12px 14px",borderRadius:T.r8,border:`1px solid ${T.border}`,
            background:T.bgCard,color:T.text1,fontSize:13,fontFamily:FONT,resize:"none",outline:"none"}}
        />
        <button onClick={send} disabled={!input.trim()||loading}
          style={{padding:"12px 20px",borderRadius:T.r8,background:T.gold,color:"#fff",
            border:"none",cursor:input.trim()&&!loading?"pointer":"default",
            opacity:input.trim()&&!loading?1:0.5,fontSize:16,outline:"none"}}>
          ↑
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE : PARAMÈTRES
// ══════════════════════════════════════════════════════════════════════════════
function SettingsPage({ darkMode, setDarkMode }) {
  const T = useT();
  const { settings, setSettings, prices, zakatState, setZakatState, toast, resetAll } = useMizan();
  const [liveGold, setLiveGold] = useState(null);
  const [testingGold, setTestingGold] = useState(false);
  const [saved, setSaved] = useState(false);

  const upd = (k, v) => setSettings(s=>({...s,[k]:v}));

  const testGoldKey = async () => {
    if (!settings.goldApiKey) return;
    setTestingGold(true);
    try {
      const r = await API.fetchMetals(settings.goldApiKey);
      if (r && r.goldPerGram) setLiveGold(r);
      else toast("Clé invalide ou limite atteinte","warn");
    } catch(e) { toast("Erreur: " + e.message,"error"); }
    finally { setTestingGold(false); }
  };

  const save = () => { setSaved(true); toast("Paramètres sauvegardés ✓"); setTimeout(()=>setSaved(false),2000); };

  const Section = ({title,children})=>(
    <Card style={{padding:"20px",marginBottom:0}}>
      <Label style={{display:"block",marginBottom:14}}>{title}</Label>
      {children}
    </Card>
  );

  const FieldRow = ({label,desc,type="text",value,onChange,placeholder,link,linkLabel})=>(
    <div style={{padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:T.text1,fontFamily:FONT}}>{label}</div>
          {desc&&<div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>{desc}</div>}
        </div>
        {link&&<a href={link} target="_blank" rel="noreferrer" style={{fontSize:10,color:T.blue,fontFamily:FONT}}>{linkLabel||"Obtenir"} ↗</a>}
      </div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder||label}
        style={{width:"100%",padding:"8px 12px",borderRadius:T.r6,border:`1px solid ${T.border}`,
          background:T.bgCard,color:T.text1,fontSize:12,fontFamily:FONT,outline:"none"}}/>
    </div>
  );

  const MADHABS = [
    {id:"hanafi",lb:"Hanafite (Abū Ḥanīfa) — Nissab argent"},
    {id:"maliki",lb:"Malikite (Mālik ibn Anas) — Nissab or"},
    {id:"shafii",lb:"Shafi'ite (Muḥammad al-Shāfiʿī) — Nissab or"},
    {id:"hanbali",lb:"Hanbalite (Aḥmad ibn Ḥanbal) — Nissab or"},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Section title="Profil & Sharia">
        <FieldRow label="Prénom" desc="Affiché dans la sidebar" value={settings.displayName} onChange={v=>upd("displayName",v)}/>
        <div style={{padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text1,marginBottom:8,fontFamily:FONT}}>École juridique (Madhab)</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {MADHABS.map(m=>(
              <label key={m.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,fontFamily:FONT,color:settings.madhab===m.id?T.gold:T.text2,fontWeight:settings.madhab===m.id?800:500}}>
                <input type="radio" name="madhab" value={m.id} checked={settings.madhab===m.id} onChange={()=>upd("madhab",m.id)} style={{accentColor:T.gold}}/>
                {m.lb}
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="APIs de Marché">
        <div style={{padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:T.text1,fontFamily:FONT}}>GoldAPI.io — Prix Or & Argent</div>
              <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>200 req/mois gratuit — Nissab dynamique</div>
            </div>
            <a href="https://www.goldapi.io" target="_blank" rel="noreferrer" style={{fontSize:10,color:T.blue,fontFamily:FONT}}>Obtenir ↗</a>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="password" value={settings.goldApiKey} onChange={e=>upd("goldApiKey",e.target.value)}
              placeholder="goldapi-XXXXXXXXX"
              style={{flex:1,padding:"8px 12px",borderRadius:T.r6,border:`1px solid ${T.border}`,background:T.bgCard,color:T.text1,fontSize:12,fontFamily:FONT,outline:"none"}}/>
            <button onClick={testGoldKey} disabled={!settings.goldApiKey||testingGold}
              style={{padding:"8px 14px",borderRadius:T.r6,background:T.bgMuted,border:`1px solid ${T.border}`,color:T.text2,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:FONT}}>
              {testingGold?"…":"Tester"}
            </button>
          </div>
          {liveGold && (
            <div style={{marginTop:8,fontSize:12,color:T.green,fontFamily:FONT,fontWeight:700}}>
              ✓ Or: {liveGold.goldPerGram.toFixed(2)}€/g · Argent: {liveGold.silverPerGram.toFixed(3)}€/g
            </div>
          )}
        </div>
        <FieldRow label="Zoya Finance — Halal Screening" desc="Screening halal live par ticker (AAOIFI Std. 21)"
          value={settings.zoyaApiKey} onChange={v=>upd("zoyaApiKey",v)} placeholder="Bearer token Zoya"
          link="https://app.zoya.finance/api-access" linkLabel="Accès API"/>
      </Section>

      <Section title="IA Cortex">
        <div style={{padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text1,marginBottom:8,fontFamily:FONT}}>Fournisseur IA</div>
          <div style={{display:"flex",gap:8}}>
            {[{id:"gemini",lb:"Gemini 2.0 Flash"},{id:"groq",lb:"Groq Llama 3.1"}].map(p=>(
              <button key={p.id} onClick={()=>upd("iaProvider",p.id)}
                style={{padding:"7px 16px",borderRadius:T.r6,fontSize:12,fontWeight:800,
                  background:settings.iaProvider===p.id?T.gold:"transparent",
                  color:settings.iaProvider===p.id?"#fff":T.text2,
                  border:`1px solid ${settings.iaProvider===p.id?T.gold:T.border}`,
                  cursor:"pointer",fontFamily:FONT}}>
                {p.lb}
              </button>
            ))}
          </div>
        </div>
        <FieldRow label="Clé Gemini 2.0 Flash" desc="Quota gratuit généreux — aistudio.google.com"
          value={settings.geminiKey} onChange={v=>upd("geminiKey",v)} placeholder="AIza..."
          link="https://aistudio.google.com/apikey" linkLabel="Créer clé gratuite"/>
        <FieldRow label="Clé Groq (Llama 3.1)" desc="14 400 req/jour gratuit — réponse < 1s"
          value={settings.groqKey} onChange={v=>upd("groqKey",v)} placeholder="gsk_..."
          link="https://console.groq.com/keys" linkLabel="Créer clé gratuite"/>
      </Section>

      <Section title="Apparence">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:T.text1,fontFamily:FONT}}>Mode sombre</div>
            <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>Interface dark · Trade Republic style</div>
          </div>
          <Toggle on={darkMode} onChange={setDarkMode} label="Mode sombre"/>
        </div>
      </Section>

      <Section title="Zakat & Données">
        <div style={{padding:"12px 0",borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text1,fontFamily:FONT,marginBottom:6}}>Hawl — début du cycle</div>
          <div style={{fontSize:11,color:T.text3,fontFamily:FONT,marginBottom:8}}>
            {zakatState.hawlStart ? `Démarré le ${new Date(zakatState.hawlStart).toLocaleDateString("fr-FR")}` : "Non démarré"}
          </div>
          <button onClick={()=>{ setZakatState(s=>({...s,hawlStart:new Date().toISOString()})); toast("Hawl réinitialisé"); }}
            style={{padding:"7px 14px",borderRadius:T.r6,background:T.gold,color:"#fff",fontSize:11,fontWeight:800,border:"none",cursor:"pointer",fontFamily:FONT}}>
            Démarrer / Réinitialiser
          </button>
        </div>
        <div style={{padding:"12px 0",display:"flex",gap:10}}>
          <button onClick={save}
            style={{flex:1,padding:"10px",borderRadius:T.r6,background:saved?T.green:T.gold,
              color:"#fff",fontSize:12,fontWeight:800,border:"none",cursor:"pointer",fontFamily:FONT,transition:"background .3s"}}>
            {saved?"✓ Sauvegardé":"Sauvegarder les paramètres"}
          </button>
          <button onClick={()=>{ if(window.confirm("Réinitialiser TOUTES les données MIZAN ?")) resetAll(); }}
            style={{flex:1,padding:"10px",borderRadius:T.r6,border:`1px solid ${T.red}`,
              background:"transparent",color:T.red,fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:FONT}}>
            Réinitialiser tout
          </button>
        </div>
      </Section>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION & TOAST
// ══════════════════════════════════════════════════════════════════════════════
const NAV_ITEMS = [
  {id:"dashboard",lb:"Synthèse",ic:"⊞"},{id:"patrimoine",lb:"Patrimoine",ic:"💼"},
  {id:"halal",lb:"Halal & Zakat",ic:"☪"},{id:"budget",lb:"Budget",ic:"💳"},
  {id:"analytics",lb:"Analyse",ic:"📊"},{id:"impots",lb:"Impôts",ic:"🧾"},
  {id:"cortex",lb:"IA Cortex",ic:"🤖"},
];

const PAGE_TITLES = {
  dashboard:"Synthèse",patrimoine:"Patrimoine",halal:"Halal & Zakat",
  budget:"Budget",analytics:"Analyse",impots:"Impôts",cortex:"IA Cortex",settings:"Paramètres",
};

function Toast({ msg, onClose }) {
  const T = useT();
  useEffect(()=>{ const t=setTimeout(onClose,3500); return ()=>clearTimeout(t); },[onClose]);
  return (
    <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
      background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:T.r8,
      padding:"10px 20px",boxShadow:T.shadowMd,fontSize:13,fontWeight:700,
      color:T.text1,fontFamily:FONT,zIndex:9999}}>
      {msg}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
const PRICE_CACHE_TTL = 15 * 60 * 1000;

export default function App() {
  const [darkMode, setDarkMode]     = useState(()=>LS.get("theme",false));
  const [tab, setTab]               = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [toastMsg, setToastMsg]     = useState(null);

  const [settings, setSettingsRaw]  = useState(()=>({...DEFAULT_SETTINGS,...LS.get("settings",{})}));
  const [assets, setAssetsRaw]      = useState(()=>LS.get("assets",ASSETS_DEFAULT));
  const [transactions, setTxsRaw]   = useState(()=>LS.get("txs",TRANSACTIONS));
  const [zakatState, setZakatStateRaw] = useState(()=>LS.get("zakat",{hawlStart:null,history:[]}));
  const [prices, setPrices]         = useState(()=>{
    const c=LS.get("pricesCache",null);
    if(c&&Date.now()-c.ts<PRICE_CACHE_TTL) return c.data;
    return {};
  });
  const [hijri, setHijri] = useState("");

  const setSettings  = (fn) => setSettingsRaw(s=>{const n=typeof fn==="function"?fn(s):fn; LS.set("settings",n); return n;});
  const setAssets    = (fn) => setAssetsRaw(s=>{const n=typeof fn==="function"?fn(s):fn; LS.set("assets",n); return n;});
  const setTxs       = (fn) => setTxsRaw(s=>{const n=typeof fn==="function"?fn(s):fn; LS.set("txs",n); return n;});
  const setZakatState= (fn) => setZakatStateRaw(s=>{const n=typeof fn==="function"?fn(s):fn; LS.set("zakat",n); return n;});

  const toast = useCallback((msg)=>setToastMsg(msg),[]);

  const resetAll = () => {
    ["theme","settings","assets","txs","zakat","pricesCache"].forEach(k=>LS.del(k));
    setAssetsRaw(ASSETS_DEFAULT); setTxsRaw(TRANSACTIONS);
    setZakatStateRaw({hawlStart:null,history:[]}); setSettingsRaw(DEFAULT_SETTINGS);
    toast("Données réinitialisées");
  };

  useEffect(()=>{ LS.set("theme",darkMode); },[darkMode]);

  useEffect(()=>{
    const load = async () => {
      try {
        const [crypto,fx,h] = await Promise.all([
          API.fetchCrypto().catch(()=>null),
          API.fetchFX().catch(()=>null),
          API.fetchHijri().catch(()=>null),
        ]);
        const metals = settings.goldApiKey ? await API.fetchMetals(settings.goldApiKey).catch(()=>null) : null;
        const newPrices = {...(crypto||{}),...(metals||{}),fx:fx||null};
        setPrices(newPrices);
        LS.set("pricesCache",{ts:Date.now(),data:newPrices});
        if(h) setHijri(`${h.day} ${h.month?h.month.en:""} ${h.year} H`);
      } catch(_e) {}
    };
    load();
  },[settings.goldApiKey]);

  const zakatResult = useMemo(()=>computeZakat(assets,prices,settings.madhab,zakatState.hawlStart),[assets,prices,settings.madhab,zakatState.hawlStart]);

  const notifications = useMemo(()=>{
    const n=[];
    assets.filter(a=>a.st==="HARAM"&&a.v>0).forEach(a=>n.push({id:`h_${a.id}`,type:"haram",title:`${a.t} — HARAM`,body:a.n,time:"Actif"}));
    assets.filter(a=>a.st==="QUESTIONABLE").forEach(a=>{
      const purif=(a.div||0)*((a.haramPct||0)/100)+(a.gain||0)*((a.haramPct||0)/100);
      if(purif>0.01) n.push({id:`q_${a.id}`,type:"warning",title:`${a.t} — Purification`,body:`${purif.toFixed(2)}€ à purifier`,time:"Actif"});
    });
    transactions.filter(t=>!t.ok).slice(0,3).forEach(t=>n.push({id:`t_${t.id||t.n}`,type:"haram",title:"Transaction HARAM",body:`${t.n} · ${t.a.toFixed(2)}€`,time:t.d}));
    if(zakatResult.obligatoire&&zakatResult.hawlPct>=100) n.push({id:"z1",type:"warning",title:"Zakat due !",body:`${zakatResult.totalZakat.toFixed(0)}€ à verser`,time:"Urgent"});
    return n.slice(0,8);
  },[assets,transactions,zakatResult]);

  const T = darkMode ? T_DARK : T_LIGHT;
  const title = PAGE_TITLES[tab]||"MIZAN";

  const ctx = {settings,setSettings,assets,setAssets,transactions,setTxs,zakatState,setZakatState,zakatResult,prices,toast,resetAll,hijri};

  const renderView = () => {
    switch(tab) {
      case "dashboard":  return <DashboardPage/>;
      case "patrimoine": return <PatrimoinePage/>;
      case "halal":      return <HalalPage/>;
      case "budget":     return <BudgetPage/>;
      case "analytics":  return <AnalyticsPage/>;
      case "impots":     return <ImpotsPage/>;
      case "cortex":     return <CortexPage/>;
      case "settings":   return <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode}/>;
      default:           return <DashboardPage/>;
    }
  };

  const MADHAB_SHORT = {hanafi:"Hanafite",maliki:"Malikite",shafii:"Shafi'ite",hanbali:"Hanbalite"};

  return (
    <MizanCtx.Provider value={ctx}>
    <ThemeContext.Provider value={T}>
      <GlobalStyles dark={darkMode}/>
      <div style={{display:"flex",height:"100vh",fontFamily:FONT,background:T.bgSoft,color:T.text1}}>

        <nav style={{width:sidebarCollapsed?68:226,flexShrink:0,background:T.bg,borderRight:`1px solid ${T.border}`,
          display:"flex",flexDirection:"column",padding:"18px 0 20px",zIndex:20,transition:"width .2s ease",overflow:"hidden"}}>
          <div style={{padding:"0 14px 16px",borderBottom:`1px solid ${T.border}`,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <button onClick={()=>setTab("dashboard")} style={{display:"flex",alignItems:"center",gap:10,background:"none",border:"none",cursor:"pointer",padding:0,outline:"none"}}>
              <div style={{width:32,height:32,borderRadius:T.r8,background:T.goldBg,border:`1px solid ${T.goldBd}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⚖</div>
              {!sidebarCollapsed && (
                <div>
                  <div style={{fontSize:17,fontWeight:900,color:T.text1,letterSpacing:"-0.5px",fontFamily:FONT,lineHeight:1.1}}>MIZAN</div>
                  <div style={{fontFamily:"serif",fontSize:10,color:T.gold,lineHeight:1}}>مِيزَان</div>
                </div>
              )}
            </button>
            <button onClick={()=>setSidebarCollapsed(c=>!c)}
              style={{background:"none",border:"none",cursor:"pointer",color:T.text4,fontSize:14,padding:4,outline:"none"}}>
              {sidebarCollapsed?"→":"←"}
            </button>
          </div>

          <div style={{flex:1,display:"flex",flexDirection:"column",padding:"0 8px",gap:2}}>
            {NAV_ITEMS.map(n=>{
              const active=tab===n.id;
              return (
                <button key={n.id} onClick={()=>setTab(n.id)}
                  title={sidebarCollapsed?n.lb:undefined}
                  style={{display:"flex",alignItems:"center",gap:sidebarCollapsed?0:11,
                    justifyContent:sidebarCollapsed?"center":"flex-start",
                    padding:"9px 10px",borderRadius:T.r6,cursor:"pointer",border:"none",
                    fontFamily:FONT,width:"100%",textAlign:"left",
                    background:active?T.goldBg:"transparent",color:active?T.gold:T.text3,
                    borderLeft:`2px solid ${active?T.gold:"transparent"}`,transition:"all .12s",outline:"none"}}>
                  <span style={{fontSize:16,width:22,textAlign:"center",flexShrink:0}}>{n.ic}</span>
                  {!sidebarCollapsed && <span style={{fontSize:13,fontWeight:active?800:600}}>{n.lb}</span>}
                </button>
              );
            })}
          </div>

          <div style={{padding:"0 8px",marginTop:"auto"}}>
            {!sidebarCollapsed && zakatState.hawlStart && (
              <div style={{background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:T.r8,padding:"12px 14px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:800,color:T.text3,textTransform:"uppercase",letterSpacing:".8px",marginBottom:6}}>Hawl · Zakat</div>
                <div style={{height:3,background:T.bgMuted,borderRadius:2,marginBottom:6,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${zakatResult.hawlPct.toFixed(0)}%`,background:`linear-gradient(90deg,${T.gold},${T.goldL})`,borderRadius:2}}/>
                </div>
                <div style={{fontSize:12,fontWeight:800,color:zakatResult.obligatoire?T.gold:T.text3,fontFamily:FONT}}>
                  {zakatResult.hawlElapsed} / {HAWL_TOTAL_DAYS} jours
                </div>
                <div style={{fontSize:10,color:T.text3,marginTop:2,fontFamily:FONT}}>
                  {zakatResult.hawlLeft > 0 ? `~${zakatResult.hawlLeft}j avant Zakat` : "⚠ Zakat due !"}
                </div>
              </div>
            )}
            {!sidebarCollapsed && (prices.btc || prices.goldPerGram) && (
              <div style={{background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:T.r8,padding:"10px 14px",marginBottom:8}}>
                {prices.goldPerGram && <div style={{fontSize:11,fontWeight:700,color:T.gold,fontFamily:FONT}}>🥇 {prices.goldPerGram.toFixed(2)} €/g</div>}
                {prices.btc && <div style={{fontSize:11,fontWeight:700,color:T.text2,fontFamily:FONT,marginTop:3}}>₿ {Math.round(prices.btc).toLocaleString("fr-FR")} €</div>}
                {hijri && <div style={{fontSize:9,color:T.text4,fontFamily:FONT,marginTop:4}}>{hijri}</div>}
              </div>
            )}
            <button onClick={()=>setTab("settings")}
              style={{display:"flex",alignItems:"center",gap:sidebarCollapsed?0:11,
                justifyContent:sidebarCollapsed?"center":"flex-start",
                padding:"9px 10px",borderRadius:T.r6,cursor:"pointer",border:"none",
                fontFamily:FONT,background:tab==="settings"?T.goldBg:"transparent",
                width:"100%",textAlign:"left",color:tab==="settings"?T.gold:T.text3,
                borderLeft:`2px solid ${tab==="settings"?T.gold:"transparent"}`,outline:"none"}}>
              <span style={{fontSize:16,width:22,textAlign:"center"}}>⚙</span>
              {!sidebarCollapsed&&<span style={{fontSize:13,fontWeight:600}}>Paramètres</span>}
            </button>
            {!sidebarCollapsed && (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 10px 0",borderTop:`1px solid ${T.border}`,marginTop:8}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:T.text1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:T.bg,flexShrink:0}}>
                  {(settings.displayName||"R")[0].toUpperCase()}
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:T.text1,fontFamily:FONT}}>{settings.displayName||"Redha"}</div>
                  <div style={{fontSize:11,color:T.text3,fontFamily:FONT}}>MIZAN · ☪ {MADHAB_SHORT[settings.madhab]}</div>
                </div>
              </div>
            )}
          </div>
        </nav>

        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bgSoft}}>
          <header style={{height:54,padding:"0 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0,background:T.bg,borderBottom:`1px solid ${T.border}`}}>
            <div style={{flex:1}}>
              <span style={{fontSize:16,fontWeight:900,color:T.text1,letterSpacing:"-0.5px",fontFamily:FONT}}>{title}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"5px 12px",background:T.bgSoft,border:`1px solid ${T.border}`,borderRadius:T.r6,fontSize:11,fontWeight:700,color:T.text3,fontFamily:FONT}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:T.green}}/>
              <span>En direct · {new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})}</span>
            </div>
            <button onClick={()=>setDarkMode(d=>!d)}
              style={{width:34,height:34,borderRadius:T.r6,background:T.bgSoft,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,cursor:"pointer",outline:"none"}}>
              {darkMode?"☀️":"🌙"}
            </button>
            <button onClick={()=>setShowNotifs(v=>!v)}
              style={{width:34,height:34,borderRadius:T.r6,background:T.bgSoft,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,cursor:"pointer",position:"relative",outline:"none"}}>
              <span aria-hidden="true">🔔</span>
              {notifications.length > 0 && (
                <span style={{position:"absolute",top:-3,right:-3,width:16,height:16,borderRadius:"50%",
                  background:T.red,color:"#fff",fontSize:8,fontWeight:900,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  border:`2px solid ${T.bg}`,fontFamily:FONT}}>
                  {notifications.length}
                </span>
              )}
            </button>
          </header>

          <div style={{position:"relative"}}>
            {showNotifs && <NotificationPanel notifications={notifications} onClose={()=>setShowNotifs(false)}/>}
          </div>

          <main style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"20px 24px 100px"}}>
            <div style={{marginBottom:16}}>
              <SectionHeader title={title}
                badge={
                  tab==="halal"?"☪ AAOIFI · Zoya":
                  tab==="cortex"?"☁ Gemini · Groq":
                  tab==="impots"?"🇫🇷 Fiscalité FR 2026":
                  tab==="analytics"?"📊 Simulateurs":undefined
                }
              />
            </div>
            {renderView()}
            <footer style={{textAlign:"center",padding:"24px 0 4px",borderTop:`1px solid ${T.border}`,marginTop:24}}>
              <div style={{fontFamily:"serif",fontSize:13,color:"rgba(196,132,26,0.3)",marginBottom:6}}>
                بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ
              </div>
              <div style={{fontSize:10,color:T.text4,letterSpacing:.4,fontFamily:FONT}}>
                MIZAN v1 · Finance islamique = Finance éthique · AAOIFI · Open Source
              </div>
            </footer>
          </main>
        </div>
      </div>

      {tab!=="cortex" && <FloatingAIButton onClick={()=>setTab("cortex")}/>}
      {toastMsg && <Toast msg={toastMsg} onClose={()=>setToastMsg(null)}/>}
    </ThemeContext.Provider>
    </MizanCtx.Provider>
  );
}
