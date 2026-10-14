# Autorisierung — Service-Belege

Die gezielten Unit-Fälle rufen die produktive
`AgentExtensionService.handle` → `AgentTicketTransaction` → `TaskService`-Kette
auf. User-, Authorization-, Project-, Task-, Settings- und Operation-Key-Repositories
sind synthetische Mocks; es gibt keine echte Datenbank oder Netzverbindung.
Identitätshinweise übergeben absichtlich keine Rechte. Entscheidend sind die
frisch geladenen Account-Fakten. Das ist ein Service-Beleg, kein Client-E2E-Test.

| Fall                                                                | Ticket                          | Meilenstein                   | Beleg                         |
| ------------------------------------------------------------------- | ------------------------------- | ----------------------------- | ----------------------------- |
| Persönlicher MCP-Administrator im Browser-Rollenmodus               | erlaubt                         | erlaubt                       | `archive-rights.unit.test.ts` |
| Administrator im UI-Administratormodus                              | gemeinsames Recht erlaubt       | gemeinsames Recht erlaubt     | `archive-rights.unit.test.ts` |
| Projektmanager mit `milestones`                                     | erlaubt                         | erlaubt                       | `archive-rights.unit.test.ts` |
| Projektmanager mit `milestones`, ohne `write`                       | erlaubt                         | erlaubt                       | `archive-rights.unit.test.ts` |
| Manager mit `write`, ohne `milestones`                              | `FORBIDDEN`                     | `FORBIDDEN`                   | `archive-rights.unit.test.ts` |
| Normaler Nutzer ohne Managementrechte                               | `FORBIDDEN`                     | `FORBIDDEN`                   | `archive-rights.unit.test.ts` |
| `milestones` ohne Projektverantwortung                              | `FORBIDDEN`                     | `FORBIDDEN`                   | `archive-rights.unit.test.ts` |
| `manage_projects` plus `milestones` im verwalteten Abteilungs-Scope | erlaubt                         | erlaubt                       | `archive-rights.unit.test.ts` |
| Verwaltung einer anderen Abteilung, Zielprojekt weiter sichtbar     | `FORBIDDEN`                     | `FORBIDDEN`                   | `archive-rights.unit.test.ts` |
| Explizite globale Projektverwaltung plus `milestones`               | erlaubt bei Ticket-Sichtbarkeit | erlaubt                       | `archive-rights.unit.test.ts` |
| Projekt außerhalb aktueller Sichtbarkeit                            | `NOT_FOUND`                     | `NOT_FOUND`                   | `archive-rights.unit.test.ts` |
| Ticket in fremder Abteilung trotz globaler Projektverwaltung        | `NOT_FOUND`                     | kein eigener Abteilungs-Scope | `archive-rights.unit.test.ts` |
| Fälschlich gesetzte Admin-/Permission-Hinweise in der Identität     | `FORBIDDEN`                     | `FORBIDDEN`                   | `archive-rights.unit.test.ts` |
| Direkter unberechtigter UI-Service-Aufruf                           | `WorkItemAccessDeniedError`     | `WorkItemAccessDeniedError`   | `archive-rights.unit.test.ts` |

`archive-repeat.unit.test.ts` belegt die erneute Prüfung auf identischen
Operation-Key-Replays: Capability-Entzug und Verlust der Projektverantwortung
ergeben `FORBIDDEN`; Scope-Verlust und verschwundene Ziele ergeben `NOT_FOUND`.
Ticket-Abteilung und das aktuelle Ticketprojekt werden erneut geprüft. Ein
Meilenstein muss weiterhin tatsächlich dem im Ergebnis angegebenen Projekt
angehören. Inaktive, unbekannte oder passwortpflichtige Accounts werden mit
`invalid_token`/401 verworfen. Die Bestätigungssprache wird erneut gelesen.
Abgelehnte Erstaufrufe und Replays erhöhen weder Schreib-, History-, Activity-,
Event- noch Operation-Key-Zähler.

Die UI-/MCP-Gleichheit meint die gemeinsame Rechteentscheidung. Die bereits
vorhandene Admin-Interpretation bleibt kanalabhängig: UI braucht aktiven
Administratormodus, MCP berücksichtigt persönliche Admin-Berechtigung. Der
Browsermodus wird dabei nicht verändert.

Die gemeinsame Rechte-Referenz ist `README.md`, Abschnitt
„Ticket and milestone archive rights“. Sie ist aus `mcp/README.md` verlinkt.
Ausführungsbeleg: `tests-backend.txt`.
