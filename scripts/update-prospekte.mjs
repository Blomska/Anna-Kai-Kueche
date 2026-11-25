#!/usr/bin/env node
/**
 * scripts/update-prospekte.mjs
 * ------------------------------------------------------------------
 * Holt die aktuellen Prospekte & Angebote und schreibt sie nach
 * data/prospekte.json. Läuft automatisch per GitHub Actions
 * (.github/workflows/deploy.yml), kann aber auch lokal gestartet werden:
 *
 *     node scripts/update-prospekte.mjs
 *
 * Quellen:
 *  - Aldi Nord Prospekt (diese + nächste Woche): Seitenbilder + PDF-Link
 *  - Aldi Nord Angebote: strukturierte Daten (Name, Marke, Preis, Bild)
 *  - Marktkauf Nientied Lüdinghausen: Titelbild, Gültigkeit, Prospekt-Link
 *  - REWE Lüdinghausen: Versuch, die Angebote abzurufen (meist blockiert)
 *  - Netto Lüdinghausen (Filiale 6061): Filialangebote + Blätterkatalog-Link
 *
 * Fällt eine Quelle aus, bleiben die anderen erhalten. Bei Totalausfall
 * werden die zuletzt gespeicherten Daten beibehalten.
 * Keine Abhängigkeiten – benötigt Node 18+ (eingebautes fetch).
 * ------------------------------------------------------------------
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'data/prospekte.json');

const SOURCES = {
  aldiCurrent: 'https://www.aldi-nord.de/prospekte/aldi-aktuell.html',
  aldiNext: 'https://www.aldi-nord.de/prospekte/aldi-vorschau.html',
  aldiOffers: 'https://www.aldi-nord.de/angebote.html',
  marktkauf: 'https://edeka-nientied.de/angebote-marktkauf-nientied-luedinghausen/',
  // Offizielle EDEKA-Quellen für Marktkauf Nientied (EDEKA Markt-ID 10008010, Marktnr. 071844)
  edekaOffers: [
    'https://www.edeka.de/eh/service/eh/offers?marketId=10008010',
    'https://www.edeka.de/eh/service/eh/offers?marketId=10008010&limit=999'
  ],
  edekaMarket: 'https://www.edeka.de/maerkte/071844/',
  edekaFlyerFallback: 'https://blaetterkatalog.edeka.de/RHEINRUHR/MARKTKAUF_1844/blaetterkatalog/',
  // REWE Markt Lüdinghausen, Konrad-Adenauer-Str. 6
  rewe: 'https://www.rewe.de/angebote/luedinghausen/250345/rewe-markt-konrad-adenauer-str-6/',
  // Netto Marken-Discount Lüdinghausen, Olfener Str. 19 (Netto-Filiale 6061)
  nettoFinder: 'https://www.netto-online.de/filialfinder',
  netto: 'https://www.netto-online.de/filialangebote',
  nettoProspekte: 'https://www.netto-online.de/ueber-netto/Online-Prospekte.chtm'
};

const REWE_MARKET_ID = '250345';
const NETTO_STORE_ID = '6061';

const MK_PAGES_DIR = 'data/mk-seiten';
const MAX_PAGES = 120;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9'
};

/* ---------------- Hilfsfunktionen ---------------- */

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Liest das eingebettete "apiData"-JSON der Aldi-Seiten aus. */
function extractAldiApiData(html) {
  const match = html.match(/"apiData":"((?:\\.|[^"\\])*)"/);
  if (!match) throw new Error('apiData nicht gefunden');
  const entries = JSON.parse(JSON.parse(`"${match[1]}"`));
  return Object.fromEntries(entries.map(([name, payload]) => [name, payload]));
}

