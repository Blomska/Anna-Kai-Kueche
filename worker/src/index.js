/**
 * Küchenhelfer für Anna & Kai Küche (Cloudflare Worker "anna-kai-helfer")
 * ------------------------------------------------------------------
 * Die App schickt den Chatverlauf + die aktuelle Einkaufsliste hierher.
 * Der Worker ergänzt die Angebote der Woche (aus data/prospekte.json der
 * App), fragt Google Gemini und gibt eine Antwort plus – falls passend –
 * eine Liste von Artikeln zurück, die man mit einem Tipp übernehmen kann.
 *
 * Geheimnisse (als Worker-Secrets, NIE im Code):
 *   GEMINI_API_KEY    – Gemini-Schlüssel (kommt aus dem GitHub-Secret GEMINIAPIKEYANNA)
 * Optional (Variable): GEMINI_MODEL – bestimmtes Gemini-Modell erzwingen
 *   FAMILY_CODE       – Zugangscode, den die App einmalig abfragt
 *                       (schützt vor fremder Nutzung und Kosten)
 * ------------------------------------------------------------------
 */

import * as z from 'zod';
import { createClient, generateJson, GeminiBlocked, ApiError } from '../../lib/gemini.mjs';

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 2000;
const RATE_LIMIT_PER_HOUR = 40;

const NaehrwerteSchema = z.object({
  kcal: z.number().int(),
  eiweiss_g: z.number().int(),
  kohlenhydrate_g: z.number().int(),
  fett_g: z.number().int()
});

const RecipeSchema = z.object({
  titel: z.string(),
  emoji: z.string(),
  beschreibung: z.string(),
  portionen: z.number().int(),
  dauer_minuten: z.number().int(),
  schwierigkeit: z.enum(['einfach', 'mittel']),
  kategorie: z.enum(['Hauptgerichte', 'Schnelle Gerichte', 'Frühstück', 'Suppen & Eintöpfe', 'Salate & Bowls', 'Snacks & Süßes', 'Backen']),
  zutaten: z.array(z.object({
    name: z.string(),
    menge: z.string(),
    laden: z.enum(['aldi', 'marktkauf', 'rewe', 'netto', 'egal']),
    im_angebot: z.boolean(),
    preis: z.string(),
    vorrat: z.boolean()
  })),
  schritte: z.array(z.string()),
  naehrwerte: NaehrwerteSchema
});

const ReplySchema = z.object({
  antwort: z.string(),
  artikel: z.array(z.object({
    name: z.string(),
    menge: z.string(),
    laden: z.enum(['aldi', 'marktkauf', 'rewe', 'netto', 'egal'])
  })),
  rezepte: z.array(RecipeSchema),
  merken: z.array(z.object({
    text: z.string(),
    wenn: z.string(),
    dann: z.string()
  }))
});

