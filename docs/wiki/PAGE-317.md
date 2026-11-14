# Wiki-Entwurf PAGE-317: Gruppenchats – Entscheidungsmodell wählt, welcher Agent antwortet

Entwurf für All Might. Nach der Abnahme übertragen:

1. in [Entscheidungsmodell für Chats: Festlegungen](/wiki/d645e528-e900-4673-9de1-4d817173ccf1) die Abschnitte „Instanzweites Entscheidungsmodell“, „Wer antwortet?“ und „Ablauf und Fallback“,
2. in die Wiki-Seite der Chats bzw. Agents den Abschnitt „Heutiger Ablauf in Gruppenchats (Beleg)“ (bisher weder im Wiki noch in einem Ticket festgehalten),
3. in die Wiki-Seite der Pages-Schnittstelle den Abschnitt „Chat-Einstellung über die Schnittstelle“.

Die Wiki-Seiten liegen im Live-Dienst und wurden vom Lauf nicht geändert.

---

## Heutiger Ablauf in Gruppenchats (Beleg, Stand vor PAGE-317)

Die Stellen stehen im Stand von `main` vor dem Ticket (Commit `1d92d0d6`).

| Schritt                                                      | Datei und Stelle                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nur Nachrichten von Menschen mit Text lösen etwas aus        | `backend/service/conversation/ConversationAgentReplies.ts`, `receive()` (Zeile 233) und `answerableMessage()`; Agents starten nie eine eigene Runde                 |
| Direktchat: der Agent antwortet auf jede Nachricht           | dieselbe Datei, `answer()` (Zeile 186), Zweig `conversation.kind === "direct"` (Zeile 210)                                                                          |
| Gruppe mit @: die genannten Agents antworten, kein Verteiler | `answer()`, Zeile 220 ff. (`message.mentions`, Trigger `mention`)                                                                                                   |
| Gruppe ohne @: der **Beobachter** wird einmal gefragt        | `answer()`, Zeile 230 → `route()` (Zeile 312) → `ConversationObserverRouting.choose()` (`ConversationObserverRouting.ts`, Zeile 84)                                 |
| Der Beobachter läuft auf **Picas Chatmodell**                | `ConversationObserverModel.ask()` (`ConversationObserverModel.ts`, Zeile 171), `pica.resolve(personId)` (Zeile 220); schreibgeschützte ACP-Sitzung, keine Werkzeuge |
| Weitergabe nach einer Agent-Antwort                          | `handOver()` (Zeile 278): Agents mit @ in der Antwort antworten, sonst fragt der Beobachter erneut                                                                  |
| Schleifenschutz                                              | `CONVERSATION_OBSERVER_LIMITS` (`definition/ConversationObserver.ts`): je Agent höchstens eine Antwort je Runde, höchstens 3 automatische Antworten je Runde        |

Es gab keine Einstellung je Gruppe: jede Gruppe nutzte den Beobachter.

## Instanzweites Entscheidungsmodell

- Einstellungen → Agents hat die Karte **„Entscheidungen in Chats“** bei den Karten für Spracherkennung (STT) und Sprachausgabe (TTS), direkt über den Einstellungen für Pica.
- Sie stellt nur das Modell ein: Anbindung, Modell und Reasoning aus den für Chats freigegebenen Text-Modellen (dieselbe Regel `pica` wie für Pica). Status: „Kein Modell gewählt“, „Modell nicht verfügbar“, „Bereit“.
- Speichern dürfen nur Administratoren im aktiven Admin-Modus. Gespeichert in der Tabelle `chat_decision_settings` (Migration `042_chat_decisions.sql`), eine Zeile für die Instanz.
- Das Modell hat keine Werkzeuge und führt keine Aktionen aus: Es läuft in einer eigenen, schreibgeschützten ACP-Sitzung in einem leeren Verzeichnis, ohne MCP-Server, Web und Shell, mit hartem Zeitlimit von 2 Minuten. Es bekommt weder Zugangsdaten noch Inhalte außerhalb der Gruppe.

