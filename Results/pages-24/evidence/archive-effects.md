# Archivfolgen und Atomizität

Belegt durch `archive-effects.unit.test.ts`, `archive-repeat.unit.test.ts` und
`archive-repositories.unit.test.ts`; Ausführung in `tests-backend.txt`.

- Initiative → Epic → Task → Subtask sowie aktive Tickets unter einer bereits
  archivierten Zwischenstufe bleiben rekursiv erfasst. Ein Fall enthält fünf
  neu archivierte Tickets, einen bereits archivierten Nachkommen und einen
  unverbundenen aktiven Datensatz: `affectedCount:5`; genau fünf Archiveinträge.
- Workflowstatus wird nicht geändert. Bereits archivierte Zeitstempel bleiben
  erhalten; ein unverbundenes Ticket bleibt aktiv.
- Bereits archivierte Wurzel mit aktivem Kind: `affectedCount:1`. Ein weiterer
  frischer Aufruf derselben vollständig archivierten Unterstruktur meldet
  `changed:false`, `affectedCount:0`, ohne weitere History, Activity oder Events.
- Identischer autorisierter Replay liefert das ursprüngliche Ergebnis ohne
  erneute Schreiboperation oder weitere Aktivität.
- Hidden descendants führen zur vorhandenen `INVALID_REQUEST`-Ablehnung;
  Wurzel und sichtbare Geschwister bleiben unverändert. Ein persönlicher Admin
  kann dieselbe vollständig sichtbare Unterstruktur archivieren.
- Die bestehende UI-Option `keep` bleibt: direkte Kinder werden abgehängt,
  nur die Wurzel archiviert; Parent-Änderung und Archiveintrag sind vorhanden.
- Meilensteinarchivierung betrifft genau einen Meilenstein. Eingehende und
  ausgehende Abhängigkeiten werden entfernt; unverbundene Abhängigkeiten bleiben.
  Ticketdatensätze, Ticket-Unterstruktur und Meilensteinzuweisungen bleiben
  bytegleich in den synthetischen Records; kein Ticket-Archiveintrag entsteht.
- Fehlende/falsche Bestätigung, fehlende Rechte und Scope-Verletzungen speichern
  keinen Operation-Key und erzeugen keine Aktivität oder History.
- Eine synthetisch fehlschlagende History-Persistenz rollt Ticketänderung und
  Operation-Key im gemockten Transaktionsboundary zurück; kein Event wird
  veröffentlicht. Das ersetzt keinen Live-DuckDB-Transaktionsbeleg.
- Repository-Unit-Fälle prüfen, dass die tatsächlich von `UPDATE … RETURNING id`
  gelieferten IDs und nicht die angeforderten IDs zurückgegeben werden. Leere
  Mengen erzeugen keine SQL-Operation; Restore behält `archived_at = NULL` und
  die Bedingung `IS NOT NULL`.

Für erfolgreich archivierte Meilensteine liest die Aktivitätsaufzeichnung das
Ziel jetzt mit expliziter Archivoption. Sie erzeugt einmal Projektaktivität im
MCP-Kontext; Replay erzeugt keine weitere Aktivität. Normaler Meilenstein-Lookup
bleibt auf aktive Datensätze beschränkt. Physische Meilenstein- oder Ticketlöschung
wird von diesen Tools nicht aufgerufen.
