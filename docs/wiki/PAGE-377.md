# PAGE-377: Wiki-Entwurf für „Agents: Festlegungen“

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Der folgende Abschnitt ergänzt die Sitzungen je Chat aus PAGE-376 um das Lagebuch.

---

## Lagebuch: chatübergreifendes Gedächtnis eines Agents (umgesetzt)

**Wozu.** Ein Agent hat je Direkt-Chat und je Gruppe eine eigene Sitzung. Das Lagebuch (`agent_logbook_entries`, Migration 058) ist sein gemeinsames, knappes Gedächtnis über alle seine normalen Chats. Es wird nur bei Bedarf gelesen; sein Text kommt in keine Runde.

**Einträge.** Fünf Arten: Entscheidung, Aufgabe/Offen, Fakt, Frage, Notiz (`decision`, `open`, `fact`, `question`, `note`). Jeder Eintrag trägt Text (höchstens 500 Zeichen), ein kurzes Thema für die Hinweiszeile, Zeit, Quelle (Chat, mit dem Namen zur Schreibzeit), die Beteiligten des Chats ohne den Agent und die Herkunft (`agent` oder `background`). Zugangsdaten werden vor dem Speichern maskiert; ein Eintrag, der in diesem Chat schon steht, wird nicht doppelt geschrieben.

**Werkzeuge** (nur in Chat-Sitzungen, an den Agent und die Sitzung gebunden, ohne Parameter für einen anderen Agent):

- `lagebuch_merken(art, text)` schreibt einen Eintrag (`entscheidung`, `aufgabe`, `fakt`, `frage`, `notiz`).
- `lagebuch_suchen(text)` liefert bis zu 10 passende Einträge, die neuesten zuerst (alle Wörter müssen in Text, Thema, Chat oder Beteiligten vorkommen).
- `lagebuch_lesen(chat, thema)` liefert bis zu 20 Einträge nach Teil des Chat-Namens und/oder Thema, ohne beides die neuesten.

Die Regel, wann er nachschlägt (etwas aus dem Kontext nicht verstanden, Bezug auf Früheres, Zusammenhänge zwischen Chats) und was er festhält, steht in den Anweisungen jeder Chat-Sitzung (`AgentEmployeeInstructions`).

**Hinweiszeile.** Jede Runde einer Chat-Sitzung trägt höchstens eine Zeile am Ende der Anweisung: „Lagebuch: 3 neue Einträge (PAGE-370, Release Freitag, Testserver)“. Sie nennt die Zahl der Einträge aus anderen Chats seit dem Stand der Sitzung (`agent_conversations.logbook_seen`) und die Themen der drei neuesten. Ohne neue Einträge entfällt die Zeile. Der Stand rückt vor, sobald die Runde gestartet ist; Einträge des eigenen Chats zählen nicht.

**Ergänzung im Hintergrund.** `AgentLogbookScheduler` (alle 30 Sekunden, nur im Prozess, der die Hintergrundarbeit besitzt) sucht Chat-Sitzungen, deren Runde nach der letzten Zusammenfassung endete (`last_activity_at` nach `logbook_processed_at`) und die so lange ruhig waren, wie die Ruhezeit des Agents sagt (Standard 2 Minuten). Hat der Agent in keinem Chat zu tun, liest `AgentLogbookSummarizer` die neuen Nachrichten des Chats (`chat_lesen`-Leser, `logbook_through` als Position), zeigt dem Modell die vorhandenen Einträge des Chats und schreibt die fehlenden mit der Herkunft „Hintergrund“. Das Modell läuft als kurzer Lauf des Agents neben den Chat-Sitzungen (Zweck `memory`, `AgentMemoryModel.logbook`) und belastet sie nicht. Gibt es keine brauchbare Antwort, bleibt der Chat fällig und wird nach 10 Minuten erneut versucht; ein langer Rückstand wird über mehrere Läufe abgearbeitet.

**Modell.** Je Agent im Reiter (`logbook_connection_id`, `logbook_model`), sonst das Modell der Instanz (Einstellungen → Agents, „Lagebuch: Modell der Hintergrund-Zusammenfassung“, `agent_session_settings`), sonst das eigene Modell des Agents. Ein Modell, das die Regel für Agents nicht mehr erfüllt, fällt auf das eigene Modell zurück (`AgentJobRequest.modelOverride`).

**Vertrauliche Chats** (`is_confidential`) schreiben nichts ins Lagebuch: `lagebuch_merken` und die Zusammenfassung lehnen sie ab, ihr Chat wird im Hintergrund nicht gelesen. Wird ein Chat vertraulich, entfernt `AgentChatPrivacyService` seine Einträge; jede Abfrage lässt zusätzlich die Einträge eines Chats aus, der jetzt vertraulich ist. Suche, Lesen, Hinweiszeile und Reiter finden nichts davon.

**Ringpuffer.** Obergrenze je Agent (Standard 200, 10 bis 2000, `logbook_limit`). Nach jedem Schreiben fallen die ältesten Einträge über der Obergrenze heraus; ein gesenkter Wert wirkt beim Speichern sofort. Ab 80 % Füllung stößt `AgentLogbookService` die Verdichtung des Agents (Dreaming, `AgentLearningService.run`) an, sofern er sie aktiviert hat und das nicht in der letzten Stunde schon geschah (`logbook_compaction_at`). Inhalt und Zeitplan der Verdichtung sind nicht Teil davon.

**Oberfläche.** Reiter „Lagebuch“ im Popup „Agent-Einstellungen“ (Endpunkt `/chat-page-api/agent-logbook`), erreichbar über „Lagebuch …“ im Kontextmenü eines Agents im Chat (öffnet den Reiter direkt) und über Einstellungen → Agents (Zeilenmenü „Lagebuch …“ oder der Reiter im Popup „Agent-Einstellungen …“). Inhalt: Füllstand, Obergrenze, Ruhezeit, Modell, Einträge mit Suche und Filtern nach Art und Chat, Herkunft, Löschen. Wer kein Administrator ist, sieht nur Einträge aus Chats, an denen er teilnimmt (eigener Direkt-Chat, Gruppen), und darf Einträge, die er sieht, löschen; Obergrenze, Ruhezeit und Modell speichert nur ein Administrator im Admin-Modus.
