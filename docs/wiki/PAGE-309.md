# Wiki-Entwurf PAGE-309: Einmal-Pläne – nach erfolgreichem Lauf automatisch löschen

Entwurf für All Might. Nach der Abnahme in die beiden Wiki-Seiten übertragen:

1. an [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582) den Abschnitt „Einmal-Pläne (PAGE-309)“,
2. an [Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440) den Abschnitt „Einmal-Pläne: Löschablauf und Schnittstelle“.

Die Wiki-Seiten liegen im Live-Dienst und wurden vom Lauf nicht geändert.

---

## Abschnitt für „Agents: Festlegungen“: Einmal-Pläne (PAGE-309)

Eine einmalige Aufgabe lässt sich als **Einmal-Plan** anlegen. Endet einer seiner
Läufe vollständig erfolgreich, löscht Pages den Plan 5 Minuten später samt allem,
was nur für diesen Plan existiert. Scheitert der Lauf oder bleibt er offen,
bleibt der Plan stehen, damit man den Fehler untersuchen und weitermachen kann.
Normale Pläne verhalten sich unverändert.

### Einstellung und Kennzeichnung

- **Schalter „Einmal-Plan“** in den Plan-Einstellungen (Menü ⋯ → Bearbeiten). Wer
  den Plan ändern darf (`canEdit`: Eigentümer oder Mitglied/Leiter des Teams),
  darf ihn setzen und entfernen. Beim Einschalten erklärt ein Bestätigungsdialog:
  Plan und Läufe werden nach erfolgreichem Abschluss gelöscht, Commits, Branches,
  Ticket- und Wiki-Änderungen, Anhänge und gemeinsam genutzte Ressourcen bleiben.
  Ausschalten braucht keine Bestätigung. Der Schalter wird wie jede
  Plan-Einstellung mit „Speichern“ gespeichert (neue Revision).
- **„Als Einmal-Plan kopieren“** im selben Menü: legt eine Kopie mit gesetztem
  Schalter an (Rechte wie „Klonen“). Namensvorschlag: `<Name> · einmalig · <Datum>`
  (`YYYY-MM-DD`, auf 120 Zeichen gekürzt). Eine gewöhnliche Kopie übernimmt den
  Schalter eines Einmal-Plans **nicht**.
- Einmal-Pläne tragen das Kennzeichen „Einmal-Plan“ im Plan-Kopf und in der
  Planauswahl.
- Zwischen erfolgreichem Ende und Löschung zeigt der Plan-Kopf
  „Wird um <Uhrzeit> gelöscht“ (lokale Zeit) und die Aktion **„Behalten“**. Sie
  entfernt den Schalter und bricht das Löschen ab.

### Wann gelöscht wird

| Ende des Laufs                                                                  | Wirkung                     |
| ------------------------------------------------------------------------------- | --------------------------- |
| `succeeded`                                                                     | Frist von 5 Minuten beginnt |
| `failed`, `cancelled`, `paused`, blockierte Schritte, `work_done_closeout_open` | Plan bleibt; keine Frist    |
| später fortgesetzter oder neu gestarteter Lauf endet mit `succeeded`            | Frist beginnt dann          |

- Ein neuer Lauf des Plans (Start, Neustart, Fortsetzung) bricht eine laufende
  Frist ab; sie beginnt erst mit dem Erfolg dieses Laufs neu.
- Die Frist wird beim Plan gespeichert und überdauert einen Neustart des
  Dienstes: Ein fälliges Löschen wird nach dem Start nachgeholt.
- Vor dem Löschen prüft Pages noch einmal: Hat der Plan den Schalter nicht mehr,
  läuft er gerade oder endete sein neuester Lauf nicht mit `succeeded`, bleibt
  er bestehen und die Frist entfällt.

### Was gelöscht wird

- Der Plan mit Revisionen und Parametern (sie gehören zur Plan-Zeile).
- Alle Läufe des Plans mit Berichten, Diagnosen, Session-Ereignissen,
  Checkpoints, Agent-TODOs, Benachrichtigungen und Logs.
- Sitzungsverzeichnisse, temporäre Arbeitskopien, lokale Sitzungsjournale,
  Nutzlast-Dateien und Reservierungen von Arbeitsplätzen, die für diesen Plan
  angelegt wurden.
- Gelöscht wird nur, was Pages beim Anlegen oder während der Läufe **nachweislich**
  für diesen Plan erzeugt hat: Pages merkt sich jedes Artefakt beim Erzeugen als
  Zeile eines Laufs dieses Plans (Lauf, Versuch, lokaler Sitzungsbesitzer,
  Arbeitsplatz-Sperre, Nutzlast). Es gibt keine Suche im Dateisystem nach
  Mustern. Ein Lauf, der noch eine Sperre, ein Lease, eine offene Bereinigung
  oder einen nicht freigegebenen Sitzungsbesitzer hält, wird erst gelöscht, wenn
  das abgeschlossen ist; die Löschung wird dann erneut versucht.

