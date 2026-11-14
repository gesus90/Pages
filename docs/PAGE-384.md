# PAGE-384: Video und Audio im Chat, Erzeugen durch Agenten

## Karten

- Alle Inhaltskarten (Video, Audio, Bild, Code-Vorschau, Datei) nutzen den
  gemeinsamen Kopf `CardHead`: Symbol im hellen Akzentfeld, Name, darunter
  Art · Länge · Auflösung/Größe · Restzeit. Knöpfe: Herunterladen (Akzent),
  Trennlinie, Daneben, Vollbild, Zuklappen bzw. Schließen. Die Spalte daneben
  hebt ihren „Daneben“ als aktive Ansicht hervor.
- **Video in der Karte:** Vorschaubild, großer runder Abspielknopf (Akzent),
  unten links Auflösung, unten rechts Länge. Das Original lädt erst beim Start
  (`preload="none"`); danach die Bedienleiste mit Start/Pause, Zeit,
  Fortschritt mit geladenem Bereich, Länge, Geschwindigkeit, Ton, Vollbild.
- **Daneben:** Spalte rechts (Breite ziehbar und gemerkt) mit „Weitere Videos
  in diesem Chat“ (`GET /chat/videos/:conversationId`, nur Mitglieder). Auf
  schmalen Bildschirmen öffnet „Daneben“ das Vollbild.
- **Vollbild:** schwarze Bühne, Bedienelemente blenden sich nach 3 s ohne
  Bewegung aus. Kopf mit Position, Herunterladen, Daneben, Zur Nachricht,
  Schließen; Pfeile zum vorigen/nächsten Video; Leiste mit Geschwindigkeit,
  Untertitel (falls vorhanden), Ton, Bild-in-Bild. Tasten: Leertaste, ← → (5 s),
  ⇧← ⇧→, F, M, Esc.
- **Eine Wiedergabe:** `media-session.ts` merkt die Stelle je Datei. Eine neu
  geöffnete Ansicht (Daneben, Vollbild) übernimmt die Datei und spielt weiter,
  schließt sie, spielt die verbleibende Ansicht an derselben Stelle weiter.
  Startet ein Medium (auch eine Sprachnachricht), pausieren alle anderen.
- **Sounds:** eine Zeile je Sound mit festen Spalten (`AUDIO_ROW_COLUMNS`):
  Start/Pause · Name und Infos (13rem) · Wellenform (Rest, Klick spult) · Zeit
  „0:41 / 1:52“ (7,5rem) · Geschwindigkeit (3rem) · Herunterladen. Kein Daneben,
  kein Vollbild.

## Auflösung und Länge

Der Browser liest Auflösung und Länge beim Erzeugen des Vorschaubilds oder
beim Abspielen und speichert sie einmal je Anhang (`PUT`/`PATCH
/chat-page-api/files?attachmentId=…&width=…&height=…&durationSeconds=…`,
nur Mitglieder). Migration 063 legt `media_width`, `media_height` und
`media_duration_ms` an.

## Erzeugen durch Agenten

- Werkzeuge `video_erzeugen` und `audio_erzeugen` in Gesprächen, mit dem
  Modell der Runde und dem gespeicherten Schlüssel der Verbindung; der Agent
  sieht keinen Schlüssel. Ob ein Modell kann, folgt aus den Katalogdaten
  (`outputModalities` enthält `video` bzw. `audio`); Text+Video- und
  Text+Audio-Modelle bleiben Chat-Modelle.
- Schnittstellen: Gemini API (Video über Veo `predictLongRunning`, Audio über
  `generateContent` mit `responseModalities: ["AUDIO"]`) und OpenRouter (Audio
  über Chat Completions mit `modalities: ["text","audio"]`, gestreamt als PCM).
  OpenRouter dokumentiert dort keine Videoausgabe; solche Modelle bekommen
  „keine Schnittstelle“.
- Kann das Modell es nicht, antwortet das Werkzeug mit klarer Absage und den
  freigegebenen Modellen, die es könnten (Wechsel mit `/model`).
- Die Datei wird wie jede Agentendatei für 72 Stunden gespeichert und an die
  Antwort gehängt; Kosten werden als Aktivität `video`/`audio` dem Agenten
  zugerechnet. Der Chat zeigt währenddessen „erzeugt Video …“ bzw.
  „erzeugt Sound …“.
