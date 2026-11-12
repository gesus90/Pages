# Wiki-Entwurf PAGE-311: Agents chatten miteinander und mit Personen

Dieser Entwurf ist für zwei Seiten bestimmt. All Might überträgt ihn nach der Abnahme:

- [Pages-Schnittstelle und MCP: technische Umsetzung](/wiki/6d5a37ed-6ab1-4c4e-8962-96b7f1224b5b): Teil A wird als neuer Abschnitt angehängt.
- [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582): Teil B wird als neuer Abschnitt angehängt.

Die Wiki-Seiten selbst wurden von diesem Lauf nicht geändert.

## Teil A: Technische Umsetzung

### Neuer Abschnitt: Chat-Werkzeuge der Agents (PAGE-311)

Agents lesen Chats und senden Nachrichten mit drei Werkzeugen der Pages-Schnittstelle (die nativen Pica-Werkzeuge einer Agent-Sitzung, neben `memory_search` und `chat_file_create`). Sie werden nur in Sitzungen von Agents angeboten, nie im Pica-Chat einer Person, und handeln immer als das Konto des Agents; `context.userId` ist nie ein Argument. Der eigenständige pages-mcp-Client hat sie nicht.

| Werkzeug     | Eingabe                                                                                                                          | Ergebnis                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `chats_list` | `cursor?`                                                                                                                        | Seite der Chats, an denen der Agent teilnimmt: Teilnehmer, letzte Nachricht (gekürzt), `unreadCount`, `isPaused`, `nextCursor` |
| `chat_read`  | `chatId`, `beforeMessageId?`                                                                                                     | bis zu 50 Nachrichten, älteste zuerst, `hasMore`, `isPaused`; die neueste Seite markiert den Chat für den Agent als gelesen    |
| `chat_send`  | `chatId` **oder** `target {type: person\|agent\|group, id}`, `text`, `waitForReply?`, `timeoutSeconds?` (1 bis 600, Standard 50) | `chatId`, `messageId`, `status`: `sent`, `replied` (mit `reply`), `pending` oder `paused`                                      |

Die Eingaben prüft zod (`PicaChatToolSchemas.ts`), die Fachlogik liegt im `AgentChatService`, die SQL-Zugriffe in `ConversationAgentChatRepository` und `AgentChatSettingsRepository`. Die Werkzeuge nutzen die vorhandenen gespeicherten Unterhaltungen (`conversations`, `conversation_members`, `conversation_messages`, PAGE-278); es gibt kein neues Nachrichtenmodell.

**Ziele.** `chat_send` an ein Ziel legt bei Bedarf den Direktchat (`direct_key` aus den sortierten Konto-IDs) an. Eine Gruppe als Ziel ist eine Benutzergruppe aus `assignment_targets_search`: Der Agent erhält einen eigenen Gruppenchat `usergroup-<gruppe>-<agent>` mit den Mitgliedern der Gruppe (neue Mitglieder kommen beim nächsten Senden dazu). Ein Agent darf allen schreiben, die `assignment_targets_search` ihm zeigt, und in jedem Chat, an dem er teilnimmt; bestehende Direktchats genügen ohne die Suche. Pages prüft das Ziel bei jedem Aufruf, wieder gegen die Rechte des Agents.

**Zustellung.** Die Nachricht trägt die `clientMessageId` `agent-send-<uuid>`. `ConversationAgentReplies` beantwortet sie für den angeschriebenen Agent wie die Nachricht einer Person (Direktchat: immer; Gruppe: bei `@`-Erwähnung). Die Antwort eines Agents (`reply-<id>`) löst bei niemandem eine weitere Antwort aus; ein Gespräch zwischen Agents entsteht nur, weil ein Agent bewusst wieder sendet. Die Antworten eines Agents laufen für alle seine Unterhaltungen nacheinander. Ist er mit einem anderen Auftrag beschäftigt (`busy`), wartet die Nachricht und wird alle 5 Sekunden neu versucht (bis zu 6 Stunden); sie wird nie abgewiesen. Der Antwortlauf ist dieselbe austauschbare Abhängigkeit (`ConversationAgentRunner`) wie bei Personen und damit ohne Modellaufruf nachstellbar. Jede Aktion des angeschriebenen Agents prüft Pages gegen dessen eigene Rechte.

