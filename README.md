# Anna & Kai Küche

Unsere gemeinsame Einkaufsliste mit Prospekten und Kochbuch für **Aldi Nord**, **Marktkauf Nientied**, **REWE** und **Netto** in **59348 Lüdinghausen**.
Ohne Login, in Echtzeit synchron zwischen unseren Handys, installierbar als App.

App-Adresse (nach dem ersten Deploy): **https://blomska.github.io/Anna-Kai-Kueche/**

## Was die App kann

- **Einkaufsliste:** `2x Skyr, 500 g Hähnchenbrust; Eier` wird zu drei Artikeln mit Mengen. Laden wählen (Egal / Aldi / Marktkauf / REWE / Netto), Filter oben, Kategorien in Laufweg-Reihenfolge, Abhaken mit Rückgängig, Spracheingabe, Vorschläge beim Tippen, „Oft gekauft", WhatsApp-Teilen, Display anlassen, offline nutzbar.
- **Angebote:**
  - **Aldi Nord:** Prospekt zum Durchblättern (diese und nächste Woche) und alle Angebote als durchsuchbare Liste mit Bild und Preis – automatisch.
  - **Marktkauf Nientied:** Prospektseiten und Gültigkeit automatisch; Angebote als Liste, wenn EDEKA den Abruf zulässt.
  - **REWE Lüdinghausen (Konrad-Adenauer-Str. 6):** Link zum Prospekt. REWE sperrt den automatischen Abruf (siehe unten), deshalb markiert ihr Angebote dort selbst.
  - **Netto Lüdinghausen (Olfener Str. 19, Filiale 6061):** Filialangebote als durchsuchbare Liste mit Bild und Preis und der Blätterkatalog der Filiale – automatisch. Netto hat einen Bot-Schutz; klappt der Abruf mal nicht, steht im Workflow-Protokoll `✗ Netto …` und die App zeigt den Prospekt-Link.
  - **Angebot selbst markieren:** Im Prospekt etwas gesehen? Laden antippen, Preis optional – gilt bis Samstag und erscheint auf der Liste und im Kochbuch.
  - Steht etwas von eurer Liste im Angebot, bekommt es automatisch ein Angebots-Schild mit Preis.
