# PAGE-24 — Client-E2E auf Produktion (2026-10-14)

Auftrag des Eigentümers (Igor, 11:52): Produktion Port 3000 mit neuem Build; E2E mit synthetischen Daten.
Client: gebündelter pages-mcp aus diesem Branch (`mcp/dist`), stdio, Konto des Eigentümers.

## Ergebnisse
- tools/list: delete_ticket und delete_milestone vorhanden, Beschreibung nennt Soft-Archivierung und Rechte.
- Falsche Bestätigung (`yes`): CONFIRMATION_REQUIRED, danach Ticket unverändert lesbar.
- Ticket mit aktivem Unterticket archivieren (`LÖSCHEN`): affectedCount 2, recursive, isArchived true.
- Wiederholung mit gleicher operationId und Parametern: gleiche Antwort (changed true, affectedCount 2).
- Neue operationId auf bereits archiviertem Ticket: changed false, affectedCount 0.
- Meilenstein archivieren (`LÖSCHEN`): affectedCount 1, verschwindet aus read_milestones.
  Zugehöriges Ticket bleibt aktiv und behält milestoneId (keine Kaskade).
- Wiederholung Meilenstein-Archiv: gleiche Antwort.

## Auffälligkeit
- Englische Bestätigung `DELETE` wurde mit CONFIRMATION_REQUIRED abgelehnt; `LÖSCHEN` wurde akzeptiert.
  Ursache nicht untersucht (vermutlich kontoabhängig oder Fehler in der Prüfung).

## Nicht ausgeführt
- Verweigerte Fälle (Manager ohne Meilensteinrecht, gewöhnlicher Benutzer, nicht sichtbares Ziel): kein zweites Konto.
  Abgedeckt nur durch Unit-Tests (archive-rights, archive-repeat), nicht erneut ausgeführt.

## Synthetische Datensätze auf Produktion
- Projekt „PAGE24 probe 2“ (PP2, id 7b658ada-2721-4ede-956f-a7e2a38ade33), aktiv.
- Tickets PP2-1 und PP2-2 archiviert; PP2-3 (Meilensteintest) archiviert.
- Meilenstein „PAGE24 E2E Meilenstein mv7xqn8r“ archiviert.
- Keine echten fachlichen Tickets oder Meilensteine verändert.
