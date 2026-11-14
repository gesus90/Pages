# PAGE-385: Dokumente, Tabellen und Binärdateien im Chat

Im Agenten- und Gruppen-Chat zeigt Pages Dokumente direkt, für Dateien von
Personen und von Agenten gleich (`AttachmentCards`, `fileViewOf` in
`app/components/chat-page/content/documents/document-kinds.ts`).

## Karten

- Alle Dokumentkarten nutzen den gemeinsamen Kopf (`ContentCard`): Symbol im
  hellen Akzentfeld, Name, darunter Art · Seiten bzw. Folien bzw. Blätter und
  Zeilen · Größe · Restzeit; Herunterladen (Akzent), Trennlinie, Daneben,
  Vollbild, Zuklappen. Auf schmalen Bildschirmen öffnet „Daneben“ das Vollbild.
- **PDF:** kleine Vorschau der ersten Seite mit Titel (Metadaten, sonst
  Dateiname), Seitenzahl und „Öffnen“. Daneben und im Vollbild der Viewer mit
  Zoom, „Seite X von Y“, Suche im Text und Miniaturen; das Vollbild liegt auf
  der dunklen Fläche, ← → blättern, Esc schließt. Das Original lädt erst beim
  Öffnen. Ein verschlüsseltes PDF nennt das und bleibt herunterladbar; Pages
  fragt nie nach dem Passwort.
- **Word / ODT:** lesbare Ansicht im Pages-Design (Überschriften, Absätze,
  Listen, Tabellen, Hervorhebungen, eingebettete Bilder); die Karte zeigt die
  erste Seite und „Seite 1 von N · Ganzes Dokument öffnen“. Daneben und im
  Vollbild das ganze Dokument mit Inhaltsverzeichnis aus den Überschriften und
  Suche.
- **PowerPoint / ODP:** jede Folie als eigene Karte mit Titel, Text, Tabellen
  und Bildern; Blättern in der Karte, daneben und im Vollbild mit Folienleiste,
  Suche und Pfeiltasten.
- **Excel / ODS / CSV / TSV:** Tabelle mit Blatt-Reitern, Zeilennummern,
  Spaltenbuchstaben über der ersten Zeile, Zahlen rechtsbündig, die ersten
  8 Zeilen und „N von M Zeilen · Ganze Tabelle öffnen“. Daneben und im
  Vollbild: Suche, Sortieren per Klick auf den Spaltenkopf, feste Kopfzeile,
  Markieren (Klick, Ziehen, Umschalt) mit Summe, Anzahl und Mittelwert in der
  Fußleiste, 200 Zeilen je Seite. Formeln zeigen ihren gespeicherten Wert.
  Das Trennzeichen von CSV wird erkannt, TSV nutzt den Tab.
- **Reiner Text** (`.txt`, `.log`, `.ini` … oder `text/plain`) erscheint als
  Code-Karte ohne Farben.
- **Binärdateien und alles andere** (Archive, Programme, Datenbanken, `.doc`,
  `.xls`, `.ppt` …): schlichte Zeile mit festen Spalten (`BINARY_ROW_COLUMNS`):
  Symbol · Name mit Art/Größe/Restzeit · SHA-256 gekürzt (Klick kopiert sie
  ganz) · Herunterladen. Kein Daneben, kein Vollbild, keine Vorschau.
  Dokumente über `CHAT_DOCUMENT_BYTES` (32 MB) erscheinen ebenso, mit Hinweis.

## Lesen im Browser

Office- und OpenDocument-Dateien sind ZIP-Pakete. Der Browser liest sie selbst
(`documents/zip-entries.ts` mit `DecompressionStream`, XML mit `DOMParser`);
es gibt keine Umwandlung auf dem Server und keine neue Abhängigkeit. Das
Ergebnis sind reine Daten (`document-model.ts`), die React als Text rendert.

- Makros (`vbaProject.bin`, `Basic/`, `Scripts/`), Skripte und eingebettete
  Objekte werden nie ausgeführt; ein eingebettetes Objekt wird nur benannt.
- Bilder und Verweise außerhalb der Datei (`r:link`, `TargetMode="External"`,
  `xlink:href` mit Schema) werden nie geladen. Links erscheinen nur als Link
  mit `rel="noopener noreferrer nofollow"`, und nur für http, https und mailto.
- Grenzen gegen ZIP-Bomben: 32 MB je Teil, 96 MB je Lesen; 20 000 Blöcke,
  500 Folien, 100 Blätter, 50 000 Zeilen und 200 Spalten.
- pdf.js läuft mit `isEvalSupported: false`, ohne XFA und ohne Formularebenen.

## Server

- Migration 064 legt `sha256`, `document_pages` und `document_title` an. Pages
  berechnet die SHA-256 beim Speichern jeder Datei (Uploads und Agentendateien);
  ältere Dateien zeigen „Keine Prüfsumme“.
- Seitenzahl und Titel eines PDF liest der Browser beim Erzeugen der Vorschau
  und speichert sie einmal je Anhang (`PUT`/`PATCH
  /chat-page-api/files?attachmentId=…&pageCount=…&title=…`, nur Mitglieder).
- Aufbewahrung und Rechte bleiben wie bei allen Anhängen: Dateien von Agenten
  72 Stunden mit Restzeit und Platzhalter „abgelaufen“; nur Mitglieder eines
  Chats sehen und laden dessen Dateien.
