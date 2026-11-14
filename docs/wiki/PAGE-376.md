# PAGE-376: Wiki-Entwurf für „Agents: Festlegungen“

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Der folgende Abschnitt ersetzt die Beschreibung der Warteschlange im Gruppenchat aus PAGE-304
(„im Gruppenchat folgt sie als nächste Antwort desselben Agents“) und ergänzt die Sitzungen aus PAGE-335.

---

## Agent-Chats: eine dauerhafte Sitzung je Chat (umgesetzt)

**Eine Sitzung je Chat.** Ein Agent hat genau eine Sitzung je Direkt-Chat mit einer Person und genau eine je Gruppe, in der er Mitglied ist (eine Zeile von `agent_conversations` mit dem Zweck `chat` bzw. `conversation`; der eindeutige Schlüssel der Tabelle hält das). Drei Gruppen plus ein Direkt-Chat sind vier Sitzungen, egal wie viele Nachrichten folgen. Gedächtnispflege, Lernen und Automationen ohne Ziel-Chat laufen nicht in diesen Sitzungen, sondern als eigene, kurze Läufe (`isFreshSession`: neue Agent-Sitzung, nie die Fortsetzung einer früheren), und nur, solange der Agent in keinem Chat arbeitet.

**Eingangskorb.** Eine Runde bringt nur, was seit dem letzten Stand der Sitzung neu ist: In einer Gruppe steht der Stand als `delivered_sequence` (Sequenz der neuesten Nachricht, die die Sitzung bekam) an der Sitzung; die Runde enthält die Nachrichten danach mit Absender und Zeit, nie Verlauf oder Gruppenkontext erneut. Eine fortgesetzte Sitzung bekommt Verlauf und Zusammenfassung nicht erneut (`keepsContext: false`); nur eine neue oder neu gestartete Sitzung bekommt die Zusammenfassung und die letzten Nachrichten des Chats. Ältere Nachrichten holt sich der Agent mit dem Werkzeug `chat_lesen(ab)`, das fest an den Chat seiner Sitzung gebunden ist.

**Umlenken.** Schreibt jemand, während der Agent im Chat noch antwortet, geht die neue Runde als Steer in die laufende Antwort (`ConversationAgentRunner.steer`): keine zweite Antwort, keine zweite Sitzung. Die Runde der zweiten Nachricht steht auf „beantwortet“ mit der Antwort der laufenden Runde. Nimmt die laufende Antwort keinen Steer mehr an, wartet die Runde wie zuvor auf ihre eigene.

**Neustart bei vollem Kontext.** Nach jeder Runde misst `AgentChatSessionLifecycle` den Kontextfüllstand (Bericht des Adapters). Erreicht er die Schwelle des Agents (Standard 80 %, 10 bis 95 %), schreibt der Agent zuerst die Lage des Chats als Zusammenfassung fest, dann endet der Prozess, die Agent-Sitzung wird vergessen und der Eingangskorb beginnt neu. Die nächste Runde startet mit `MEMORY.md`, `DREAM.md`, der Zusammenfassung und den letzten Nachrichten. Scheitert die Zusammenfassung, startet die Sitzung trotzdem neu; der Chat bleibt benutzbar. „Neu starten“ im Popup tut dasselbe auf Knopfdruck, „Zusammenfassen“ schreibt nur die Lage fest.

**Ruhezustand mit Wiederaufnahme.** Nach der Ruhezeit des Agents (`agent_employees.chat_idle_minutes`, ohne eigenen Wert die Instanz-Einstellung, Standard 30 Minuten) endet der Prozess, die Sitzung bleibt. Pages behält die Sitzungskennung (`chat_acp_sessions`, bei jeder Runde nachgeführt, auch bei Wiederverwendung des Prozesses) und den Stand. Die nächste Nachricht setzt die Sitzung mit ACP `session/resume` fort; scheitert das, startet sie neu wie beim Neustart.

**Vertrauliche Chats.** Ein vertraulicher Chat hat seine eigene Sitzung. Die Chat-Werkzeuge einer Sitzung (`chats_list`, `chat_read`, `chat_send`, `read_conversation_context`) sind an ihren Chat gebunden (`AgentChatToolGuard`): ein anderer vertraulicher Chat liest sich wie ein nicht vorhandener, zeigt keine letzte Nachricht und liefert keine Antwort zurück.

**Automationen.** Siehe `docs/Automations.md`: Ziel-Chat `@Agentname` / `[[Chatname]]`, Lauf in der Sitzung dieses Chats, Ergebnis als Nachricht des Agents.

**Oberfläche.** Das Popup „Agent-Einstellungen“ (Reiter „Sitzungen“) öffnet sich aus dem Kontextmenü eines Agenten im Chat und aus Einstellungen → Agents; das Gruppen-Menü im Chat-Kopf bündelt Gruppenkontext, „Wer antwortet?“, Vertraulichkeit und Stummschalten. Der Endpunkt ist `/chat-page-api/agent-sessions`; ein Administrator im Admin-Modus sieht alle Sitzungen eines Agents und speichert Ruhezeit und Schwelle, alle anderen sehen nur Sitzungen ihrer eigenen Chats.
