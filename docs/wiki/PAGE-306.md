# Wiki-Entwurf PAGE-306: Agent-TODOs live erfassen und anzeigen

Entwurf für All Might. Nach der Abnahme in die beiden Wiki-Seiten übertragen:

1. an [Agent Plan: Aufgeklappte Laufdetails mit Agent-TODO — bestätigte Referenz](/wiki/d2e41377-e5ea-41c6-9d39-3c344088a317) den Abschnitt „Umsetzung (PAGE-306)“,
2. an [Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440) den Abschnitt „Agent-TODOs eines Schritts“.

---

## Abschnitt für die Referenz: Umsetzung (PAGE-306)

Die Anzeige aus dem Konzeptentwurf vom 18.10.2026 ist umgesetzt. Sie zeigt die
TODO-Liste, die die CLI des Agenten während des Schritts als strukturierten
Plan meldet. Pages liest keine TODOs aus Fließtext.

- **Statusleiste unten:** „x von y erledigt“ und darunter der TODO, den der
  Agent als in Arbeit gemeldet hat („Aktuell: …“). Meldet er keinen, steht
  dort „Kein TODO in Arbeit gemeldet“. Die Leiste gilt für den gewählten
  Schritt, sonst für den laufenden. Ohne Liste steht dort „Keine TODO-Liste
  gemeldet“. Ein Knoten mit beobachteten Ticket-Einträgen behält seine
  Checklisten-Zahl, solange die CLI keine Liste meldet.
- **Aufgeklappte Laufdetails:** links Konfiguration und Schrittdetails, rechts
  die TODO-Checkliste „Agent-TODO“ mit begrenzter Höhe, vertikalem Scrollen und
  weichen Verläufen nur oben und unten. Unter 42 rem Breite steht die Liste
  unter den Details.
- **Knoten-Detailansicht (Terminal):** die Liste „Agent-TODO x / y“ steht in der
  Seitenleiste neben den Ereignissen und folgt dem Lauf.
- **Aktiv** ist nur ein TODO, den der Agent als in Arbeit gemeldet hat, nie die
  erste offene Zeile. Mehrere gemeldete Einträge in Arbeit sind alle aktiv.
- **Nur lesend:** keine schreibbaren Checkboxen, keine Laufsteuerung.
- **Schleifen und Gruppen:** Jede Iteration und jedes Mitglied zeigt die Liste
  seines eigenen Versuchs.
- **Farben und Sprachen:** nur Theme-Tokens (Hell und Dunkel), alle Texte über
  i18next auf Deutsch und Englisch.
- **Zustände:** `open` heißt „Als Nächstes“, `active` „Gerade in Arbeit“, `done`
  „Erledigt“.

## Abschnitt für die technische Umsetzung: Agent-TODOs eines Schritts

### Ursache (PAGE-306, 2026-11-11)

- Die Kennungen T1, T2 stammen nicht aus der CLI. Pages schreibt sie als
  Vertrag in den Prompt des Schritts (`backend/service/agents/AgentPlanContract.ts`,
  Liste „Todo list“ mit Einträgen der Ticket-Checkliste). Der Agent meldet sie
  mit `update_step_progress` (`backend/service/agents/AgentPlanStepProgressService.ts`,
  Tabelle `agent_plan_step_progress`, Schlüssel Lauf und Knoten).
- Die eigene TODO-Liste der CLI kommt als strukturiertes ACP-`plan`-Ereignis
  (Claude Code: TodoWrite). Es wurde empfangen, aber verkürzt:
  `AgentSessionRecorder.activityEvent` legte nur Text der Form `[status] inhalt`
  ohne Kennung ins Journal, `backend/agents/acp/AcpPlanActivity.ts` reduzierte
  es auf die Titel der Einträge in Arbeit (`session.activity.titles`), und
  `terminal-lines.ts` zeichnete `plan`-Ereignisse nicht („Plans feed the
  activity“). Eine strukturierte Liste je Schritt und Versuch wurde nirgends
  gespeichert, weitergegeben oder angezeigt.
- Die Statusleiste zählte nur Ticket-Checklisten-Einträge
  (`plan-status-todo-model.ts`). Die Projektion `withPlanProgress`
  (`AgentPlanProgressView.ts`) lief nur über `run.steps`, nicht über die
  Iterationsknoten von Schleifen; der Fortschritt aus `update_step_progress`
  ist je Lauf und Knoten gespeichert, nicht je Versuch.

### Erfassen und Speichern

- `AgentSessionRecorder` schreibt ein ACP-`plan` als Journal-Ereignis `plan` mit
  JSON `{"entries":[{"content","status"}]}`, höchstens 40 Einträge zu 200
  Zeichen und innerhalb der Ereignisgrenze von 4000 Zeichen.
- `AgentSessionRepository.appendEvents` übernimmt die neueste vollständige Liste
  eines Stapels in `agent_plan_agent_todos` (Migration 039, Schlüssel
  `attempt_id`, außerdem `run_id`, `step_id`, `todos_json`, `updated_at`). Der
  lokale Import (`LocalSessionImport`) läuft über denselben Pfad. Ein Fehler beim
  Speichern der Liste wird protokolliert und lässt das Journal unberührt.
- Eintrag: Kennung (Position `1`, `2`, …), Text, Status `open`, `active` oder
  `done`, Zeitpunkt der letzten Änderung. Ein Plan ersetzt die Liste; ein
  unveränderter Eintrag behält seinen Zeitpunkt. Die Erfassung gilt
  unabhängig von `completion` (`report` oder `todos`) und `completionGate`.
- Definitionen und reine Funktionen: `definition/AgentPlanAgentTodos.ts`.

### Weitergabe

- `AgentPlanAgentTodoService.listForRun` liest die Listen eines Laufs;
  `withAgentTodos` hängt die Liste als `agentTodos` an jedes Knotenergebnis,
  gesucht nach der Versuchskennung, auch in `run.loops[].iterations[].nodes`.
  `readAuthorizedPlanRun` ruft es nach den übrigen Projektionen auf.
- Der Browser prüft das Feld in `backend/agents/AgentPlanAgentTodoInput.ts` (zod).
- `read_plan_run`: `agentTodos` je Knoten, auch je Iteration. `read_plan_run_reports`:
  `agentTodos` je Bericht (`null` ohne Liste). Das bisherige Feld `todos` der
  Berichte bleibt der Vertragsstand des Abschlussberichts.
- Beim Löschen eines Laufs oder Projekts räumen `AgentPlanRunPurge` und
  `ProjectAgentDeletion` die Tabelle mit auf.

### Anzeige

`plan-agent-todo-model.ts` (Zählung, aktiver Eintrag), `plan-status-todo-count.tsx`
(Leiste), `plan-status-agent-todos.tsx` (Laufdetails rechts), `console-sidebar.tsx`
(Terminal). Der Browser holt den Lauf wie bisher regelmäßig; ein Statuswechsel
erscheint ohne Neuladen.

### Grenzen

- Liefert eine CLI kein strukturiertes `plan`, bleibt die Liste leer und die
  Anzeige sagt „Keine TODO-Liste gemeldet“.
- Eine Liste, die nicht in die Ereignisgrenze passt, verliert ihre letzten
  Einträge.
- Pläne außerhalb von PageAgentCLI-Sitzungen (reine Runner-Skripte) melden keine Liste.
- Der Vertragsfortschritt (T1, T2 aus `update_step_progress`) wird für
  Iterationsknoten von Schleifen weiterhin nicht projiziert; das war nicht
  Teil dieses Tickets.
