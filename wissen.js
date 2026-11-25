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

export const WISSEN_VERSION = 1;

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
  }
];

/**
 * Wocheneinkauf-Check: Sachen, die fast jede Woche gekauft werden.
 * Ab Donnerstag zeigt die App sie als „Fehlt noch was?"-Hinweis.
 * Leer = Hinweis ausgeblendet. Beispiel: [{ name: 'Skyr', qty: '2×' }]
 */
export const WOCHENEINKAUF = [];