- **Kochbuch:**
  - **Ideen der Woche:** Gemini schlägt jede Woche 5 Rezepte aus den aktuellen Angeboten vor – ohne Zwiebeln, eiweißreich. Mit „Ins Kochbuch" übernehmen.
  - **Rezept eintragen** über ein Formular (Titel, Portionen, Zeit, Kategorie, Zutaten, Zubereitung). Rezepte lassen sich später bearbeiten.
  - **Passt zu den Angeboten:** Rezepte aus dem Kochbuch, deren Zutaten gerade im Angebot sind (Stichwort-Abgleich), die meisten Treffer zuerst.
  - **Import** aus `data/rezepte-import.json` oder direkt aus einer JSON-Datei vom Handy („JSON importieren").
  - Lieblingsrezepte, Suche, Notizen, Portionen umrechnen, ausgewählte Zutaten mit einem Tipp auf die Liste.
- **Küchenhelfer (Chat):** z. B. „Was können wir diese Woche eiweißreich kochen?" – mit Vorschlägen zum Abhaken, Rezeptkarten und „Soll ich mir das merken?".
- **Marktkauf-Produkte je Seite:** Gemini liest den Marktkauf-Prospekt, unter jeder Seite lassen sich die Produkte antippen.
- **Vorlieben:** Startwissen steht in `wissen.js` (keine Zwiebeln, eiweißreich). Helfer und Ideen der Woche halten sich daran. Einträge wie „Keine Pilze" sorgen außerdem dafür, dass passende Zutaten in Rezepten markiert und nicht automatisch auf die Liste gesetzt werden.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `style.css` | Design (Flieder, Apple-Stil, hell und dunkel) |
| `app.js` | App-Logik, Firebase-Anbindung, Kochbuch |
| `categories.js` | Kategorien, Stichwort-Wörterbuch, Eingabe-Erkennung |
| `config.js` | Firebase-Config, Listen-Name (`anna-kai`), Prospekt-Links, feste Favoriten |
| `wissen.js` | Startwissen (Vorlieben) und optionaler Wocheneinkauf |
| `data/rezepte-import.json` | Rezepte zum Importieren (Beispiel liegt bei) |
| `scripts/update-prospekte.mjs` | Holt Prospekte und Angebote nach `data/prospekte.json` |
| `scripts/ki-auswertung.mjs` | Gemini: Marktkauf-Produkte aus dem Prospekt + Ideen der Woche (`data/rezepte.json`) |
| `lib/gemini.mjs` | Gemeinsamer Gemini-Baustein (strukturierte Antworten, automatische Modellwahl) |
| `worker/` | Küchenhelfer als Cloudflare Worker `anna-kai-helfer` |
| `.github/workflows/deploy.yml` | Holt zweimal täglich die Prospekte, startet die KI-Auswertung und veröffentlicht die App |
| `.github/workflows/chat-helfer.yml` | Veröffentlicht den Küchenhelfer bei Cloudflare |
| `manifest.json`, `sw.js`, `icons/` | App-Installation und Offline-Betrieb |

---

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. Firebase vorbereiten

Die Config in `config.js` gehört zum Firebase-Projekt **`mama-einkauf`**.

1. Öffnen Sie <https://console.firebase.google.com> und wählen Sie das Projekt.
2. **Build → Firestore Database**: Falls noch keine Datenbank existiert, **Datenbank erstellen**, Standort `eur3 (Europe)`, **Produktionsmodus**.
3. **Build → Authentication → Anmeldemethode → „Anonym" aktivieren**. (Es gibt trotzdem keinen Login – die App meldet sich unsichtbar an.)
4. **Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen:** `blomska.github.io`

### 2. Firestore-Regeln einfügen

In Firestore den Reiter **Regeln** öffnen, alles ersetzen durch den folgenden Text und auf **Veröffentlichen** klicken:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /lists/{listId}/items/{itemId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 80;
    }
    match /lists/{listId}/offers/{offerId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.store in ['aldi', 'marktkauf', 'rewe', 'netto'];
    }
    match /lists/{listId}/kochbuch/{recipeId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.titel is string
        && request.resource.data.titel.size() <= 120
        && request.resource.data.zutaten is list
        && request.resource.data.zutaten.size() <= 60;
    }
    match /lists/{listId}/chat/{msgId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.role in ['user', 'assistant']
        && request.resource.data.content is string
        && request.resource.data.content.size() <= 8000;
    }
    match /lists/{listId}/wissen/{entryId} {
      allow read, delete: if request.auth != null;
      allow create, update: if request.auth != null
        && (entryId == '_start' || (request.resource.data.text is string
            && request.resource.data.text.size() <= 240));
    }
  }
}
```

> Achtung: Die Regeln ersetzen alle bisherigen Regeln dieses Firebase-Projekts. Nutzt noch eine andere App das Projekt `mama-einkauf`, prüfen Sie vorher, ob sie damit weiter funktioniert. (Mamas Einkaufs-App läuft über ein anderes Projekt, `mamas-einkaufsliste`, und ist nicht betroffen.)

### 3. GitHub Pages

**Settings → Pages → Source: GitHub Actions** (ist schon eingestellt). Nach jedem Speichern auf `main` und zweimal täglich läuft der Workflow „Prospekte aktualisieren & veröffentlichen". Von Hand: **Actions → Workflow → Run workflow**.

### 4. KI einrichten (Gemini + Küchenhelfer)

Alles läuft über **eigene** Schlüssel – das Gemini-Kontingent von Mama-Einkauf wird nicht benutzt.

Auf GitHub: **Settings → Secrets and variables → Actions → New repository secret**, vier Secrets anlegen:

| Name | Inhalt |
|---|---|
| `GEMINIAPIKEYANNA` | Gemini-Schlüssel von <https://aistudio.google.com> (Get API key) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare-Token mit der Vorlage „Edit Cloudflare Workers" (das von Mama-Einkauf geht auch) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare-Konto-ID (Dashboard rechts, „Account ID") |
| `FAMILY_CODE` | frei gewählter Zugangscode für den Helfer – neu, nicht der von Mama-Einkauf |

Danach:
1. **Actions → „Chat-Helfer veröffentlichen" → Run workflow.** Am Ende des Protokolls steht die Adresse, z. B. `https://anna-kai-helfer.<name>.workers.dev`. In `config.js` ist `https://anna-kai-helfer.blomenkemper-kai.workers.dev` eingetragen – weicht die Adresse ab, dort ändern.
2. **Actions → „Prospekte aktualisieren & veröffentlichen" → Run workflow.** Erst dieser Lauf erstellt die Ideen der Woche (bei normalen Code-Uploads fragt der Workflow Gemini nicht neu, um das Kontingent zu schonen).
3. In der App unter **Helfer** einmal den Zugangscode eingeben.

