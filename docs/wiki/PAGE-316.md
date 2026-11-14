# Entwurf für „Einstellungen und Verwaltung“ – PAGE-316

Dieser Entwurf wird nach Abnahme von All Might ins Live-Wiki übertragen. Der Lauf ändert keine Live-Wiki-Seite.

## Deutsch

### Rolle „Verwaltung“

Ein Administrator vergibt oder entzieht die Rolle „Verwaltung“ in der Benutzerverwaltung. Die Rolle wirkt sofort ohne Admin-Modus. Sie berechtigt zum Anlegen, Bearbeiten und Deaktivieren menschlicher und Agent-Konten, zum Zuweisen von Abteilungen und Gruppen und zum Pflegen der Agent-Dokumente, Avatare sowie der Modellauswahl aus freigegebenen Anbindungen.

Benutzerverwaltung, Agents und Gruppen stehen direkt zur Verfügung. Gruppenmitglieder und Leitungen können gepflegt werden. „Verwaltung“ sieht und bearbeitet alle Projekte, Projektmitgliedschaften und Projektrollen, Projektabteilungen, Tickets aller Abteilungen sowie alle Wiki-Bereiche. Alle Agent-Pläne und deren Läufe können gelesen, Pläne können bearbeitet werden. Die Steuerung von Läufen folgt weiterhin den bisherigen Eigentümer- und Teamregeln.

Administrator-Konten sind geschützt. Die Rollen „Administrator“ und „Verwaltung“ sowie die eigenen Rechte dürfen nicht vergeben, entzogen oder über Mitgliedschaften verändert werden. Konten werden deaktiviert, nicht gelöscht. Die Rolle darf keine Passwörter zurücksetzen, Zugangsdaten abrufen oder setzen, YOLO neu vergeben oder Skripte direkt starten. Änderungen an Kernsystem, KI-Anbindungen, Schlüsseln, Runnern, Remote-Zielen, Updates, Backups, Datenbank, fremden MCP-Verbindungen und Speicher-Integrationen bleiben ausgeschlossen.

Neue Personen erhalten ihre Einladung ausschließlich per E-Mail. Weder Oberfläche noch Schnittstelle zeigen der Verwaltung ein Passwort, einen Einladungslink oder ein Token. Der Versand ist austauschbar angebunden; der Standardadapter verwendet die lokale sendmail-Schnittstelle.

Administratoren sehen im Admin-Modus in der Benutzerverwaltung den Reiter „Verwaltungsprotokoll“. Er enthält Konto, ISO-Zeitpunkt, Aktion, Ziel und Änderungen. Sehr lange Inhalte werden mit Fingerabdruck und Länge protokolliert. Zugangsdaten und Bildbytes werden nicht ins Protokoll übernommen.

### Pages-Schnittstelle

Die zehn Werkzeuge `users_list`, `users_read`, `users_create`, `users_update`, `users_set_status`, `users_set_avatar`, `groups_create`, `groups_update`, `project_members_set` und `projects_set_departments` stehen auch im internen Werkzeugkatalog `pages-pica`. Rechte werden bei jedem Aufruf mit den gleichen Services wie in der Oberfläche geprüft. `groups_read` ergänzt das Lesen des Gruppenstands und seiner Revision.

Die HTTP-Pfade entsprechen dem Vertrag von PAGE-316 unter `/api/mcp/v1/`. Listen verwenden `cursor`, `limit` von 1 bis 100 (Standard 20) und `nextCursor`. `users_read` liefert die vollständige Benutzerrevision. Ein Gruppenstand mit Revision ist über `GET /api/mcp/v1/groups/{id}?view=management` lesbar; Projektrevisionen stehen in der Projektantwort und in `read_project`.

Jede Änderung eines vorhandenen Objekts verlangt `expectedRevision`, auch der Avatar. Eine veraltete Revision liefert `CONFLICT` mit `currentRevision`, ohne Änderung. Eine wiederverwendete `operationId` mit identischen Eingaben wiederholt die gespeicherte Antwort; abweichende Eingaben werden abgewiesen. SVG-Avatare werden serverseitig von ausführbarem Inhalt und externen Referenzen bereinigt und als PNG gespeichert. Das Upload-Limit beträgt 5 MiB.

`FORBIDDEN` erklärt die Ablehnung mit `core_system`, `admin_target`, `self_escalation`, `role_grant` oder `access_level`. Fehlende Ziele liefern `NOT_FOUND`, unbrauchbare Eingaben `INVALID_REQUEST` mit `reason`, übergroße Nutzdaten `PAYLOAD_TOO_LARGE`.

## English

### Management role

An administrator grants or revokes the protected Management role in user management. It takes effect immediately without administrator mode. It manages human and agent accounts, departments and group memberships, agent instructions, identity documents, avatars and models from released connections.

It manages groups and their leaders, all projects and their members, project roles and departments, tickets across departments, and all wiki areas. It reads every plan and run and edits plans. Existing ownership and team rules continue to decide run control.

Administrator accounts, protected role grants, personal privileges, credentials, account deletion, new YOLO selections and direct script execution remain protected. Core settings, model connections and keys, runners, remote targets, updates, backups, databases, other accounts' MCP connections and storage integrations remain outside the role.

Human invitations go only to their recipient by email through an interchangeable delivery adapter. No management response contains a password, invitation link or token. Administrators can inspect the Management activity tab for the acting account, ISO timestamp, target and changes. Long contents use fingerprints and lengths; secrets and image bytes are excluded.

The same named tools and permissions are available through paired HTTP clients and `pages-pica`. Read the complete current revision before each update, including avatars. Use `operationId` unchanged when retrying the same request. Group reads include their revision through `groups_read` or the management view of the group HTTP resource; project reads include their administration revision. SVG uploads are sanitized and rendered to PNG on the server, with a 5 MiB input limit.