/** Montag einer ISO-Kalenderwoche als YYYY-MM-DD. */
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "16.11.26" → "2026-11-16" */
function germanDateToIso(str) {
  const m = String(str).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function formatEuro(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return `${value.toFixed(2).replace('.', ',')} €`;
}

/* ---------------- Aldi: Prospekte ---------------- */

async function loadAldiFlyer(url) {
  const html = await fetchText(url);
  const api = extractAldiApiData(html);
  const structure = api.LEAFLET_IPAPER_STRUCTURE_GET;
  if (!structure?.req?.url) throw new Error('Kein Prospekt auf der Seite');

  const viewerUrl = structure.req.url.replace(/\/?$/, '/');
  const pages = (structure.res || [])
    .map((p) => ({ n: Number(p.pageNumber), url: p.url }))
    .filter((p) => p.n && p.url)
    .sort((a, b) => a.n - b.n)
    .map((p) => p.url);

  // Gültigkeit aus der Kalenderwoche im Pfad, z. B. ".../2026cw47mo..."
  const cw = viewerUrl.match(/(\d{4})cw(\d{1,2})/i);
  const validFrom = cw ? isoWeekMonday(Number(cw[1]), Number(cw[2])) : null;

  return {
    title: 'ALDI Aktuell',
    validFrom,
    validTo: validFrom ? addDays(validFrom, 5) : null,
    viewerUrl,
    pdfUrl: `${viewerUrl}GetPDF.ashx`,
    cover: pages[0] || null,
    pages
  };
}

/* ---------------- Aldi: Angebote ---------------- */

async function loadAldiOffers() {
  const html = await fetchText(SOURCES.aldiOffers);
  const api = extractAldiApiData(html);
  const data = api.OFFER_GET?.res;
  if (!data?.algoliaDataMap) throw new Error('Keine Angebotsdaten');

  // Produkt-ID → Aktions-Gruppe ("Frische-Aktion: Obst & Gemüse" …)
  const groupOf = {};
  const groups = [];
  for (const action of data.categories || []) {
    for (const block of action.content || []) {
      if (!Array.isArray(block.productIds) || !block.title) continue;
      const groupTitle = block.title.trim();
      const label = `${groupTitle} · ${action.shortTitle || action.title}`;
      if (!groups.includes(label)) groups.push(label);
      block.productIds.forEach((id) => { groupOf[id] = groupOf[id] || label; });
    }
  }

  const offers = [];
  for (const [id, p] of Object.entries(data.algoliaDataMap)) {
    if (!p || !p.name || p.isAvailable === false) continue;
    const promo = (p.promotionPrices && p.promotionPrices[0]) || {};
    const price = p.currentPrice?.priceValue ?? promo.priceValue;
    const base = (p.currentPrice?.basePrice || promo.basePrice || [])[0];
    const image = (p.assets || []).find((a) => a.type === 'primary')?.url;
    offers.push({
      id,
      name: p.name.trim(),
      brand: (p.brandName || '').trim(),
      price: formatEuro(price),
      unit: (p.salesUnit || '').trim(),
      basePrice: base && base.basePriceValue ? `1 ${base.basePriceScale} = ${formatEuro(base.basePriceValue)}` : '',
      validFrom: promo.validFromLocalDate || null,
      validTo: promo.validUntilLocalDate || null,
      group: groupOf[id] || 'Weitere Angebote',
      image: image ? `${image}?wid=320&hei=320&fit=fit,1&fmt=jpg&qlt=80` : null
    });
  }

  offers.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name, 'de'));
  return { groups: groups.filter((g) => offers.some((o) => o.group === g)), offers, sourceUrl: SOURCES.aldiOffers };
}

/* ---------------- Marktkauf Nientied ---------------- */

/** Wählt aus src/srcset die Bildgröße, die am nächsten an `width` liegt. */
function pickSrc(imgTag, width) {
  const src = imgTag.match(/\ssrc="([^"]+)"/i)?.[1];
  const srcset = imgTag.match(/\ssrcset="([^"]+)"/i)?.[1];
  if (!srcset) return src;
  const candidates = srcset.split(',').map((part) => {
    const [url, w] = part.trim().split(/\s+/);
    return { url, w: parseInt(w, 10) || 0 };
  }).filter((c) => c.url && c.w);
  if (!candidates.length) return src;
  candidates.sort((a, b) => Math.abs(a.w - width) - Math.abs(b.w - width));
  return candidates[0].url;
}

