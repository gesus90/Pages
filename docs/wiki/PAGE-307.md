# Wiki-Entwurf PAGE-307: Laufdiagnose für das ganze Team

Dieser Entwurf ist für zwei Seiten bestimmt. All Might überträgt ihn nach der Abnahme:

- [Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440): Teil A als neuer Abschnitt.
- [Pages-Schnittstelle und MCP: technische Umsetzung](/wiki/6d5a37ed-6ab1-4c4e-8962-96b7f1224b5b): Teil B als neuer Abschnitt.

Die Wiki-Seiten selbst wurden von diesem Lauf nicht geändert.

## Teil A: Agent-Pläne (Leseregel, Fehlerklassen, Logs, Zeitachse)

### Befund: Bindung der Läufe an das startende Konto (vor PAGE-307)

- `backend/service/agents/AgentPlanRunReader.ts`, `loadAuthorizedPlanRun`: `if (!run || run.userId !== userId) throw new AgentError("plan_access_denied")`. Darüber liefen `AgentPlanService.run` und damit alle Lesewerkzeuge.
- `backend/database/repositories/agent/AgentPlanRunVisibilityRepository.ts` (`WHERE runs.user_id = $user_id`) und `AgentPlanRunRepository.entries` / `latestOwn` / `list` / `active` listeten nur Läufe des Kontos; `AgentPlanService.runEntries` / `runOverview` reichten das durch. Deshalb war `latestRun` bei `list_plans` für andere Konten `null`.
- `AgentPlanService.controlRun` (Stop, Pause, Resume, Restart, Cleanup) bindet ebenfalls an `run.userId === userId`. Das bleibt unverändert.
- Fehler entstanden als stabile Codes in `step.error` (`AgentError`/`AgentExecutionError`, `errorCode()` in `AgentPlanStepFailure.ts`); Logs nur als Tageslogdateien (`backend/logging/Logger.ts`) mit `runId`/`attemptId`, ohne Schritt, nicht je Lauf lesbar.

### Leseregel

Wer einen Plan sehen darf (Eigentümer, Team, geteilt: `AgentPlanAccess.require`), liest **alle** Läufe des Plans, egal wer sie gestartet hat. Umgesetzt in `AgentPlanRunTeamReader` (`backend/service/agents/diagnosis/`), erreichbar als `AgentPlanService.readableRun`. Er gilt für Laufliste, Lauf, Berichte, Diagnose, Session-Ereignisse, Checkpoints, Wiederherstellungsstand, Zeitachse und Logs. Jeder Lauf trägt `startedBy {id, displayName}`.

Prüft der Leser die Quellen eines Laufs einzeln (Tickets samt Dateianhängen, Wiki-Seiten, Arbeitsplätze) und darf eine nicht sehen, bleibt der Lauf lesbar, aber inhaltsfrei (`RunRedaction.ts`): Ergebnistexte, Berichte, Abnahme, Journal- und Skript-Ausgaben, Checkpoint-Inhalt, Ereignistexte, CLI-Logzeilen und Pfade fehlen; bei Ticket-Schritten auch der Name. Die Namen der fehlenden Felder stehen in `hiddenFields`. Status, Zeiten, Fehlerklasse, Versuche und Wiederholungsstand bleiben. Modell- und Runner-Rechte verbergen nichts.

Steuern bleibt unverändert: `controlRun`, `stop`, `pause`, `resume`, Recovery-Aktionen prüfen weiter den Starter. Die Wiederherstellungsansicht bietet Nicht-Startern keine Aktion an (`allowedActions: []`).

Die Pläne-Lesungen (`list_plans.latestRun`, `read_plan.status`, `list_plan_runs`, `read_plan_run` mit `latest`/`first`) nutzen `AgentPlanService.teamRuns` (alle Läufe des Plans).

### Fehlerklassen

Fest: `model`, `tool_missing`, `timeout`, `git`, `workspace_busy`, `permission`, `plan_invalid`, `process_crash`, `runner_unavailable`, `acceptance_failed`, `unknown`. Weitere Klassen nur durch Änderung von PAGE-307 und PMCP-13.

`AgentRunErrorClassifier.ts` ordnet jeden gespeicherten Fehlercode einer Klasse zu (feste Mengen und Präfixe); Text ohne Code ergibt `unknown` mit Code `unknown_error`. Jede Klasse hat einen festen Hinweis, jeder Code seine Meldung aus `AGENT_ERROR_MESSAGES`. Weil alle Läufe dieselben Codes tragen, werden alte Läufe beim Lesen eingeordnet. Ergebnisse tragen `errorClass`, `errorCode`, `errorHint` je Lauf und Schritt (und in Diagnose und Bericht).