## „Wer antwortet?“ je Gruppenchat

Im Kopf des Gruppenchats öffnet **„Wer antwortet?“** einen Dialog. Alle Mitglieder lesen ihn, ändern dürfen alle, die den Chat verwalten (die Person, die die Gruppe angelegt hat).

| Feld                       | Werte                                                                                            | Standard         |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| Wer antwortet?             | **Alle angesprochenen Agents** (nur @), **Beobachter-Agent** (PAGE-296), **Entscheidungsmodell** | Beobachter-Agent |
| Standard-Antwortender      | ein Agent des Chats oder „Niemand“                                                               | niemand          |
| Höchstzahl Antwortende     | 1 bis 3 je Nachricht                                                                             | 2                |
| Beiträge ohne @ (PAGE-349) | 1 bis 9 je Runde, nur Beobachter und Entscheidungsmodell                                         | 8                |

- Der Standard der Betriebsart ist der **Beobachter**, weil das dem Verhalten vor PAGE-317 entspricht; bestehende Gruppen ändern ihr Verhalten nicht.
- Das Modell wird nicht je Chat gewählt. Es gilt das Entscheidungsmodell der Instanz.
- Die Höchstzahl 3 begrenzt die anfängliche Auswahl. Das getrennte Budget für Beiträge ohne @ (PAGE-349) begrenzt Beobachter und Entscheidungsmodell; @-Übergaben zählen nicht.
- „Vorschlag beim Anlegen: die Leitung der Gruppe“: Die Rollen aus PAGE-308 sind in `main` noch nicht vorhanden, der Standard-Antwortende bleibt deshalb leer. Sobald die Rollen da sind, kann das Anlegen die Leitung vorbelegen.
- Gespeichert in `conversation_reply_settings`.

## Ablauf und Fallback (Betriebsart „Entscheidungsmodell“)

1. **@ geht vor:** Wer mit @ genannt ist, antwortet; es wird nicht entschieden.
2. Ohne @ erhält das Modell die Nachricht, die letzten 8 Nachrichten der Gruppe und die Agents mit ID, Name, Benutzername und Rolle (Jobtitel aus dem Agent-Profil; eine eigene Kurzbeschreibung gibt es im Profil nicht).
3. Das Modell antwortet mit einem JSON-Objekt: `responders` (Agent-IDs, darf leer sein), `needsAnswer` (Frage oder Bitte an die Gruppe erkannt), `reason` (ein Satz), optional `suggested` (Agent-IDs, die vermutlich zuständig wären).
4. Pages übernimmt nur Agents, die Teilnehmer des Chats sind, und höchstens die eingestellte Anzahl.

| Lage                                                             | Folge                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modell wählt jemanden                                            | Die Gewählten antworten.                                                                                                                                                             |
| Kein Modell gewählt, Fehler, Zeitüberschreitung, ungültiges JSON | Fallback: Der Standard-Antwortende antwortet.                                                                                                                                        |
| Modell wählt niemanden, `needsAnswer` wahr                       | Fallback: Der Standard-Antwortende antwortet.                                                                                                                                        |
| Modell wählt niemanden, `needsAnswer` falsch                     | Niemand antwortet (Gespräch unter Menschen, „danke“).                                                                                                                                |
| Fallback, aber kein Standard-Antwortender                        | Systemhinweis im Chat: „Niemand hat geantwortet, weil nicht klar war, wer angesprochen ist. Sprich jemanden mit @ direkt an.“, mit den vorgeschlagenen Zuständigen, falls vorhanden. |

- Im Fallback bekommt der Standard-Antwortende von Pages den Hinweis, **offen** zu sagen, dass nicht klar war, wer angesprochen ist, die vorgeschlagenen Zuständigen zu nennen und darauf hinzuweisen, dass man sie mit @ direkt ansprechen kann (Trigger `fallback`, `ConversationAgentPrompt.ts`).
- Jede Entscheidung ist einmal je Nachricht gespeichert (`conversation_reply_decisions`) und im Chat unter der Nachricht als aufklappbare Zeile sichtbar: gewählte Agents oder „niemand“, Begründung, ob die Frage erkannt wurde, Vorschläge und ob ein Fallback griff. Der Systemhinweis steht sichtbar darunter.

