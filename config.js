/**
 * config.js – ZENTRALE KONFIGURATION
 * ------------------------------------------------------------------
 * Firebase-Config aus der Firebase-Konsole
 * (Projekteinstellungen → Allgemein → "Meine Apps" → Web-App → Config).
 * Solange hier Platzhalter stehen, läuft die App im DEMO-MODUS:
 * Alles funktioniert, wird aber nur lokal auf dem Gerät gespeichert.
 *
 * Diese Werte sind KEIN Geheimnis – sie stehen bei jeder Firebase-Web-App
 * im Browser. Geschützt wird die Datenbank über die Firestore-Regeln
 * (siehe README.md).
 * ------------------------------------------------------------------
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyCwgm5lLOqCbAbCyZSrL5wl_ltOVUALCEw',
  authDomain: 'mama-einkauf.firebaseapp.com',
  projectId: 'mama-einkauf',
  storageBucket: 'mama-einkauf.firebasestorage.app',
  messagingSenderId: '247254750515',
  appId: '1:247254750515:web:9d76e627c47f2ed8a5da46'
};

/** Name der gemeinsamen Liste. Gleicher Name = gleiche Liste auf allen Geräten. */
export const LIST_ID = 'anna-kai';

/**
 * Unsichtbare anonyme Anmeldung bei Firebase (kein Login-Bildschirm).
 * In Firebase → Authentication → Anmeldemethode → "Anonym" aktivieren.
 */
export const USE_ANONYMOUS_AUTH = true;

/**
 * Feste Favoriten: stehen bei "Oft gekauft" immer vorne.
 * Leer lassen = nur das, was ihr wirklich oft kauft.
 * Beispiel: ['Skyr', 'Eier', 'Hähnchenbrust']
 */
export const FAVORITEN = [];

/** Begrüßung oben in der App: "Guten Morgen, Anna & Kai" */
export const GREETING_NAME = 'Anna & Kai';

/**
 * Adresse des Küchenhelfers (Cloudflare Worker "anna-kai-helfer", siehe README).
 * Steht nach dem ersten Lauf von "Chat-Helfer veröffentlichen" im Actions-Protokoll.
 * Leer lassen = Helfer ausgeblendet.
 */
export const CHAT_URL = 'https://anna-kai-helfer.blomenkemper-kai.workers.dev';

/** Prospekt-Links (öffnen in neuem Tab). */
export const OFFER_LINKS = {
  // Offizielle EDEKA-Prospektseite von Marktkauf Nientied (EDEKA Markt-ID 10008010)
  marktkauf: 'https://www.edeka.de/markt-id/10008010/prospekt.jsp',
  aldi: 'https://www.aldi-nord.de/prospekte.html',
  // REWE Markt Lüdinghausen, Konrad-Adenauer-Str. 6 (REWE Markt-ID 250345)
  rewe: 'https://www.rewe.de/angebote/luedinghausen/250345/rewe-markt-konrad-adenauer-str-6/',
  // Netto Marken-Discount Lüdinghausen, Olfener Str. 19 (Netto-Filiale 6061)
  netto: 'https://www.netto-online.de/ueber-netto/Online-Prospekte.chtm/6061'
};

/** Hilfsfunktion: Ist Firebase eingerichtet? */
export function isFirebaseConfigured() {
  const c = firebaseConfig;
  return Boolean(
    c && c.apiKey && c.projectId && c.appId &&
    !/^DEIN/.test(c.apiKey) && !/^DEIN/.test(c.projectId) && !/^DEIN/.test(c.appId)
  );
}