### Fehlerindex

Migration `037_agent_run_diagnosis.sql`: `agent_run_failures` (ein Satz je fehlgeschlagenem Schritt), `agent_run_failure_index` (Schreibrevision, Fehler des Laufs, Endzeit). Der `AgentRunFailureIndexer` ordnet Läufe, deren `recovery_revision` vom Index abweicht, vor jeder Liste nach (läuft in mehreren Prozessen, daher kein Schreibhaken). Vor dem Löschen früherer Läufe (PAGE-255) wird der Lauf noch indexiert: Fehlerserien bleiben nach der Aufbewahrungsdauer zählbar, auch wenn der Lauf selbst fehlt (Beispiel-Lauf-IDs bevorzugen vorhandene Läufe).

### Logs

Tabelle `agent_run_logs` (Lauf, Schritt, Versuch, Zeit, Stufe, Quelle `server`/`runner`/`cli`, Text). Quellen: der Logger (`LogContext` hat jetzt `stepId`; `AgentPlanRunEngine.execute` setzt Lauf, Schritt, Versuch; Zeilen gehen über `RunLogSink`), der Runner-Ereignisdienst (`RunnerPlanEventService`) und das Sitzungsjournal (`AgentSessionJournal`, nur Fehler-/Statusereignisse; der Lauf wird über den Versuch gefunden). `AgentRunLogRecorder` filtert Zugangsdaten (`redactLogText`, `redactCredentials`), kürzt auf 8 KiB, schreibt gebündelt und löscht nach der Aufbewahrung. Austauschbar: der Sink (`registerRunLogSink`), damit Läufe ohne Modellaufrufe nachgestellt werden.

Einstellungen → Agents → „Laufdiagnose“ (`agent_run_diagnosis_settings`): Aufbewahrung in Tagen (1 bis 365, Standard 30) und Stillstandszeit in Minuten (1 bis 1440, Standard 15).

### Zeitachse

`RunTimeline.ts` baut je Schritt und Versuch: `started`, `waiting` (Grund: Wiederholungswartezeit, Arbeitsplatz belegt), `retrying`, `paused`, `resumed`, `succeeded`, `failed`, `cancelled`, mit Dauer. `stalled`: laufende Schritte, deren letztes Lebenszeichen (Sitzungsereignis, Log, Fortschrittsmeldung, Start) länger als die Stillstandszeit zurückliegt („ohne Fortschritt seit …“).

### Oberfläche

Ansicht „Läufe“ unter Agents (`/agents/runs`, Link auch im Plan-Panel): Filter (Plan, Status, Fehlerklasse, Schritt, Zeitraum, „nur meine“), Fehlerübersicht (gruppierbar), Laufliste mit Seiten und Laufansicht mit den Reitern „Schritte“, „Zeitachse“, „Logs“. Daten: `/agent-api/run-diagnosis`. Farben aus Theme-Tokens, Texte unter `runDiagnosis.*` (de/en).

## Teil B: Pages-Schnittstelle und MCP

Neue lesende Operationen (`plans.runs.search`, `plans.runs.failures`, `plans.run.timeline.read`, `plans.run.logs.read`) und Werkzeuge `list_runs`, `summarize_run_failures`, `read_plan_run_timeline`, `read_plan_run_logs` (`definition/AgentTools/PlanResources.ts`). Planvertragsversion 15. `read_plan_run_logs` ist in Lauf-Sitzungen gesperrt wie die Diagnose. Der Vertrag gilt identisch für PMCP-13. Alle Routen sind `GET`, Gerätetoken, Hülle und Fehlerformat wie die vorhandenen Routen unter `/api/mcp/v1/`. Zeiten ISO 8601, Dauern in Millisekunden. Fehler: `FORBIDDEN`, `NOT_FOUND`, `INVALID_REQUEST` (mit `reason`: `unknown_parameter`, `parameter_invalid`, `limit_out_of_range`, `time_invalid`, `time_range_reversed`, `cursor_invalid`), `PAYLOAD_TOO_LARGE`. Antworten höchstens 1 MiB; mehr über `cursor`/`nextCursor`. Nicht sichtbare Felder fehlen und stehen in `hiddenFields` (Liste, kann leer sein).

