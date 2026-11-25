/**
 * wissen.js – Startwissen fürs gemeinsame Gedächtnis
 * ------------------------------------------------------------------
 * Diese Einträge werden einmalig in das gemeinsame Gedächtnis
 * (Firebase: lists/{LIST_ID}/wissen) übernommen. Danach lassen sie sich
 * in der App unter „Vorlieben" ändern oder löschen.
 *
 * Neue Einträge: mit höherer "seit"-Version anhängen und WISSEN_VERSION
 * hochzählen – dann kommen nur die neuen Punkte dazu, Gelöschtes bleibt
 * gelöscht.
 *
 * Arten:
 *  - Vorliebe:  { id, text }
 *  - Meiden:    { id, text, meiden: ['zwiebel', …] } → passende Zutaten
 *               werden in Rezepten markiert und nicht automatisch auf
 *               die Liste gesetzt.
 *  - Ersetzung: { id, text, wenn, dann } → wer "wenn" einträgt, bekommt
 *               automatisch "dann" auf die Liste.
 * ------------------------------------------------------------------
 */

export const WISSEN_VERSION = 2;

export const START_WISSEN = [
  {
    id: 'start-zwiebeln',
    seit: 1,
    text: 'Keine Zwiebeln – auch keine Frühlings- oder Lauchzwiebeln.',
    meiden: ['zwiebel', 'schalotte']
  },
  {
    id: 'start-eiweiss',
    seit: 1,
    text: 'Wir kochen gern eiweißreich: Hähnchen, Pute, Fisch, Eier, Skyr, Quark, Hülsenfrüchte.'
  },
  // --- seit 2: Antworten von Anna und Kai (25.11.2026) ---
  {
    id: 'start-fleisch',
    seit: 2,
    text: 'Meist Geflügel (Hähnchen, Pute), manchmal Rind, selten Schwein, selten Fisch. Keine Meeresfrüchte.',
    meiden: ['garnele', 'shrimp', 'scampi', 'muschel', 'tintenfisch', 'calamar', 'krabbe', 'meeresfrücht', 'hummer']
  },
  {
    id: 'start-geschmack',
    seit: 2,
    text: 'Lieber mild gewürzt, nicht scharf. Gern italienisch, aber auch alles andere. Eher etwas weniger Kohlenhydrate, ist aber nicht wichtig.'
  },
  {
    id: 'start-portionen',
    seit: 2,
    text: 'Meist für 2 Personen, aber beide essen viel (vor allem Kai): Mengen großzügig rechnen, etwa wie für 3.'
  },
  {
    id: 'start-zeit',
    seit: 2,
    text: 'Unter der Woche wird abends gekocht, 30–60 Minuten. Am Wochenende mehr Zeit, dann auch mittags.'
  },
  {
    id: 'start-kueche',
    seit: 2,
    text: 'Wir haben einen Airfryer. Thermomix, Mikrowelle und Grill haben wir nicht. Herd, Backofen und alles andere ist da.'
  },
  {
    id: 'start-alltag',
    seit: 2,
    text: 'Frühstück: nur ein Protein-Eiskaffee. Mit zur Arbeit: Skyr mit Obst, Granola und Nüsse. Snacks am liebsten extra eiweißreich, z. B. mit Skyr oder Magerquark.'
  },
  {
    id: 'start-vorrat',
    seit: 2,
    text: 'Reis und Nudeln sind immer im Vorrat. Eigenmarken sind völlig in Ordnung.'
  },
  {
    id: 'start-milch',
    seit: 2,
    text: 'Milch immer 1,5 %.',
    wenn: 'Milch',
    dann: 'Milch 1,5 %'
  }
];

/**
 * Wocheneinkauf-Check: Sachen, die fast jede Woche gekauft werden.
 * Die App zeigt sie als „Fehlt noch was?"-Hinweis (pro Woche ausblendbar).
 * Leer = Hinweis ausgeblendet. Beispiel: [{ name: 'Skyr', qty: '2×' }]
 */
export const WOCHENEINKAUF = [
  { name: 'Skyr' },
  { name: 'Milch 1,5 %' },
  { name: 'Mandelmilch' },
  { name: 'Himbeeren' },
  { name: 'Heidelbeeren' }
];