/**
 * Lädt ein Titelbild in den data-Ordner, damit es von GitHub Pages
 * ausgeliefert wird (kein Fremd-Einbinden, keine Sperren durch den Shop).
 * Bei Fehlern bleibt die Original-Adresse erhalten.
 */
async function mirrorImage(url, baseName) {
  if (!url || !/^https?:/.test(url)) return url;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const file = `${baseName}.${ext}`;
    await writeFile(resolve(ROOT, 'data', file), Buffer.from(await res.arrayBuffer()));
    return `data/${file}`;
  } catch (err) {
    console.warn(`  Bild nicht gespiegelt (${err.message}) – nutze Original-Adresse`);
    return url;
  }
}


async function loadMarktkauf() {
  const html = await fetchText(SOURCES.marktkauf);

  // Abschnitte anhand der Überschriften trennen
  const parts = html.split(/<h2[^>]*>/i).slice(1).map((chunk) => {
    const end = chunk.indexOf('</h2>');
    return { heading: stripTags(chunk.slice(0, end)), body: chunk.slice(end) };
  });

  const parseSection = (section) => {
    if (!section) return null;
    // Nur den Inhalt bis zur nächsten Überschrift / Seitenleiste betrachten
    const body = section.body.split(/<h[1-3][\s>]|<\/article|<aside|class="[^"]*(?:sidebar|widget)/i)[0];
    const text = stripTags(body);
    const dates = text.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/);
    const link = body.match(/href="(https?:\/\/[^"]*(?:flipgorilla|prospekt|\.pdf)[^"]*)"/i);
    const imgTag = link ? body.match(/<img[^>]+src="https?:\/\/[^"]+\/wp-content\/uploads\/[^>]+>/i) : null;
    const img = imgTag ? [null, pickSrc(imgTag[0], 768)] : null;
    if (!dates && !link) return null;
    return {
      title: 'Marktkauf Nientied',
      validFrom: dates ? germanDateToIso(dates[1]) : null,
      validTo: dates ? germanDateToIso(dates[2]) : null,
      viewerUrl: link ? decodeEntities(link[1]) : null,
      pdfUrl: link && /\.pdf(\?|$)/i.test(link[1]) ? decodeEntities(link[1]) : null,
      cover: img ? decodeEntities(img[1]) : null,
      pages: []
    };
  };

  const current = parseSection(parts.find((p) => /aktuelle angebote/i.test(p.heading)));
  const next = parseSection(parts.find((p) => /folgewoche/i.test(p.heading)));
  if (!current && !next) throw new Error('Keine Prospekt-Infos gefunden');
  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  if (current?.cover) current.cover = await mirrorImage(current.cover, 'marktkauf-aktuell');
  if (next?.cover) next.cover = await mirrorImage(next.cover, 'marktkauf-vorschau');
  return { current, next, pageUrl: SOURCES.marktkauf };
}

/* ---------------- Marktkauf: EDEKA-Angebote ---------------- */