**`waitForReply`.** Der Dienst hört vor dem Senden auf den Ereigniskanal der Unterhaltungen und liefert die erste Antwort auf genau diese Nachricht. Nach `timeoutSeconds` (höchstens 600) kommt `pending`; die Antwort erscheint später im Chat. Wird niemand zur Antwort aufgefordert (Person als Ziel, Gruppe ohne erwähnten Agent), kommt sofort `sent`. Der Brückenaufruf von `chat_send` hat 11 Minuten statt 15 Sekunden (`PicaToolClient`). Hat der Client des Modells ein kürzeres eigenes Werkzeug-Zeitlimit, bricht es die Wartezeit früher ab; die Nachricht ist dann trotzdem gesendet.

**Schutz.** Eine Kette von 10 Agent-Nachrichten ohne Nachricht einer Person pausiert die Unterhaltung (Zähler: neueste Agent-Nachrichten seit der letzten Nachricht einer Person oder der letzten Freigabe, `conversations.agent_resume_sequence`; Hinweise von Pages zählen nicht). Ein pausierter Chat nimmt keine Agent-Nachricht mehr an (`CONVERSATION_PAUSED`), die 10. Nachricht wird nicht mehr beantwortet. „Weiter erlauben“ (`resume-agents` auf der Chat-Seite, `ConversationAgentGuard.resume`) setzt die Freigabe. Je Agent gelten höchstens so viele gesendete Nachrichten je Stunde, wie unter Einstellungen → Agents steht (`agent_chat_settings.hourly_message_limit`, Standard 30, 1 bis 1000); gezählt werden nur bewusst gesendete Nachrichten (`agent-send-`), keine Antworten (`RATE_LIMITED`). Text mit zugangsdatenartigem Inhalt wird abgewiesen (`CREDENTIALS_IN_MESSAGE`), Ergebnisse der Werkzeuge werden zusätzlich geschwärzt.

Fehlercodes der Werkzeuge: `FORBIDDEN_TARGET`, `CHAT_NOT_FOUND`, `CONVERSATION_PAUSED`, `RATE_LIMITED`, `INVALID_MESSAGE`, `CREDENTIALS_IN_MESSAGE`, `INVALID_REQUEST`, `AGENT_UNAVAILABLE`, `STEP_LIMIT`. Details (zum Beispiel das Limit) stehen im Ergebnis.

**Sichtbarkeit.** Unterhaltungen, an denen nur Agents teilnehmen („Agent-Gespräch“), liest `ConversationOversight`: Administratoren im Admin-Modus alle; die Abteilungsleitung (`managed_departments`) und Projektleitung (Rolle `manager` in `project_members`) die Gespräche von Agents ihrer Abteilung beziehungsweise ihrer Projekte. Die Chat-Seite zeigt sie schreibgeschützt in der Gruppenliste mit dem Kennzeichen „Agent-Gespräch“; Leitungen und Administratoren können ein pausiertes Gespräch freigeben. Personen sehen Nachrichten von Agents an sie im Verlauf des Agents (zusammen mit der Chat-Sitzung) und in Pica Mobile; Gruppennachrichten erscheinen im Gruppenchat.

**Datenbank.** Migration `046_agent_chat.sql`: `conversations.agent_resume_sequence`, Tabelle `agent_chat_settings`, Index `conversation_messages_sender`.

## Teil B: Festlegungen

### Neuer Abschnitt: Agents chatten (PAGE-311)

- Agents lesen ihre Chats (`chats_list`, `chat_read`) und schreiben bewusst an Personen, andere Agents und Gruppen (`chat_send`). Wann Agents automatisch schreiben (zum Beispiel bei einem fertigen Task), regeln spätere Automationen; PAGE-311 liefert nur die Werkzeuge.
- Ein angeschriebener Agent antwortet wie auf die Nachricht einer Person und handelt dabei nur mit seinen eigenen Rechten. Ist er beschäftigt, wird die Nachricht eingereiht und später beantwortet, nie abgewiesen.
- Der Absender ist in jeder Nachricht als Agent erkennbar.
- Ein Agent darf allen schreiben, denen er Tickets zuweisen darf, und in jedem Chat, an dem er teilnimmt.
- Höchstens 10 Agent-Nachrichten in Folge ohne Person, danach ist der Chat angehalten („Agent-Gespräch angehalten“, „Weiter erlauben“). Höchstens 30 gesendete Nachrichten je Agent und Stunde, einstellbar unter Einstellungen → Agents. Keine Zugangsdaten in Nachrichten.
- Agent-Gespräche sind für Administratoren sowie die Abteilungs- und Projektleitung der beteiligten Agents lesbar und als „Agent-Gespräch“ gekennzeichnet.
- Offen: Gruppenleitung heißt hier Abteilungsleitung, weil Benutzergruppen keine Leitung haben; die Ausrichtung auf PAGE-308 bleibt zu prüfen.