const SYSTEM_PROMPT = `Du bist der Küchenhelfer in der App „Anna & Kai Küche“. Dir schreiben Anna oder Kai, ein Paar aus Lüdinghausen. Sie kaufen bei Aldi Nord, Marktkauf Nientied, REWE und Netto ein.

Feste Regeln – immer einhalten:
- KEINE Zwiebeln: Schlage nie Zwiebeln, Schalotten, Frühlings- oder Lauchzwiebeln vor, auch nicht als Zwiebelpulver – weder in "artikel" noch in "rezepte". Würze stattdessen z. B. mit Knoblauch, Lauch, Sellerie, Kräutern oder Gewürzen. Steht in einem eigenen Rezept von Anna oder Kai eine Zwiebel, übernimm das Rezept, weise aber kurz auf eine Alternative hin.
- Eiweißreich: Gerichte mit einer guten Eiweißquelle (z. B. Hähnchen, Pute, Fisch, Eier, Skyr, Quark, Hüttenkäse, Hülsenfrüchte, Tofu). Nenne bei Rezepten grob das Eiweiß pro Portion. Snacks am liebsten extra eiweißreich, z. B. mit Skyr oder Magerquark.
- Keine Meeresfrüchte. Geräte: Herd, Backofen und Airfryer – keine Mikrowelle, kein Grill, kein Thermomix.
- Was im Gedächtnis steht (Vorlieben), hat immer Vorrang.

Wie du antwortest:
- Freundlich, kurz und in einfacher Sprache. Duze. Keine Tabellen, keine Überschriften, höchstens kurze Aufzählungen mit "•". Sparsam mit Emojis.
- Wenn sie etwas planen (Frühstück, Besuch, Abendessen, Meal-Prep …), schlage konkret vor, was es geben könnte, und rechne Mengen für die genannte Personenzahl (sonst 2).
- Nutze die Angebote der Woche, wenn sie passen, und sag dazu, wo es gerade günstig ist (z. B. "Hähnchenbrust ist bei Aldi im Angebot für 3,99 €").
- Wenn Einkäufe sinnvoll sind, fülle "artikel" mit allem, was gekauft werden muss:
  • "name" so, wie man es auf den Einkaufszettel schreibt (z. B. "Hähnchenbrust", "Skyr", "Paprika").
  • "menge" kurz (z. B. "2 Stück", "500 g", "1 Glas"); leer, wenn egal.
  • "laden": "aldi", "marktkauf", "rewe" oder "netto", wenn es dort im Angebot ist, sonst "egal".
  • Lass weg, was schon auf der Liste steht, und typische Vorräte (Salz, Pfeffer, Öl, Zucker, Mehl), außer danach wird gefragt.
- Wenn nur etwas gefragt wird (z. B. ein Tipp), antworte einfach – "artikel" darf dann leer sein.
- Sag in der Antwort nicht, dass du die Artikel "unten" auflistest – die App zeigt sie automatisch zum Abhaken an. Ein kurzer Satz reicht.
- Schlägst du ein konkretes Gericht mit Zutaten und Zubereitung vor (oder wird nach einem Rezept gefragt), lege es zusätzlich vollständig in "rezepte" ab (höchstens 2):
  • "zutaten" mit Mengen für die genannte Personenzahl (sonst 2), "vorrat": true für Salz, Pfeffer, Öl, Mehl, Zucker, Gewürze, Brühe.
  • "im_angebot"/"preis" nur, wenn die Zutat in den Angeboten dieser Woche steht (Preis wie angegeben), sonst false und "".
  • "schritte": 4–8 kurze, klare Schritte. "emoji": ein passendes Essens-Emoji.
  • "naehrwerte": realistisch geschätzt PRO PORTION (kcal, Eiweiß, Kohlenhydrate, Fett in Gramm).
  • In "antwort" dann nur kurz beschreiben, was es gibt – die App zeigt das Rezept als Karte, die man mit „Ins Kochbuch“ speichern kann.
- Erzählt jemand ein EIGENES Rezept oder will eins ins Kochbuch eintragen, schreib es sauber als Rezept in "rezepte": Zutaten, Mengen und Schritte übernehmen, nur ordnen und fehlende Kleinigkeiten ergänzen. Fehlt Wichtiges, frag in "antwort" nach.
- "kategorie": Hauptgerichte, Schnelle Gerichte (bis ca. 25 Min), Frühstück, Suppen & Eintöpfe, Salate & Bowls, Snacks & Süßes oder Backen.
- Ohne konkretes Rezept bleibt "rezepte" leer.
- Gedächtnis: Am Anfang der Nachricht steht, was du schon über Anna und Kai weißt. Richte dich immer danach – auch bei Mengen in "artikel" und "rezepte".
- Erfährst du etwas Dauerhaftes (Vorliebe, Abneigung, Lieblingsmarke, Allergie, Gewohnheit), das noch nicht im Gedächtnis steht, schlage es in "merken" vor:
  • "text": kurz in der 3. Person, z. B. "Anna mag keine Pilze." oder "Skyr immer von Arla."
  • "wenn"/"dann" nur, wenn ein Artikelname auf der Liste immer ersetzt werden soll, z. B. wenn "Skyr", dann "Arla Skyr". Sonst beide leer.
  • Frag in "antwort" kurz: "Soll ich mir das merken?" – die App zeigt dafür einen Knopf.
  • Ohne neue dauerhafte Info bleibt "merken" leer.
- Bleib beim Thema Essen, Einkaufen, Kochen und Planung. Bei anderem antworte freundlich und kurz.`;