function isoFromMs(ms) {
  if (!ms) return null;
  // +12 h, damit Mitternacht-UTC-Zeitstempel sicher auf dem richtigen Tag landen
  return new Date(Number(ms) + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

const MK_GROUP_ORDER = ['Obst', 'Gemüse', 'Frische', 'Brot', 'Back', 'Fleisch', 'Wurst', 'Fisch', 'Käse', 'Molkerei',
  'Kühl', 'Tiefkühl', 'Grundnahrung', 'Feinkost', 'Süß', 'Snack', 'Kaffee', 'Getränke', 'Wein', 'Spirituosen',
  'Drogerie', 'Haushalt', 'Tier', 'Non-Food'];

function groupRank(name) {
  const i = MK_GROUP_ORDER.findIndex((g) => String(name).toLowerCase().includes(g.toLowerCase()));
  return i === -1 ? 99 : i;
}

async function loadMarktkaufOffers() {
  let json = null;
  for (const url of SOURCES.edekaOffers) {
    try {
      json = JSON.parse(await fetchText(url));
      if (Array.isArray(json?.docs) && json.docs.length) break;
    } catch (err) {
      console.warn(`  ${err.message}`);
    }
  }
  if (!json) throw new Error('EDEKA-Angebote nicht erreichbar');
  const docs = Array.isArray(json.docs) ? json.docs : [];
  console.log(`  EDEKA-Antwort: ${docs.length} Angebote, Felder oben: ${Object.keys(json).join(', ')}`);
  if (!docs.length) throw new Error('Keine EDEKA-Angebote');

  const offers = docs
    .filter((d) => d && d.titel)
    .map((d) => ({
      id: String(d.angebotid ?? d.titel),
      name: String(d.titel).trim(),
      brand: '',
      price: formatEuro(Number(d.preis)),
      unit: String(d.beschreibung || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      basePrice: String(d.basicPrice || '').replace(/€\s*([\d.]+)/, (m, v) => formatEuro(Number(v))).trim(),
      validFrom: isoFromMs(d.gueltig_von ?? d.gueltig_ab) || null,
      validTo: isoFromMs(d.gueltig_bis),
      group: String(d.warengruppe || 'Weitere Angebote').trim(),
      image: d.bild_app || d.bild_web130 || d.bild_web90 || null
    }));

  const groups = [...new Set(offers.map((o) => o.group))].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, 'de'));
  offers.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name, 'de'));
  return { groups, offers, sourceUrl: 'https://www.edeka.de/markt-id/10008010/prospekt.jsp' };
}

/* ---------------- Marktkauf: offizieller EDEKA-Blätterkatalog ---------------- */

