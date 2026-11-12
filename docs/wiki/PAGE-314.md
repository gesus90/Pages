# Wiki-Entwurf PAGE-314: Tickets mit mehreren oder keiner Abteilung

Entwurf für All Might. Nach der Abnahme übertragen:

1. in [Projekte und Aufgaben: Festlegungen](/wiki/d2b862d1-5a2e-4e4d-a723-8091e17c84a4) den Abschnitt „Abteilungen eines Tickets“ anstelle der Aussage „ein Ticket hat genau eine oder keine Abteilung“,
2. in die Wiki-Seite der Pages-Schnittstelle bzw. der Agent-Werkzeuge den Abschnitt „Abteilungen über die Schnittstelle“.

Die Wiki-Seiten liegen im Live-Dienst und wurden vom Lauf nicht geändert.

---

## Abschnitt für „Projekte und Aufgaben: Festlegungen“: Abteilungen eines Tickets

Ein Ticket gehört **keiner, einer oder mehreren Abteilungen** (zum Beispiel Design und Entwicklung zugleich).

| Zustand             | Sicht                                           | Bearbeiten                         |
| ------------------- | ----------------------------------------------- | ---------------------------------- |
| Ohne Abteilung      | alle mit Zugang zum Projekt                     | alle mit Schreibrecht              |
| Mit Abteilungen     | Mitglieder **mindestens einer** der Abteilungen | diese Mitglieder, mit Schreibrecht |
| Aktiver Admin-Modus | alle Tickets                                    | wie sonst                          |

- Die Regel gilt überall, wo die Lesesicht F9 gilt: Listen, Kanban, Einzelansichten, Unteraufgaben, Eltern-Verweise, Links, Zähler, Suche, Dashboard, GitHub-PR-Ansichten, Wiki-Verknüpfungen mit Epics und die Pages-Schnittstelle.
- Projektabteilungen und Projektzugang ändern sich dadurch nicht. Wer keinen Zugang zum Projekt hat, sieht das Ticket weiterhin nicht.
- Eine **Zuweisung** an Person oder Gruppe gibt weiterhin keine Sicht.
- Beim Löschen einer Abteilung verliert jedes Ticket diese Abteilung. Hatte es nur diese, ist es danach ohne Abteilung und für das ganze Projekt sichtbar (wie vorher mit dem Einzelfeld).
- Gruppierung im Kanban nach Abteilung: ein Ticket mit mehreren Abteilungen erscheint in jedem dieser Abschnitte. Der Filter „Abteilung“ trifft ein Ticket, wenn die Abteilung eine seiner Abteilungen ist.

### Auswahl in der Oberfläche

- Im Ticket (Seite, Dialog und Seitenleiste) stehen die Abteilungen als Chips. Ohne Abteilung zeigt ein Chip „Ohne Abteilung“ und ein Hinweis, dass dann alle mit Projektzugang das Ticket sehen. Beim Anlegen eines Tickets lässt sich dieselbe Auswahl treffen; ohne Auswahl entsteht das Ticket ohne Abteilung.
- **Hinzufügen:** eigene Abteilungen; Manager mit Rechten für alle Abteilungen (oder für eine Abteilung, die sie verwalten) wählen auch fremde.
- **Entfernen:** eigene Abteilungen; fremde nur Manager mit entsprechenden Rechten.
- **Alle Abteilungen entfernen** macht das Ticket für das ganze Projekt sichtbar. Das darf jede Person mit Schreibrecht für das Ticket; eine Rückfrage nennt die Wirkung.
- Abteilungen, die das Ticket behält, verlangen vom Speichernden kein Recht. Geprüft werden nur die hinzugefügten und die entfernten.
- Der Zustand ist durch „erwartete Abteilungen“ gegen gleichzeitige Änderungen geschützt (Konflikt statt Überschreiben).
- Beim Zuweisen an eine Person oder Gruppe, die das Ticket wegen der Abteilungen nicht sehen kann, erscheint ein Hinweis. Er bietet an, die Abteilung der Betroffenen hinzuzufügen (nur Abteilungen, die man selbst wählen darf). Bei einer Gruppe genügt ein Mitglied ohne Sicht für den Hinweis. Die Zuweisung selbst wird nicht verhindert.
- Der Verlauf des Tickets hält eine Änderung als „Abteilung geändert“ fest; alter und neuer Wert nennen alle Abteilungen, durch Komma getrennt.