/* ---------------- Hilfsfunktionen ---------------- */

const rateLimits = new Map(); // IP → Zeitstempel (pro Worker-Instanz, einfacher Schutz)

function rateLimited(ip) {
  const now = Date.now();
  const recent = (rateLimits.get(ip) || []).filter((t) => now - t < 3600_000);
  recent.push(now);
  rateLimits.set(ip, recent);
  return recent.length > RATE_LIMIT_PER_HOUR;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}

async function loadJson(url) {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 1800, cacheEverything: true } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const NON_FOOD = /mode|deko|schlafzimmer|pflanzen|kosmetik|haushalt|drogerie|garten|technik|elektro|spielzeug|spielsachen|tier/i;

/** Angebote der Woche als kompakter Text (ändert sich selten → gut für Prompt-Caching). */
async function offersContext(env) {
  const base = env.DATA_URL || '';
  const [data, recipes] = await Promise.all([loadJson(`${base}prospekte.json`), loadJson(`${base}rezepte.json`)]);
  const lines = [];
  for (const [store, label] of [['aldi', 'Aldi'], ['marktkauf', 'Marktkauf'], ['rewe', 'REWE'], ['netto', 'Netto']]) {
    for (const o of data?.[store]?.offers?.offers || []) {
      if (NON_FOOD.test(o.group || '')) continue;
      lines.push(`${label} | ${[o.brand, o.name].filter(Boolean).join(' ')} | ${o.price}${o.validTo ? ` | bis ${o.validTo}` : ''}`);
    }
  }
  lines.sort();
  let text = lines.length
    ? `Angebote dieser Woche (Laden | Produkt | Preis | gültig):\n${lines.join('\n')}`
    : 'Zu den Angeboten dieser Woche liegen gerade keine Daten vor.';
  if (recipes?.rezepte?.length) {
    text += `\n\nRezepte der Woche in der App: ${recipes.rezepte.map((r) => r.titel).join('; ')}`;
  }
  return text;
}

function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    clean.push({ role: m.role, content });
  }
  // Muss mit einer Nachricht von Anna/Kai beginnen und enden
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean.at(-1).role !== 'user') return null;
  return clean;
}

const NAEHRWERTE_SYSTEM = `Du schätzt Nährwerte von Rezepten. Rechne mit üblichen Nährwerttabellen (z. B. BLS) und den angegebenen Mengen.
Gib die Werte PRO PORTION an: kcal, Eiweiß, Kohlenhydrate und Fett in Gramm, gerundet auf ganze Zahlen.
Zutaten ohne Menge (Salz, Gewürze) kaum mitrechnen, Öl mit ca. 1 EL pro Rezept, wenn nichts dasteht.`;