async function fetchBinary(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/') && !type.includes('pdf') && !type.includes('octet-stream')) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Lädt alle Seiten des Marktkauf-Prospekts (bk_1.jpg, bk_2.jpg, …) und legt
 * sie in data/mk-seiten/ ab – sie werden dann von GitHub Pages ausgeliefert.
 */
async function loadMarktkaufPages() {
  let base = SOURCES.edekaFlyerFallback;
  try {
    const html = await fetchText(SOURCES.edekaMarket);
    const found = html.match(/https:\/\/blaetterkatalog\.edeka\.de\/[^"'\s<>]+?\/blaetterkatalog\//i);
    if (found) base = found[0];
  } catch (err) {
    console.warn(`  Marktseite nicht lesbar (${err.message}) – nutze bekannte Adresse`);
  }
  console.log(`  Blätterkatalog: ${base}`);

  // Größte verfügbare Bildvariante wählen
  let variant = null;
  let first = null;
  for (const v of ['large', 'normal']) {
    first = await fetchBinary(`${base}${v}/bk_1.jpg`);
    if (first) { variant = v; break; }
  }
  if (!first) throw new Error('Keine Prospektseiten gefunden');

  const dir = resolve(ROOT, MK_PAGES_DIR);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const pages = [];
  let buf = first;
  for (let n = 1; n <= MAX_PAGES && buf; n++) {
    const file = `${MK_PAGES_DIR}/seite-${n}.jpg`;
    await writeFile(resolve(ROOT, file), buf);
    pages.push(file);
    buf = await fetchBinary(`${base}${variant}/bk_${n + 1}.jpg`);
  }
  console.log(`  ${pages.length} Seiten (${variant}) gespeichert`);

  let pdfUrl = null;
  try {
    const head = await fetch(`${base}pdf/complete.pdf`, { method: 'HEAD', headers: HEADERS });
    if (head.ok) pdfUrl = `${base}pdf/complete.pdf`;
  } catch { /* kein PDF */ }

  return { pages, pdfUrl, viewerUrl: `${base}index.html` };
}

/* ---------------- REWE Lüdinghausen (Versuch) ---------------- */

/**
 * REWE stellt seine Marktangebote nicht offen zur Verfügung: Die Webseite
 * ist durch einen Bot-Schutz abgesichert und die App-Schnittstelle verlangt
 * ein Client-Zertifikat aus der REWE-App. Dieses Skript versucht trotzdem
 * bei jedem Lauf die öffentlichen Adressen. Klappt es nicht, zeigt die App
 * nur den Prospekt-Link – Angebote lassen sich dann von Hand markieren.
 * Das Ergebnis steht im Protokoll des Workflows ("REWE: …").
 */

/** Sucht in beliebigem JSON nach Objekten, die wie Angebote aussehen. */
function findOfferLikeObjects(node, out = [], depth = 0) {
  if (!node || depth > 12 || out.length > 800) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findOfferLikeObjects(n, out, depth + 1));
    return out;
  }
  if (typeof node !== 'object') return out;
  const title = node.title || node.name || node.productName;
  const priceRaw = node.price ?? node.priceData?.price ?? node.pricing?.price ?? node.currentPrice;
  if (typeof title === 'string' && priceRaw != null && typeof priceRaw !== 'object') {
    const num = typeof priceRaw === 'number' ? (priceRaw > 100 ? priceRaw / 100 : priceRaw)
      : parseFloat(String(priceRaw).replace(',', '.'));
    out.push({
      id: String(node.id || node.offerId || title),
      name: title.trim(),
      brand: String(node.brand || '').trim(),
      price: Number.isFinite(num) ? formatEuro(num) : String(priceRaw),
      unit: String(node.subtitle || node.grammage || node.unit || '').trim().slice(0, 90),
      basePrice: '',
      validFrom: null,
      validTo: null,
      group: String(node.category || node.categoryTitle || 'Angebote').trim(),
      image: node.images?.[0] || node.imageURL || node.image || null
    });
    return out;
  }
  Object.values(node).forEach((v) => findOfferLikeObjects(v, out, depth + 1));
  return out;
}

async function loadRewe() {
  const attempts = [];
  const tryUrl = async (url, extraHeaders = {}) => {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders }, redirect: 'follow' });
      const body = await res.text();
      attempts.push(`${new URL(url).hostname} → HTTP ${res.status}`);
      return res.ok ? body : null;
    } catch (err) {
      attempts.push(`${new URL(url).hostname} → ${err.cause?.code || err.message}`);
      return null;
    }
  };

  let offers = [];
  // 1) App-Schnittstelle (verlangt normalerweise ein Client-Zertifikat)
  const api = await tryUrl(`https://mobile-api.rewe.de/api/v3/all-offers?marketCode=${REWE_MARKET_ID}`, { Accept: 'application/json' });
  if (api) {
    try { offers = findOfferLikeObjects(JSON.parse(api)); } catch { /* kein JSON */ }
  }
  // 2) Öffentliche Angebotsseite des Markts (eingebettete Daten)
  if (!offers.length) {
    const html = await tryUrl(SOURCES.rewe);
    const blocks = html ? [...html.matchAll(/<script[^>]*type="application\/(?:json|ld\+json)"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]) : [];
    for (const block of blocks) {
      try { offers.push(...findOfferLikeObjects(JSON.parse(block))); } catch { /* weiter */ }
    }
  }
  console.log(`  REWE: ${attempts.join(' · ')} · ${offers.length} Angebote erkannt`);
  if (offers.length < 5) throw new Error('REWE lässt keinen automatischen Abruf zu – nur Prospekt-Link');

  const seen = new Set();
  offers = offers.filter((o) => (seen.has(o.id) ? false : seen.add(o.id)));
  const groups = [...new Set(offers.map((o) => o.group))];
  return { groups, offers, sourceUrl: SOURCES.rewe };
}

/* ---------------- Netto Marken-Discount Lüdinghausen ---------------- */