### Was nicht gelöscht wird

- Commits und gepushte Branches, Änderungen an Tickets und Wiki-Seiten,
  angehängte Dateien und alles, was der Plan bewusst als Ergebnis erzeugt hat.
- Gemeinsam genutzte Arbeitsplätze, Agents, Vorlagen und Parameter anderer Pläne.

### Nachvollziehbarkeit

- Pages behält **keinen** Abschlussbericht.
- Das Änderungsprotokoll des Projekts (Aktivität, Kategorie „Projekt“) erhält
  genau einen Eintrag: `Einmal-Plan "<Name>" nach erfolgreichem Lauf gelöscht
(Eigentümer: <Name>).` Der Eintrag trägt den Zeitpunkt und den Eigentümer des
  Plans als Urheber.
- Später kann eine Automation vor dem Löschen einen Abschlussbericht an eine
  Person oder einen Agent übergeben. Das ist nicht Teil von PAGE-309. Der
  Löschablauf hat dafür den Einhängepunkt „vor dem Löschen“ (siehe unten).

---

## Abschnitt für die technische Umsetzung: Einmal-Pläne: Löschablauf und Schnittstelle

### Daten

- Die Markierung ist das Feld `oneShot` (nur `true` wird gespeichert) im
  gespeicherten Plan-JSON (`AgentPlanInput.oneShot`). Sie läuft damit durch jede
  Speicher-, Klon- und Lesestrecke wie jede andere Plan-Einstellung; `false` und
  fehlend sind gleich. Der Klon-Prüfer `requireCloneablePlan` kennt das Feld.
- Die Frist steht in der neuen Spalte `agent_plans.one_shot_delete_at`
  (ISO 8601, UTC; Migration `040_agent_plan_one_shot.sql`, Teilindex auf gesetzte
  Werte). Sie steht nie im Plan-JSON: der Repository-Schreibpfad filtert
  `scheduledDeletionAt` heraus. Ein Speichern ohne Markierung setzt die Spalte im
  selben `INSERT … ON CONFLICT` auf `NULL` und bricht so ein geplantes Löschen ab.
- Zeit und Läufe sind austauschbare Abhängigkeiten
  (`AgentPlanOneShotDependencies`: `now`, `purgeRuns`, `repository`, `hooks`;
  `AgentPlanOneShotScheduler`: `timer`, `intervalMs`), damit Frist und Löschen
  ohne echte Modellaufrufe und ohne Warten nachgestellt werden können.

### Ablauf

1. `AgentPlanOneShotScheduler` ist ein `AgentPlanRunObserver` und läuft nur in dem
   Prozess, der Läufe verarbeitet (`canProcessRuns()`, Start in
   `startOwnedPlanProcessing` über `startOneShotPlanDeletion`).
   - `runChanged`: wechselt ein Lauf auf `succeeded`, ruft er
     `scheduleAfterSuccess(planId)` auf → `one_shot_delete_at = jetzt + 5 min`,
     aber nur wenn das Plan-JSON `oneShot: true` trägt.
   - `runStarted`: `cancel(planId)` – ein neuer Lauf nimmt die Frist zurück.
2. Der Planer prüft beim Start und danach alle 15 Sekunden
   `deleteDue()`: alle Pläne mit `one_shot_delete_at <= jetzt`. Dadurch wird auch
   ein während eines Neustarts fällig gewordenes Löschen nachgeholt.
3. `deleteIfDue(planId)` (`AgentPlanOneShotService`):
   1. Kandidat lesen (`findCandidate`): Markierung, Frist, aktiver Lauf, Status
      des neuesten Laufs. Ohne Markierung/Frist → `kept`; Frist noch nicht um →
      `not_due`; aktiver Lauf oder neuester Lauf nicht `succeeded` → Frist
      verwerfen, `kept`.
   2. **Einhängepunkt:** `hooks[].beforeDelete(kandidat)` (`OneShotBeforeDeletionHook`).
      Hier hängt später die Automation „Abschlussbericht übergeben“ ein; wirft ein
      Hook, bleibt der Plan und die Löschung wird erneut versucht. PAGE-309 liefert
      keinen Hook aus.
   3. `purgeAllPlanRuns(database, planId)` löscht jeden Lauf in einer eigenen
      Transaktion über die Retention-Strecke von PAGE-255 (`deleteRun`): Lauf-Tabellen,
      Session-Journal; die Trigger von `agent_plan_runs` und
      `agent_local_session_owners` legen Sitzungsverzeichnisse, lokale
      Sitzungsjournale und Nutzlast-Dateien in `agent_payload_garbage` ab, die der
      Hintergrund-Sammler mit Wiederholung löscht. Ein nicht abgeschlossener Lauf
      liefert `false` → Ergebnis `waiting`, die Frist bleibt, der nächste Takt versucht es erneut.
   4. `AgentPlanOneShotRepository.deletePlan` löscht in **einer** Transaktion unter
      `FOR UPDATE`: prüft Markierung, Frist und dass kein Lauf mehr existiert,
      löscht Start-Ablehnungen und Plan-Zeile (der Trigger `agent_plan_payload_garbage`
      legt die Nutzlast des Plans zum Löschen ab) und schreibt den einen Eintrag in
      `project_activity` (Kategorie `project`, Aktion `one_shot_plan_deleted`).
      Hat inzwischen ein Lauf begonnen, ändert sich nichts.