/** Nährwerte für ein Rezept schätzen (Kochbuch-Rezepte ohne Werte). */
async function handleNaehrwerte(body, env, cors) {
  const r = body?.rezept;
  if (!r || typeof r.titel !== 'string' || !Array.isArray(r.zutaten) || !r.zutaten.length) {
    return json({ fehler: 'Ungültiges Rezept' }, 400, cors);
  }
  const portionen = Math.max(1, Math.min(20, Number(r.portionen) || 2));
  const zutaten = r.zutaten.slice(0, 60)
    .map((z) => `- ${String(z?.menge || '').slice(0, 30)} ${String(z?.name || '').slice(0, 80)}`.trim());
  const ai = createClient(env.GEMINI_API_KEY, 25000);
  const out = await generateJson(ai, {
    system: NAEHRWERTE_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: `Rezept: ${r.titel.slice(0, 120)}\nPortionen: ${portionen}\nZutaten:\n${zutaten.join('\n')}` }] }],
    schema: z.object({ naehrwerte: NaehrwerteSchema }),
    maxTokens: 400,
    model: env.GEMINI_MODEL || undefined,
    retryDelayMs: 1500,
    maxModels: 3
  });
  return json({ naehrwerte: out.naehrwerte }, 200, cors);
}

const IMPORT_SYSTEM = `Du liest Rezepte aus Fotos (z. B. Kochbuchseiten, Screenshots), Webseiten oder eingefügtem Text und schreibst sie sauber auf Deutsch für das Kochbuch von Anna und Kai.

- Übernimm das Rezept so originalgetreu wie möglich: Zutaten mit Mengen, Portionen, Schritte. Nichts weglassen und keine Zutaten austauschen.
- Übersetze fremdsprachige Rezepte ins Deutsche und rechne amerikanische Maße (cups, oz, °F) in g/ml/°C um.
- "zutaten": "name" so, wie man es auf den Einkaufszettel schreibt, "menge" kurz (z. B. "400 g", "1 EL"), "laden": "egal", "im_angebot": false, "preis": "", "vorrat": true nur für Salz, Pfeffer, Öl, Mehl, Zucker, Gewürze, Brühe.
- "schritte": klare Schritte in eigenen Worten, höchstens 12.
- "portionen": wie im Rezept, sonst 2. "dauer_minuten": geschätzte Gesamtzeit.
- "kategorie": Hauptgerichte, Schnelle Gerichte (bis ca. 25 Min), Frühstück, Suppen & Eintöpfe, Salate & Bowls, Snacks & Süßes oder Backen.
- "naehrwerte": realistisch geschätzt PRO PORTION.
- "hinweis": ein kurzer Satz für Anna und Kai. Enthält das Rezept Zwiebeln, Schalotten oder Meeresfrüchte (mögen sie nicht), nenne eine passende Alternative. Sonst leer.
- Ist kein Rezept zu erkennen, setze "gefunden": false und erkläre in "hinweis" kurz, warum (z. B. "Auf dem Foto ist kein Rezept zu erkennen.").`;

const ImportSchema = z.object({
  gefunden: z.boolean(),
  hinweis: z.string(),
  rezept: RecipeSchema
});