## Schleifenschutz

- Nur Nachrichten von Menschen lösen eine Entscheidung aus. Antworten von Agents starten **nie** eine neue Entscheidung; in den Betriebsarten „Alle angesprochenen Agents“ und „Entscheidungsmodell“ fragt eine Antwort ohne @ niemanden.
- Seit PAGE-349 dürfen Agents einander mit @ beliebig oft ansprechen. Jede ausdrückliche @-Erwähnung eines anderen Agents weckt ihn, auch wenn er in der Runde schon geantwortet hat, egal wie der Satz lautet. Eine Erwähnung des eigenen Kontos startet nichts.
- Doppelschutz je Auslöser: Ein Agent startet je auslösender Nachricht höchstens einmal (eindeutiger Schlüssel `trigger_message_id` + `agent_id`). Wiederholte Ereignisse, parallele Jobs und Neustarts starten nichts doppelt.
- @-Übergaben haben keine Grenze je Runde und keine je Agent. Beiträge ohne @ (Beobachter, Entscheidungsmodell) sind auf 8 je Runde begrenzt, einstellbar bis 9; @-Übergaben verbrauchen diese Plätze nicht.
- Kettenpause: Nach 20 Agent-Nachrichten in Folge ohne Nachricht einer Person (`CONVERSATION_DECISION_LIMITS.agentStreak`) startet keine Übergabe mehr. Sie wird in `conversation_handoff_requests` gespeichert und als `conversation.agent_reply.paused` geloggt (Agent, Auslöser, Grund). Im Chat erscheint nichts.
- Schreibt danach eine Person, startet Pages die gespeicherten Übergaben automatisch, jede genau einmal, mit allen Nachrichten seit der letzten Nachricht des Agents. Übergaben, die vor einem Neustart gespeichert oder reserviert, aber nie begonnen wurden, werden beim Start ebenso angehalten und so fortgesetzt.
- Bündeln (PAGE-337): Spricht ein Agent andere mit @ an, sammelt Pages deren Antworten mit @ an ihn, bis alle geantwortet haben oder drei Minuten vergangen sind. Dann antwortet er einmal auf alle; fehlende Antworten werden genannt. Gebündelte Antworten starten ihn nicht zusätzlich. Eine verspätete Antwort nach dem Bündel weckt ihn als eigene Übergabe.
- Einen Hinweis „Abstimmung beendet, Grenze erreicht“ gibt es nicht mehr. Ein schon gespeicherter Hinweis dieser Art (`round_limit`) wird im Chat nicht angezeigt.
- Datenbankprüfung: `pnpm run postgres:conversation-check` prüft Migration 057 auf Stand 056 und den atomaren Doppelschutz gegen eine eigene, temporäre PostgreSQL-Instanz.

## Chat-Einstellung über die Schnittstelle

Die Schnittstelle des Pages-MCP-Programms (Geräte-Token einer gekoppelten Maschine) bietet:

- `GET /api/mcp/v1/conversations/{conversationId}/reply-settings` liest die Einstellung einer Gruppe, der das Konto angehört: `mode` (`mentions`, `observer`, `decision`), `defaultResponderId`, `maximumResponders`, `automaticRepliesPerOrigin` (1–9, Beiträge ohne @), `canManage` und die Agents der Gruppe.
- `PUT` auf derselben Adresse setzt sie. Ein Feld, das der Körper weglässt, behält seinen Wert; `defaultResponderId: null` entfernt den Standard-Antwortenden.
- Die Rechte sind die der Oberfläche, weil beide denselben Dienst aufrufen: Ändern darf nur, wer die Gruppe verwaltet; wer nicht Mitglied ist, erhält `not_found`. Fehlerantworten tragen nur den Code (`forbidden`, `not_found`, `invalid`).
- Das Entscheidungsmodell der Instanz wird bewusst nicht über diese Adresse gesetzt.
