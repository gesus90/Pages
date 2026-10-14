# PAGE-23 — geprüfter Stand

PAGE-23 ist in der Arbeitsbasis enthalten. Commit:
`c73e7ddf2dd562390b191aa2e5c953ea223bbf34`
(`feat: Tickets und Meilensteine in der Oberfläche archivieren (PAGE-23)`).
`git merge-base --is-ancestor c73e7dd HEAD` war erfolgreich (Exitcode 0).
Die Arbeitsbasis ist `65cb7a2` auf `task/page-24`; der Arbeitsbaum war zu Beginn sauber.

Vorhanden und gelesen:

- `TaskAccessGuard.canArchive`: aktuelle Capability `milestones` plus
  `ProjectService.canWriteProject`; beide werden neu aufgelöst.
- `requireArchivableWorkItem`: Ziel-Sichtbarkeit vor Archivrecht. Ticket-Scope
  kommt aus `ProjectAccessService.workItemVisibility` und dem Repository.
- `TaskLifecycleService.archive`: vollständige sichtbare Unterstruktur erforderlich;
  UI-Optionen `include` und `keep` bestehen.
- `TaskMilestoneService.archiveMilestone`: gemeinsames Projekt-Archivrecht,
  Abhängigkeiten entfernen, Meilenstein archivieren, Tickets unverändert.
- UI-Archivaktionen in `app/lib/task-actions/task-core-actions.server.ts` und
  `app/lib/project-actions/project-milestone-actions.server.ts` rufen `TaskService`.
- UI-Controls und Bestätigungsdialoge unter `app/components/tasks/lifecycle/`
  sowie `app/components/projects/phase-plan/` sind vorhanden.
- Die Loader nutzen Archivrecht-Hinweise für Controls; die Service-Schreiboperation
  prüft erneut. PAGE-24 verändert keine UI-Komponente oder UI-Action.

Die damaligen PAGE-23-Tests sind im aktuellen Tree nach der späteren Entfernung
der alten Suiten nicht vorhanden. Ihre historische Ausführung ist kein Beleg
für diese Änderung. PAGE-24 fügt ausschließlich die neuen gezielten Unit-Fälle
in der bestehenden disjunkten Backend-Struktur hinzu.

Die MCP-Erstaufrufe erreichten bereits dieselben Archive-Services. Fehlstellen
waren die erneute Archivautorisierung beim Replay und das zusätzliche `write`
Gate für `ticket.delete`. Außerdem zählte der Adapter eine bereits archivierte
Ticketwurzel immer mit, und die Ticket-History wurde auch für schon archivierte
Unterstruktur-IDs geschrieben. Die neuen Tests belegten zusätzlich die fehlende
Meilenstein-Projektaktivität nach Archivierung.