/** Seite laden und den Rezept-Teil herausholen (JSON-LD „Recipe" oder Text). */
async function pageText(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'de-DE,de;q=0.9'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000)
  });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 1_500_000);
  const decode = (t) => String(t || '').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  const meta = (name) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)`, 'i'))?.[1]);

  // 1. Strukturierte Rezeptdaten (Chefkoch, Lecker, viele Blogs)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [data].flat().flatMap((d) => (d && d['@graph'] ? d['@graph'] : [d]));
    const recipe = nodes.find((n) => n && [n['@type']].flat().includes('Recipe'));
    if (!recipe) continue;
    const steps = [recipe.recipeInstructions].flat().filter(Boolean).flatMap((st) => {
      if (typeof st === 'string') return [st];
      if (st.itemListElement) return [st.itemListElement].flat().map((x) => x.text || x.name || '');
      return [st.text || st.name || ''];
    });
    return [
      `Titel: ${decode(recipe.name)}`,
      recipe.recipeYield ? `Portionen: ${[recipe.recipeYield].flat().join(' ')}` : '',
      recipe.totalTime ? `Zeit: ${recipe.totalTime}` : '',
      recipe.description ? `Beschreibung: ${decode(recipe.description)}` : '',
      `Zutaten:\n${[recipe.recipeIngredient].flat().filter(Boolean).map((z) => `- ${decode(z)}`).join('\n')}`,
      `Zubereitung:\n${steps.map((st, i) => `${i + 1}. ${decode(st).replace(/<[^>]+>/g, ' ')}`).join('\n')}`
    ].filter(Boolean).join('\n').slice(0, 15000);
  }

  // 2. Sonst: Titel, Beschreibung (bei Instagram steht dort der Beitragstext) und Seitentext
  const body = decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return [
    `Titel: ${meta('og:title') || decode(html.match(/<title>([^<]*)/i)?.[1])}`,
    `Beschreibung: ${meta('og:description') || meta('description')}`,
    `Seitentext:\n${body.slice(0, 12000)}`
  ].join('\n');
}

/** Rezept aus Foto, Link oder Text. */
async function handleRezept(body, env, cors) {
  const parts = [];
  if (typeof body?.bild === 'string' && body.bild) {
    const mime = /^image\/(jpeg|png|webp|heic|heif)$/.test(body.mime) ? body.mime : 'image/jpeg';
    if (body.bild.length > 6_000_000) return json({ fehler: 'Das Foto ist zu groß.' }, 400, cors);
    parts.push({ inlineData: { mimeType: mime, data: body.bild } });
    parts.push({ text: 'Lies das Rezept auf diesem Foto aus.' });
  } else if (typeof body?.link === 'string' && body.link) {
    let text = null;
    try {
      text = await pageText(body.link.trim().slice(0, 2000));
    } catch (err) {
      console.warn('[Rezept] Seite nicht ladbar', err.message);
    }
    if (!text) {
      return json({ fehler: 'Die Seite lässt sich nicht öffnen. Kopiert den Rezepttext und fügt ihn unten ein, oder macht ein Foto/Bildschirmfoto.' }, 422, cors);
    }
    parts.push({ text: `Link: ${body.link}\n\n${text}` });
  } else if (typeof body?.text === 'string' && body.text.trim()) {
    parts.push({ text: body.text.trim().slice(0, 15000) });
  } else {
    return json({ fehler: 'Bitte ein Foto, einen Link oder Text schicken.' }, 400, cors);
  }
  const ai = createClient(env.GEMINI_API_KEY, 40000);
  const out = await generateJson(ai, {
    system: IMPORT_SYSTEM,
    contents: [{ role: 'user', parts }],
    schema: ImportSchema,
    maxTokens: 6000,
    model: env.GEMINI_MODEL || undefined,
    retryDelayMs: 1500,
    maxModels: 3
  });
  if (!out.gefunden || !out.rezept?.zutaten?.length) {
    return json({ fehler: out.hinweis || 'Darin habe ich kein Rezept gefunden.' }, 422, cors);
  }
  return json({ rezept: out.rezept, hinweis: out.hinweis }, 200, cors);
}

/* ---------------- Worker ---------------- */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Zugangscode',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/status') {
      return json({ ok: Boolean(env.GEMINI_API_KEY), zugangscode: Boolean(env.FAMILY_CODE) }, 200, cors);
    }
    const routes = ['/chat', '/naehrwerte', '/rezept'];
    if (!routes.includes(url.pathname) || request.method !== 'POST') return json({ fehler: 'Nicht gefunden' }, 404, cors);
    if (!originOk) return json({ fehler: 'Nicht erlaubt' }, 403, cors);
    if (env.FAMILY_CODE && request.headers.get('X-Zugangscode') !== env.FAMILY_CODE) {
      return json({ fehler: 'code', antwort: 'Der Zugangscode stimmt nicht.' }, 401, cors);
    }
    if (!env.GEMINI_API_KEY) return json({ fehler: 'Der Helfer ist noch nicht eingerichtet.' }, 503, cors);

    const ip = request.headers.get('CF-Connecting-IP') || 'unbekannt';
    if (rateLimited(ip)) {
      return json({ fehler: 'Viele Fragen auf einmal – bitte in einer Stunde wieder probieren.' }, 429, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ fehler: 'Ungültige Anfrage' }, 400, cors);
    }
    if (url.pathname === '/rezept') {
      try {
        return await handleRezept(body, env, cors);
      } catch (err) {
        console.error('[Rezept]', err);
        if (err instanceof ApiError && err.status === 429) {
          return json({ fehler: 'Gerade ist viel los – bitte in einer Minute nochmal versuchen.' }, 429, cors);
        }
        return json({ fehler: 'Konnte das Rezept gerade nicht auslesen. Bitte nochmal versuchen.' }, 503, cors);
      }
    }
    if (url.pathname === '/naehrwerte') {
      try {
        return await handleNaehrwerte(body, env, cors);
      } catch (err) {
        console.error('[Nährwerte]', err);
        return json({ fehler: 'Konnte die Nährwerte gerade nicht schätzen.' }, 503, cors);
      }
    }

    const messages = validMessages(body?.messages);
    if (!messages) return json({ fehler: 'Ungültige Nachrichten' }, 400, cors);

    const list = Array.isArray(body?.liste) ? body.liste.filter((s) => typeof s === 'string').slice(0, 150).map((s) => s.slice(0, 80)) : [];
    const wissen = Array.isArray(body?.wissen) ? body.wissen.filter((s) => typeof s === 'string').slice(0, 60).map((s) => s.slice(0, 240)) : [];
    const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });

    // Gemini-Format: Rollen "user" / "model". Der aktuelle Stand (Datum, Liste)
    // kommt in die letzte Nachricht.
    const contents = messages.map((m, i) => {
      const isLast = i === messages.length - 1;
      const text = isLast
        ? `[Heute ist ${today}.\nDas weißt du über Anna und Kai:\n${wissen.length ? wissen.map((w) => `- ${w}`).join('\n') : '- noch nichts'}\nAuf der Einkaufsliste steht schon: ${list.length ? list.join(', ') : 'noch nichts'}.]\n\n${m.content}`
        : m.content;
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
    });

    const ai = createClient(env.GEMINI_API_KEY, 25000);
    try {
      const out = await generateJson(ai, {
        system: `${SYSTEM_PROMPT}\n\n${await offersContext(env)}`,
        contents,
        schema: ReplySchema,
        maxTokens: 12000,
        model: env.GEMINI_MODEL || undefined,
        retryDelayMs: 1500,
        maxModels: 3
      });
      return json({ antwort: out.antwort, artikel: out.artikel.slice(0, 40), rezepte: out.rezepte.slice(0, 2), merken: out.merken.slice(0, 5) }, 200, cors);
    } catch (err) {
      if (err instanceof GeminiBlocked) {
        return json({ antwort: 'Dabei kann ich leider nicht helfen. Frag mich gern etwas anderes rund ums Einkaufen und Kochen.', artikel: [] }, 200, cors);
      }
      if (err instanceof ApiError) {
        if (err.status === 429) return json({ fehler: 'Gerade ist viel los – bitte in einer Minute nochmal versuchen.' }, 429, cors);
        if (err.status >= 500) {
          return json({ fehler: 'Gemini ist gerade überlastet. Bitte in ein, zwei Minuten nochmal fragen.' }, 503, cors);
        }
        if (err.status === 400 || err.status === 401 || err.status === 403) {
          return json({ fehler: 'Der Helfer kommt gerade nicht an Gemini heran (Schlüssel oder Einstellung prüfen).' }, 503, cors);
        }
        return json({ fehler: `Der Helfer hat gerade ein Problem (${err.status}).` }, 502, cors);
      }
      console.error('[Helfer]', err);
      return json({ antwort: 'Da ist etwas durcheinandergeraten – magst du es nochmal fragen?', artikel: [] }, 200, cors);
    }
  }
};