/**
 * Netto zeigt die Filialangebote nur, wenn eine Filiale gewählt ist. Das
 * Skript wählt deshalb in einer eigenen Sitzung die Filiale Olfener Str. 19
 * (Netto-Filiale 6061) und liest danach die Angebotsseiten und den
 * Blätterkatalog-Link aus.
 */
// Netto lässt Desktop-Browser-Kennungen von Servern oft nicht durch, eine Handy-Kennung schon
const NETTO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Accept-Language': 'de-DE'
};

async function nettoSession() {
  const jar = new Map();
  const go = async (url, opts = {}, hops = 0) => {
    const res = await fetch(url, {
      redirect: 'manual',
      ...opts,
      headers: { ...NETTO_HEADERS, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(opts.headers || {}) }
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && hops < 5) {
      return go(new URL(res.headers.get('location'), url).href, {}, hops + 1);
    }
    return res;
  };
  const finder = await go(SOURCES.nettoFinder);
  const html = await finder.text();
  const setPath = html.match(/storefinderSetID:\s*"([^"]+)"/)?.[1];
  if (!setPath) throw new Error(`Filialfinder ohne Filialauswahl (HTTP ${finder.status})`);
  const token = html.match(/SYNCHRONIZER_TOKEN_VALUE\s*=\s*'([^']+)'/)?.[1];
  const set = await go(setPath, {
    method: 'POST',
    body: `StoreID=${NETTO_STORE_ID}${token ? `&SynchronizerToken=${token}` : ''}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
  });
  const answer = await set.text();
  if (!answer.includes(NETTO_STORE_ID)) throw new Error(`Filiale ${NETTO_STORE_ID} ließ sich nicht wählen (HTTP ${set.status})`);
  return async (url) => {
    const res = await go(url);
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.text();
  };
}

/** HTML-Text mit Umlaut-Entities → normaler Text */
function nettoText(str) {
  const map = { auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€' };
  return decodeEntities(String(str || '').replace(/&(auml|ouml|uuml|Auml|Ouml|Uuml|szlig|euro);/g, (m, k) => map[k])).replace(/\s+/g, ' ').trim();
}

/** "1.10 / l" → "1 l = 1,10 €" */
function nettoBasePrice(raw) {
  const m = String(raw || '').match(/([\d.]+)\s*\/\s*(.+)/);
  if (!m || !Number.isFinite(parseFloat(m[1]))) return String(raw || '').trim();
  return `1 ${m[2].trim()} = ${formatEuro(parseFloat(m[1]))}`;
}

/** "…23.11.26…" → "2026-11-23" (erstes Datum im Text) */
function nettoDate(text) {
  const m = String(text || '').match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

/** Produkte einer Netto-Angebotsseite (aus den Merkzettel-Links jeder Kachel). */
function parseNettoTiles(html) {
  const offers = [];
  const re = /ViewMMPWishlist-AddStoreArticle\?([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const q = new URLSearchParams(decodeEntities(m[1]));
    const name = nettoText(q.get('Name'));
    const price = parseFloat(q.get('Price'));
    if (!name || !Number.isFinite(price)) continue;
    const period = q.get('ValidityPeriod') || '';
    offers.push({
      id: `netto-${q.get('SKU') || name}`,
      name,
      brand: '',
      price: formatEuro(price),
      unit: [q.get('BundleText'), q.get('Text')].map(nettoText).filter(Boolean).join(', ').slice(0, 90),
      basePrice: nettoBasePrice(q.get('BasePrice')),
      validFrom: nettoDate(period),
      validTo: (q.get('ValidTo') || '').slice(0, 10) || nettoDate(period.split('-').pop()),
      image: q.get('Image') || null
    });
  }
  return offers;
}

async function loadNetto() {
  const get = await nettoSession();
  const main = await get(SOURCES.netto);
  if (!main.includes(NETTO_STORE_ID) && !/Olfener/i.test(main)) throw new Error('Angebotsseite gehört nicht zur Filiale Lüdinghausen');

  // Kategorien ("Obst & Gemüse", "Getränke" …) → Gruppe je Produkt
  const cats = [];
  const catRe = /<a\b[^>]*href="https:\/\/www\.netto-online\.de\/filialangebote\/(1\/\d+|2)"[^>]*>([^<]+)<\/a>/g;
  let c;
  while ((c = catRe.exec(main))) {
    const label = nettoText(c[2]);
    if (!cats.some((x) => x.path === c[1])) cats.push({ path: c[1], label });
  }
  const groupOf = {};
  const extra = [];
  const groups = [];
  const mainCount = parseNettoTiles(main).length;
  const lists = [];
  for (const cat of cats.slice(0, 25)) {
    try {
      const list = parseNettoTiles(await get(`${SOURCES.netto}/${cat.path}`));
      console.log(`  Netto ${cat.label}: ${list.length}`);
      extra.push(...list); // z. B. Wochenendangebote stehen nicht auf der Hauptseite
      // Sammel-Seiten mit fast allem (z. B. „Bedientheken-Angebote") sind keine echte Kategorie
      if (list.length && (list.length <= mainCount / 2 || cat.path === '2')) lists.push({ ...cat, list });
    } catch (err) {
      console.warn(`  Netto-Kategorie ${cat.label}: ${err.message}`);
    }
  }
  // Kleinste Kategorie zuerst: „Obst & Gemüse" schlägt „Knüller der Woche"
  [...lists].sort((x, y) => x.list.length - y.list.length).forEach(({ label, list }) => {
    list.forEach((o) => { if (!groupOf[o.id]) groupOf[o.id] = label; });
  });
  lists.forEach(({ label }) => { if (!groups.includes(label)) groups.push(label); });

  const byId = new Map();
  [...parseNettoTiles(main), ...extra].forEach((o) => { if (!byId.has(o.id)) byId.set(o.id, o); });
  const offers = [...byId.values()].map((o) => ({ ...o, group: groupOf[o.id] || 'Weitere Angebote' }));
  if (!offers.length) throw new Error('Keine Angebote auf der Filialseite gefunden');
  if (offers.some((o) => o.group === 'Weitere Angebote')) groups.push('Weitere Angebote');
  offers.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.name.localeCompare(b.name, 'de'));

  // Blätterkatalog der Filiale
  let current = null;
  try {
    const page = await get(`${SOURCES.nettoProspekte}/${NETTO_STORE_ID}`);
    const viewerUrl = decodeEntities(page.match(/href="(https:\/\/wochenprospekt\.netto-online\.de\/[^"]+)"/)?.[1] || '');
    const cover = decodeEntities(page.match(/(https:\/\/www\.netto-online\.de\/media_nfs\/images\/[^"' ]*flipbook[^"' ]*\.jpg[^"' ]*)/)?.[1] || '');
    // Häufigstes Enddatum = Ende der Angebotswoche
    const count = {};
    offers.forEach((o) => { if (o.validTo) count[o.validTo] = (count[o.validTo] || 0) + 1; });
    const validTo = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (viewerUrl) {
      current = {
        title: 'Netto Filial-Angebote',
        validFrom: offers.map((o) => o.validFrom).filter(Boolean).sort()[0] || null,
        validTo,
        viewerUrl,
        cover: cover || null
      };
    }
  } catch (err) {
    console.warn(`  Netto-Prospekt: ${err.message}`);
  }

  return {
    current,
    offers: { groups: groups.filter((g) => offers.some((o) => o.group === g)), offers, sourceUrl: SOURCES.netto }
  };
}

/* ---------------- Hauptprogramm ---------------- */

async function settle(label, fn) {
  try {
    const value = await fn();
    console.log(`✓ ${label}`);
    return value;
  } catch (err) {
    console.warn(`✗ ${label}: ${err.message}`);
    return undefined;
  }
}

async function main() {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch { /* erste Ausführung */ }

  const [aldiCurrent, aldiNext, aldiOffers, marktkauf, mkOffers, mkPages, reweOffers, netto] = await Promise.all([
    settle('Aldi Prospekt (diese Woche)', () => loadAldiFlyer(SOURCES.aldiCurrent)),
    settle('Aldi Prospekt (nächste Woche)', () => loadAldiFlyer(SOURCES.aldiNext)),
    settle('Aldi Angebote', loadAldiOffers),
    settle('Marktkauf Prospekt (Nientied-Seite)', loadMarktkauf),
    settle('Marktkauf Angebote (EDEKA)', loadMarktkaufOffers),
    settle('Marktkauf Prospektseiten (EDEKA)', loadMarktkaufPages),
    settle('REWE Angebote', loadRewe),
    settle('Netto Angebote & Prospekt', loadNetto)
  ]);

  // Marktkauf zusammenführen: Daten der Nientied-Seite + EDEKA-Prospektseiten + EDEKA-Angebote
  const mk = marktkauf ?? previous.marktkauf ?? { current: null, next: null, pageUrl: SOURCES.marktkauf };
  if (mkPages?.pages?.length) {
    const validTo = mkOffers?.offers?.map((o) => o.validTo).filter(Boolean).sort().pop() || null;
    mk.current = {
      title: 'Marktkauf Nientied',
      validFrom: mk.current?.validFrom ?? (validTo ? addDays(validTo, -5) : null),
      validTo: mk.current?.validTo ?? validTo,
      ...mk.current,
      viewerUrl: mkPages.viewerUrl,
      pdfUrl: mkPages.pdfUrl,
      cover: mkPages.pages[0],
      pages: mkPages.pages
    };
  } else if (mk.current?.pages?.length && !mkPages) {
    // Seiten konnten nicht neu geladen werden und liegen nicht im Repository → nicht verlinken
    mk.current.pages = [];
  }
  mk.offers = mkOffers ?? null;

  const result = {
    updatedAt: new Date().toISOString(),
    aldi: {
      pageUrl: 'https://www.aldi-nord.de/prospekte.html',
      current: aldiCurrent ?? previous.aldi?.current ?? null,
      next: aldiNext ?? previous.aldi?.next ?? null,
      offers: aldiOffers ?? previous.aldi?.offers ?? null
    },
    marktkauf: mk,
    rewe: {
      pageUrl: SOURCES.rewe,
      current: null,
      next: null,
      // Nur frische REWE-Daten verwenden – alte Angebote wären womöglich abgelaufen
      offers: reweOffers ?? null
    },
    netto: {
      pageUrl: `${SOURCES.nettoProspekte}/${NETTO_STORE_ID}`,
      // Netto-Angebote gelten Mo–Sa: alte Daten nur bis zu ihrem Enddatum behalten
      current: netto?.current ?? (previous.netto?.current?.validTo >= new Date().toISOString().slice(0, 10) ? previous.netto.current : null),
      next: null,
      offers: netto?.offers ?? previous.netto?.offers ?? null
    }
  };

  // Vorschau = gleiche Woche wie aktuell? Dann weglassen.
  if (result.aldi.next && result.aldi.current && result.aldi.next.viewerUrl === result.aldi.current.viewerUrl) {
    result.aldi.next = null;
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(result, null, 1)}\n`);
  const count = result.aldi.offers?.offers?.length ?? 0;
  const mkCount = result.marktkauf.offers?.offers?.length ?? 0;
  const reweCount = result.rewe.offers?.offers?.length ?? 0;
  const nettoCount = result.netto.offers?.offers?.length ?? 0;
  console.log(`→ ${OUT_FILE} geschrieben (${count} Aldi-Angebote, ${mkCount} Marktkauf-Angebote, ${reweCount} REWE-Angebote, ${nettoCount} Netto-Angebote, ${result.marktkauf.current?.pages?.length ?? 0} Marktkauf-Seiten)`);

  if (!aldiCurrent && !aldiOffers && !marktkauf) {
    console.error('Alle Quellen fehlgeschlagen – alte Daten beibehalten.');
    process.exitCode = previous.updatedAt ? 0 : 1;
  }
}

main();