## Abschnitt für die Pages-Schnittstelle: Abteilungen über die Schnittstelle

- **`create_ticket` / `tickets_create`:** neues optionales Feld `departmentIds` (Liste von Abteilungs-IDs; eine leere Liste heißt „ohne Abteilung“). Ohne Angabe bleibt das bisherige Verhalten: die wählbaren Abteilungen des Eltern-Tickets, sonst keine. Das ältere Einzelfeld `departmentId` gilt weiter; beide zusammen sind ein `INVALID_REQUEST`. Eine unbekannte Abteilung gibt `NOT_FOUND`, eine nicht wählbare `FORBIDDEN`.
- **`set_ticket_departments` / `tickets_set_departments`:** ersetzt die Abteilungen eines Tickets. Eingaben: `ticketId`, `departmentIds`, `expectedDepartmentIds` (die zuletzt gelesene Liste). Gleiche Rechte wie in der Oberfläche (hinzufügen und entfernen wie oben; alles entfernen mit dem Schreibrecht). `CONFLICT`, wenn sich die Abteilungen seit dem Lesen geändert haben; wurde schon der gewünschte Zustand gespeichert, ist der Aufruf ein Erfolg ohne Änderung.
- **`read_ticket` / `tickets_read` und `search_tickets` / `tickets_search`:** liefern `departments` (Liste mit `id` und `name`; leer = für das ganze Projekt sichtbar). `department` bleibt für die Kompatibilität erhalten: die erste Abteilung oder `null`.
- **`set_ticket_assignee` mit `targetType: department`** bleibt für Tickets mit höchstens einer Abteilung bestehen und ersetzt dann diese; bei mehreren Abteilungen antwortet es mit `CONFLICT`, dann `set_ticket_departments` nutzen.
- **REST-Schnittstelle `/api/mcp/v1/tickets`:** zusätzlich zum Feld `departmentId` das Feld `departmentIds` (Anlegen, Ändern, `expected`) und `departments` in der Antwort.

### Empfehlung für Projektmanager-Agents (All Might)

Beim Anlegen die Abteilungen ausdrücklich angeben (`departmentIds`), statt sie aus dem Umfeld des Agents entstehen zu lassen. Ein Ticket für Design und Entwicklung bekommt beide IDs; ein Ticket für das ganze Projekt eine leere Liste. Nachträglich mit `set_ticket_departments` ändern, nie so, dass der Agent selbst die Sicht verliert (er sieht das Ticket nur, solange er Mitglied einer der Abteilungen ist).

## Technische Umsetzung (für die technische Seite)

- Speicherung: Tabelle `work_item_departments (work_item_id, department_id)`, Migration `041_ticket_departments.sql`. Bestehende Zuordnungen werden übernommen, Tickets ohne Abteilung bekommen keine Zeile. Die Spalte `work_items.department_id` und ihr Index entfallen.
- Sichtprüfung zentral in `WorkItemVisibility.ts` (`NOT EXISTS` oder `EXISTS` auf `work_item_departments`), daher gleichförmig für alle Lesepfade. Epics in der Wiki-Sicht (`WikiVisibility.ts`, `WikiAnchorValidator`, `WikiChoiceService`) folgen derselben Regel.
- Live-Hinweise gelöschter Tickets nennen alle Abteilungen (`pages_event_outbox.audience_department_ids`, JSON-Liste); der Rust-Dienst `core/` liest die neue Spalte (`departmentIds` im Vertrag).
- Rechte beim Setzen: `TaskDepartmentService.setDepartments`, Richtlinie `TicketDepartmentPolicy`.