4. **Behalten** (`AgentPlanRepository.keepOneShot`, über `AgentPlanService.keep`):
   Rechte wie Bearbeiten (`canEdit`), erwartete Revision, entfernt `oneShot` aus dem
   Plan-JSON, erhöht die Revision, setzt die Frist auf `NULL`; abgelehnt mit
   `plan_pause_required`, solange ein Lauf Schritte ausführt. Ein Plan ohne
   Markierung bleibt unverändert (`changed: false` entspricht keiner neuen Revision).

### Schnittstelle

- `create_plan`, `update_plan`: Feld `oneShot` (boolean). Bei `update_plan`
  entfernt `false` die Markierung und bricht das Löschen ab; ohne Angabe bleibt der
  Wert. Eine Änderung, die nur `oneShot` betrifft, zählt als Änderung
  (`planKey`).
- `read_plan`, `list_plans`, `read_plan_control`: `oneShot` (immer) und
  `scheduledDeletionAt` (nur während eine Löschung ansteht).
- `clone_plan`: neuer Parameter `oneShot` (boolean, Standard `false`).
- **`keep_plan`** (neue Operation `plans.keep`; `planId`, `expectedRevision`,
  `operationId`): bricht ein geplantes Löschen ab und entfernt `oneShot`, mit den
  Rechten der Oberfläche (`canEdit`). Ergebnis: `planId`, `revision`, `control`.
  Auch im Pica-Katalog (`ChatToolCatalog`) ergänzt.
- `AGENT_PLAN_CONTRACT_VERSION` steigt auf 15 (jetzt in
  `definition/AgentPlanCapabilities.ts`).
- Oberfläche: Route-Intents `clone-plan` (zusätzlich `oneShot=true`) und
  `keep-plan` (`planId`, `revision`, `requestKey`) an `/agents/plans`.

### Dateien

`definition/AgentPlanOneShot.ts`, `backend/database/postgres/migrations/040_agent_plan_one_shot.sql`,
`backend/database/repositories/agent/AgentPlanOneShotRepository.ts`,
`backend/service/agents/AgentPlanOneShotService.ts`,
`backend/service/agents/AgentPlanOneShotScheduler.ts`,
`app/lib/agent-plan-one-shot-services.server.ts`; geändert u. a. `AgentPlanRepository`,
`AgentPlanRunPurge` (`purgeAllPlanRuns`), `AgentPlanInput`, `AgentPlanClone`,
`AgentPlanManagement`, `AgentPlanCommandOperations`, `AgentPlanWriteOperations`.
Oberfläche: `plan-one-shot-field.tsx`, `plan-one-shot-notice.tsx`, Plan-Menü,
-Kopf, -Auswahl, Klon-Dialog.

### Prüfung (PAGE-309)

- `postgres:check`: neuer Ablauf „one-time plans“ gegen eine echte PostgreSQL-Instanz
  (Frist setzen/lesen, fällig, Kandidat, Löschen mit Lauf-Bereinigung und genau einem
  Protokolleintrag, Behalten, Abbruch durch Speichern ohne Markierung).
- Dienst mit nachgestellter Uhr: Erfolg setzt +5 min; `failed`, `cancelled`,
  `paused`, `work_done_closeout_open` setzen keine Frist; neuer Lauf bricht ab,
  späterer Erfolg setzt neu; vor Ablauf bleibt der Plan; ein frisch gestarteter
  Planer holt ein fälliges Löschen nach; Behalten verhindert es.
- Browser (Chromium, eigene temporäre Datenbank, Loopback): Schalter mit
  Bestätigungsdialog, Speichern, „Als Einmal-Plan kopieren“ mit Namensvorschlag,
  Hinweis „Wird um <Uhrzeit> gelöscht“ und „Behalten“.

### Abnahme nach dem Deployment (Betreiber)

Einen kleinen Plan als Einmal-Plan kopieren, laufen lassen und nach 5 Minuten
prüfen, ob er verschwunden ist und seine Ergebnisse (Commits, Branches, Tickets,
Anhänge) geblieben sind.