Ein bestimmtes Gemini-Modell lässt sich mit der GitHub-**Variable** `GEMINI_MODEL` erzwingen (für den Chat: `GEMINI_MODEL` unter `[vars]` in `worker/wrangler.toml`). Ohne Angabe wählt der Baustein automatisch ein verfügbares Flash-Modell.

**Kosten & Datenschutz:** Gemini-Flash hat ein kostenloses Kontingent mit Ratenlimits (<https://ai.google.dev/gemini-api/docs/pricing>). Im kostenlosen Kontingent darf Google die Eingaben zur Verbesserung seiner Produkte nutzen – nichts Vertrauliches in den Chat schreiben. Cloudflare Worker sind bis 100.000 Anfragen pro Tag kostenlos.

### 5. Aufs Handy

- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **Zum Home-Bildschirm**
- **Android (Chrome):** Seite öffnen → ⋮ → **App installieren**

---

## Rezepte importieren

Zwei Wege:

1. **Vom Handy:** Im Kochbuch auf **JSON importieren** tippen und eine `.json`-Datei auswählen.
2. **Über GitHub:** `data/rezepte-import.json` bearbeiten (Stift-Symbol auf GitHub) und speichern. Nach dem nächsten Deploy zeigt das Kochbuch „Ins Kochbuch übernehmen".

Rezepte mit einem Titel, der schon im Kochbuch steht, werden übersprungen. Format:

```json
{
  "rezepte": [
    {
      "titel": "Hähnchen-Curry mit Kichererbsen",
      "beschreibung": "Cremig, mild und richtig viel Eiweiß.",
      "kategorie": "Hauptgerichte",
      "portionen": 2,
      "dauer_minuten": 30,
      "zutaten": [
        "400 g Hähnchenbrust",
        "1 Dose Kichererbsen",
        { "name": "Basmatireis", "menge": "125 g", "vorrat": true }
      ],
      "schritte": ["Hähnchen anbraten.", "Kichererbsen dazu, 10 Minuten köcheln."]
    }
  ]
}
```

- Zutaten als Text (`"500 g Hähnchenbrust"`, `"Salz (Vorrat)"`) oder als Objekt mit `name`, `menge`, `vorrat`.
- Kategorien: `Hauptgerichte`, `Schnelle Gerichte`, `Frühstück`, `Suppen & Eintöpfe`, `Salate & Bowls`, `Snacks & Süßes`, `Backen`. Fehlt sie, rät die App.
- Eine reine Liste `[ {…}, {…} ]` geht auch.

## Wie „Passt zu den Angeboten" rechnet

Für jede Zutat (außer Vorrat und Zutaten, die ihr meidet) sucht die App ein passendes Angebot – erst mit dem ganzen Namen, dann mit dem letzten Wort („Griechischer Joghurt" → „Joghurt"). Gezählt werden automatische Angebote von Aldi, Marktkauf und Netto sowie alles, was ihr selbst markiert habt. Rezepte mit den meisten Treffern stehen oben.

## REWE: was geht und was nicht

REWE bietet keine offene Schnittstelle für Marktangebote. Die Webseite ist durch einen Bot-Schutz abgesichert, und die App-Schnittstelle verlangt ein Client-Zertifikat, das nur in der offiziellen REWE-App steckt. Das Skript versucht bei jedem Lauf trotzdem die öffentlichen Adressen und schreibt das Ergebnis ins Workflow-Protokoll (Zeile `REWE: …`). Sollte REWE den Abruf irgendwann zulassen, erscheinen die Angebote automatisch wie bei Aldi. Bis dahin: Prospekt-Link in der App öffnen und Angebote mit „Angebot selbst markieren" eintragen.

## Anpassen

- **Feste Favoriten:** `FAVORITEN` in `config.js`, z. B. `['Skyr', 'Eier']`.
- **Startwissen:** `wissen.js` – neue Einträge mit höherer `seit`-Zahl anhängen und `WISSEN_VERSION` hochzählen.
- **Wocheneinkauf-Hinweis (Do–Sa):** `WOCHENEINKAUF` in `wissen.js` füllen.
- **Nach Code-Änderungen:** in `sw.js` `CACHE_VERSION` hochzählen (z. B. `v2`), damit die Handys die neue Version laden.

## Lokal testen

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Statusanzeige oben

| Anzeige | Bedeutung |
|---|---|
| Live | Alles in Ordnung, synchron. |
| Offline | Kein Netz. Änderungen werden später abgeglichen. |
| Demo-Modus | Keine Firebase-Config – nur auf diesem Gerät. |
| Kein Zugriff | „Anonym" in Firebase aktivieren und die Regeln veröffentlichen (Schritte 1 und 2). |
