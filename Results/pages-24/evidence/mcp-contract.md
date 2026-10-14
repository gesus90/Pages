# MCP-Vertrag

Die unabhängigen Node-Unit-Fälle in
`mcp/test/archive-contract.unit.test.ts` prüfen den tatsächlichen `WRITE_TOOLS`
Katalog. Ausführung: `tests-mcp-contract.txt`. Keine Pages-Tests importieren
ausführbare Module aus `mcp/`.

| Name               | Pages-Operation    | Unveränderte Pflichtparameter                             |
| ------------------ | ------------------ | --------------------------------------------------------- |
| `delete_ticket`    | `ticket.delete`    | `operationId`, `ticketId`, `confirmation`                 |
| `delete_milestone` | `milestone.delete` | `operationId`, `projectId`, `milestoneId`, `confirmation` |

Die Tests vergleichen die Required-Liste, Properties, `additionalProperties:false`,
die beiden Bestätigungswörter und die bestehenden readOnly/destructive/idempotent/
openWorld-Annotationen. Weitere Assertions verlangen Archivierungsbeschreibung,
Meilensteinrecht, erneute Autorisierung auf jedem Aufruf einschließlich Replay,
`affectedCount` und die typabhängigen Folgen. Die Beschreibungen nennen keine
endgültige Löschung von Tickets oder Meilensteinen.

Quellprüfung der Discovery- und Aufrufkette:

1. `PagesAgentApiService.handlePersonal(... verify ...)` bietet die bestehenden
   `PAGES_AGENT_WRITE_OPERATIONS` einschließlich beider Archive-Operationen an;
   deren Target-Recht wird daraus nicht abgeleitet.
2. `mcp/src/server.ts` verarbeitet `tools/list` über `verifyPages` und die
   registrierten Katalogeinträge, einschließlich `WRITE_TOOLS`.
3. `tools/call` verifiziert erneut und ruft `readOperation` für die Pages-API auf.
   Es gibt im Adapter weder SQL noch einen Datenbankzugriff oder eine eigene
   Archiv-Rechteentscheidung.
4. Auf Pages prüft `AgentTicketTransaction` die Identität in der Transaktion,
   und beide Erstaufrufe/Replays erreichen die gemeinsamen Service-Guards.

Backend-Unit-Fälle belegen unveränderte `CONFIRMATION_REQUIRED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT` sowie `invalid_token` für ungültige Accounts. Ein
autorisierter identischer Replay liefert die gespeicherte Anzahl, während
geänderte Parameter mit `CONFLICT` scheitern. Dies ist kein Beleg für Discovery
oder Aufrufe über einen tatsächlich verbundenen MCP-Client: der gesonderte
Client-E2E-Nachweis ist blockiert, siehe `e2e.md`.

Dokumentationsvertrag: `mcp/README.md` in den Abschnitten zu Projekt-/Ticket-Writes
und „Milestones, initiatives, tags and links“; gemeinsamer Rechtevertrag im
Root-README. Beide beschreiben Soft-Archivierung, aktive Ticket-Nachkommen,
Meilensteine ohne Ticket-Kaskade, Scope-Prüfung und Replay-Autorisierung.