### Bestehende Lauf-Werkzeuge

Antwort = bisheriges Ergebnisobjekt, ergänzt um `startedBy {id, displayName}` und bei Fehlern `errorClass`, `errorCode`, `errorHint` je Lauf und Schritt, sowie `hiddenFields`.

| Werkzeug                       | Route (Implementierung `app/routes/api-mcp-v1-plan-run*.ts`, Tabelle `app/lib/mcp-plan-run-routes.ts`)             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `list_plan_runs`               | `/api/mcp/v1/plans/{planId}/runs?order&cursor&limit`                                                               |
| `read_plan_run`                | `/api/mcp/v1/plan-runs/{runId}`, `/api/mcp/v1/plans/{planId}/runs/latest`, `/api/mcp/v1/plans/{planId}/runs/first` |
| `read_plan_run_reports`        | `/api/mcp/v1/plan-runs/{runId}/reports?stepId`                                                                     |
| `read_plan_run_diagnostics`    | `/api/mcp/v1/plan-runs/{runId}/steps/{stepId}/diagnostics?loopId&iteration&cursor&maxBytes`                        |
| `read_plan_run_session_events` | `/api/mcp/v1/plan-runs/{runId}/steps/{stepId}/attempts/{attemptId}/events?after&before&limit&cursor&maxBytes`      |
| `read_plan_run_checkpoint`     | `/api/mcp/v1/plan-runs/{runId}/checkpoint?version&cursor&maxBytes`                                                 |
| `read_plan_run_recovery`       | `/api/mcp/v1/plan-runs/{runId}/recovery`                                                                           |

Diagnose, Ereignisse, Checkpoint und Wiederherstellung brauchen über die Route kein `planId`: Pages findet den Plan zum Lauf (`AgentPlanTeamRuns.planOf`). Die Pages-internen Werkzeuge verlangen `planId` weiter.

### `list_runs` – `/api/mcp/v1/plan-runs`

Parameter (alle optional): `projectId`, `planId`, `status`, `stepId` (Läufe, in denen dieser Schritt fehlschlug), `errorClass`, `startedById`, `from`, `to` (nach Startzeit), `cursor`, `limit` 1–100 (Standard 20). Antwort: `runs` (`runId`, `planId`, `planName`, `projectId`, `status`, `startedAt`, `endedAt` oder null, `startedBy`, `failedStepId` oder null, `errorClass` oder null, `errorCode` oder null), `total`, `nextCursor` oder null, `hiddenFields`.

### `summarize_run_failures` – `/api/mcp/v1/plan-runs/failures`

Parameter: `projectId`, `planId`, `from`, `to`, `groupBy` = `errorClass` (Standard), `plan`, `step`, `limit` 1–100 (Standard 20). Antwort: `groups` (`errorClass`, `planId`, `planName`, `stepId`, `stepLabel` je nach Gruppierung gesetzt oder null, `count`, `firstAt`, `lastAt`, `exampleRunIds` höchstens 5, `hint` oder null), `totalFailedSteps`, `from`, `to`, `hiddenFields`.

### `read_plan_run_timeline` – `/api/mcp/v1/plan-runs/{runId}/timeline`

Antwort: `runId`, `planId`, `status`, `entries` (`stepId`, `stepLabel`, `loopId`, `iteration`, `attemptId`, `event`, `at`, `durationMs`, `reason`), `stalled` (`stepId`, `attemptId`, `lastEventAt`, `stalledForMs`), `startedBy`, `hiddenFields`.

### `read_plan_run_logs` – `/api/mcp/v1/plan-runs/{runId}/logs`

Parameter: `stepId`, `attemptId`, `level` (`debug`, `info`, `warn`, `error`; Mindeststufe, Standard `info`), `from`, `to`, `cursor`, `limit` 1–500 (Standard 200). Antwort: `entries` (`at`, `level`, `source`, `stepId`, `attemptId`, `message` höchstens 8 KiB, `isFiltered`), `nextCursor`, `isTruncated`, `hiddenFields`. Für Leser ohne Zugriff auf die Inhalte fehlt `message` der `cli`-Zeilen (`hiddenFields: ["entries.message"]`).

### Offen

- Der eigenständige Client (PMCP-13) setzt denselben Vertrag um; ein Abgleich gegen `PlanResources.ts` ist bei der Abnahme zu prüfen.
- Läufe vor PAGE-307 haben keine Logzeilen; ihre Fehler werden nur eingeordnet.
