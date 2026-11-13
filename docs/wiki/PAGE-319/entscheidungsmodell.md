Instanzweites Entscheidungsmodell, Gruppenchats, Fallback und Schutz.

[Zur Übersicht](index.md)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden

Entschieden am 11.11.2026 von Igor und All Might. Übergeordnete Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582). Umsetzung: PAGE-317. Stand: entschieden, noch nicht umgesetzt.

## Einstellung

- Unter **Einstellungen → Agents** gibt es bei den Karten für Spracherkennung (STT) und Sprachausgabe (TTS) eine eigene Karte **„Entscheidungen in Chats“**, direkt über den Einstellungen für Pica.
- Die Karte stellt **nur das Entscheidungsmodell** ein: Anbindung, Modell und Reasoning aus den freigegebenen Text-Modellen. Weitere Einstellungen gibt es dort nicht.
- Das Modell gilt für die ganze Instanz und wird **ausschließlich für Entscheidungen in Chats** verwendet, zum Beispiel welcher Agent in einem Gruppenchat ohne @-Erwähnung antwortet. Es führt keine Aktionen aus und hat keine Werkzeuge.
- Speichern nur für Administratoren im aktiven Admin-Modus, wie bei STT und TTS. Der Status zeigt „Kein Modell gewählt“, „Modell nicht verfügbar“ oder „Bereit“.

## Gruppenchats

- Je Gruppenchat wählt man nur, **ob** das Entscheidungsmodell genutzt wird, einen Standard-Antwortenden und die Höchstzahl der Antwortenden (Standard 2). Ein eigenes Modell je Chat gibt es nicht.
- @-Erwähnungen gehen immer vor; dann wird nicht entschieden.
- Ohne @ erhält das Modell die Nachricht, einen kurzen Verlauf und die Teilnehmer mit Rolle. Es liefert, wer antwortet (keiner, einer oder mehrere), ob eine Antwort nötig ist, eine kurze Begründung und optional die vermutlich Zuständigen.
- Die Entscheidung ist im Chat aufklappbar mit Begründung sichtbar.

## Fallback

- Ist kein Modell gewählt, scheitert das Modell, oder erkennt es eine Frage ohne passenden Agent, antwortet der **Standard-Antwortende**.
- Er sagt dabei **offen, dass nicht klar war, wer angesprochen ist**, nennt die vermutlich Zuständigen und weist darauf hin, dass man sie mit @ direkt ansprechen kann.
- Ohne Standard-Antwortenden erscheint ein Systemhinweis mit derselben Aussage.
- Ist keine Antwort nötig (zum Beispiel ein „danke“ oder ein Gespräch zwischen Menschen), antwortet niemand.

## Schutz

- Agent-Nachrichten lösen keine Endlosschleifen aus; es gilt der Schleifenschutz aus PAGE-311.
- Das Entscheidungsmodell erhält keine Zugangsdaten und keine Inhalte, die Teilnehmer nicht sehen dürfen.

# Offen

Keine weitere offene Sachfrage im Ausgangstext ausdrücklich ausgewiesen. Die Einordnung des Umsetzungsstands folgt den Hinweisen unter „Entschieden“.


