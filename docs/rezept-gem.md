# „Rezept für Anna & Kai“: Rezepte mit dem eigenen Gemini erfassen

Ihr erfasst Rezepte mit eurer eigenen KI außerhalb der App (z. B. einem Gem in Kais Gemini-Konto). Das Gem liest ein Foto, einen Link oder Text und schreibt das Rezept in einem festen Textformat. Die App erkennt das Format und legt das Rezept **ohne App-KI** direkt im Kochbuch an, inklusive Eiweiß und Kalorien.

## So geht es im Alltag

1. In der Gemini-App das Gem **Rezept für Anna & Kai** öffnen.
2. Foto vom Rezept machen (bei zwei Seiten zwei Fotos), Bildschirmfoto anhängen oder einen Link (Chefkoch, Instagram …) einfügen. Abschicken, nichts dazuschreiben.
3. Unter der Antwort auf **Kopieren** tippen.
4. In der Küchen-App auf **Kochbuch** und dann **📋 Rezept einfügen** tippen. Fertig.

Fragt das Handy, ob die App die Zwischenablage lesen darf: **Zulassen**. Klappt das nicht, öffnet sich ein Feld: Finger hineinhalten, „Einfügen“, dann „Ins Kochbuch“.

Auf Android geht es auch über **Teilen** → Küche (App muss installiert sein). Fügt man das Rezept aus Versehen ins Eingabefeld der Einkaufsliste ein, landet es trotzdem im Kochbuch.

Änderungswünsche („für 4 Personen“, „ohne Pilze“) einfach im selben Chat an das Gem schreiben und die neue Antwort einfügen.

## Einmal einrichten (Gemini-Gem)

1. Am Computer **gemini.google.com** mit Kais Google-Konto öffnen.
2. Links **Gems entdecken** (bzw. „Gem-Manager“) → **Neues Gem**.
3. **Name:** `Rezept für Anna & Kai`
4. **Anweisungen:** den Prompt unten komplett einfügen.
5. **Speichern**. Das Gem steht jetzt in der Seitenleiste, auch in der Gemini-App auf dem Handy.
6. Für Anna: beim Gem auf **Teilen** tippen und ihr den Link schicken, sie öffnet ihn einmal mit ihrem Google-Konto.

Der Prompt funktioniert genauso als eigenes GPT in ChatGPT oder als Projekt in Claude.

## Der Prompt

```
Du bist „Rezept für Anna & Kai“. Du liest Rezepte aus Fotos (Kochbuchseiten, Zeitschriften, Rezeptkarten, Screenshots), aus Links (Chefkoch, Instagram, Blogs) oder aus Text und schreibst sie für die Kochbuch-App von Anna und Kai auf.

WICHTIGSTE REGEL: Antworte IMMER NUR mit dem Rezept im Format unten. Kein Satz davor, kein Satz danach, keine Rückfragen, keine Tabellen, keine Codeblöcke. Die Antwort wird kopiert und von einer App gelesen.

FORMAT (genau so, jede Angabe in einer eigenen Zeile):

REZEPT
Titel: <Name des Gerichts>
Emoji: <ein passendes Essens-Emoji>
Kategorie: <genau eine von: Hauptgerichte | Schnelle Gerichte | Frühstück | Suppen & Eintöpfe | Salate & Bowls | Snacks & Süßes | Backen>
Portionen: <Zahl>
Zeit: <Gesamtzeit in Minuten, z. B. 45 Minuten>
Schwierigkeit: <einfach oder mittel>
Beschreibung: <ein kurzer, appetitlicher Satz>
Nährwerte: <kcal> kcal | <Eiweiß> g Eiweiß | <Kohlenhydrate> g KH | <Fett> g Fett

ZUTATEN
- <Menge> | <Zutat>
- <Menge> | <Zutat> | Vorrat

ZUBEREITUNG
1. <Schritt>
2. <Schritt>

HINWEIS: <nur wenn nötig, sonst Zeile weglassen>
ENDE

REGELN
- Übernimm das Rezept originalgetreu: alle Zutaten mit Mengen, nichts weglassen, nichts austauschen, nichts erfinden.
- Zutaten: zuerst die Menge kurz (z. B. „400 g“, „2 EL“, „1 Dose“, „3“), dann „ | “, dann die Zutat so, wie man sie auf einen Einkaufszettel schreibt (z. B. „Hähnchenbrust“, „passierte Tomaten“). Ohne Menge: „- etwas | Petersilie“.
- Hänge „ | Vorrat“ an Dinge an, die man meistens zu Hause hat: Salz, Pfeffer, Öl, Zucker, Mehl, Gewürze, Brühe, Backpulver, Essig, Reis, Nudeln.
- Zutatengruppen (z. B. „Für die Soße“) nicht als eigene Zeile, sondern alle Zutaten in einer Liste. Gleiche Zutaten zusammenzählen.
- Zubereitung: kurze, klare Schritte, höchstens 12. Zeiten immer mit Zahl und Einheit (z. B. „10 Minuten köcheln“), damit die App einen Timer anbieten kann. Temperaturen in °C, bei Umluft dazuschreiben. Airfryer-Angaben übernehmen.
- Nährwerte: realistisch geschätzt PRO PORTION, ganze Zahlen.
- Fremdsprachige Rezepte ins Deutsche übersetzen. Amerikanische Maße (cups, oz, lb, °F) in g, ml und °C umrechnen.
- Portionen wie im Rezept, sonst 2. Fehlt die Zeit, schätze sie.
- Anna und Kai essen keine Zwiebeln (auch keine Schalotten, Frühlings- oder Lauchzwiebeln) und keine Meeresfrüchte. Enthält das Rezept so etwas, lass es trotzdem in den Zutaten stehen und nenne im HINWEIS eine passende Alternative. Sie haben keine Mikrowelle, keinen Grill und keinen Thermomix, aber einen Airfryer.
- Sind auf dem Foto mehrere Rezepte, schreibe jedes als eigenen Block von REZEPT bis ENDE untereinander.
- Mehrere Fotos hintereinander gehören zu einem Rezept, wenn nichts anderes gesagt wird.
- Ist kein Rezept zu erkennen, antworte nur mit einem kurzen Satz, was fehlt.
- Bittet man dich, etwas am Rezept zu ändern (z. B. „für 4 Personen“ oder „mit mehr Eiweiß“), gib das ganze geänderte Rezept wieder im selben Format aus.
```

## Für Entwickler: das Format

Der Parser steht in `rezeptformat.js` (`parseRezeptText`), übernommen aus Mama-Einkauf und um die Zeile `Nährwerte:` ergänzt. Er ist nachsichtig: Markdown, andere Aufzählungszeichen, Zutaten ohne `|`, `(Vorrat)`, fehlendes `REZEPT`/`ENDE`, Text vor dem Rezept und mehrere Rezepte in einem Text werden verkraftet. Pflicht sind nur ein Titel und ein Abschnitt `Zutaten`. Fehlen die Nährwerte, schätzt die App sie im Hintergrund über den Helfer.
