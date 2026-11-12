<!--
Entwurf für das Wiki (PAGE-308). Die Wiki-Seiten liegen im Pages-Live-Dienst und werden vom Lauf nicht geändert.
All Might überträgt die beiden Abschnitte nach der Abnahme:
1. „Agents: Festlegungen“ (/wiki/93eb063a-a63c-4cac-8393-af182291a582) – Abschnitt „Profile lesbar machen“ unten.
2. „Pages-Schnittstelle und MCP: technische Umsetzung“ (/wiki/6d5a37ed-6ab1-4c4e-8962-96b7f1224b5b) – Abschnitt „Schnittstellenvertrag“ unten.
-->

# PAGE-308: Agent-Profile für Administratoren, Gruppen- und Projektleitungen

## Teil 1 – für die Seite „Agents: Festlegungen“

### Profile lesbar machen

Wer Agents führt, soll wissen, wer wofür zuständig ist. Dafür darf ein Agent-Profil von drei Gruppen von Personen **rein lesend** abgerufen werden:

| Wer                                            | Welche Agents                               |
| ---------------------------------------------- | ------------------------------------------- |
| Administrator                                  | alle Agents                                 |
| Gruppenleitung                                 | alle Agents, die Mitglied der Gruppe sind   |
| Projektleitung (Projektrolle „Projektmanager“) | alle Agents, die Mitglied des Projekts sind |

Alle anderen sehen wie bisher nur Name, Abteilungen und Gruppen (zum Beispiel über die Zuweisungssuche).

**Gruppenleitung.** Die Leitung ist eine Eigenschaft der Gruppe, keine neue Rolle. Ein Administrator legt in der Benutzerverwaltung (Gruppe bearbeiten, Spalte „Leitung“) eine oder mehrere Leitungen fest. Eine Leitung ist immer auch Mitglied der Gruppe; verlässt sie die Gruppe, endet die Leitung mit. Ändert jemand nur Namen oder Mitglieder der Gruppe, bleibt die Leitung erhalten. Nur Administratoren ändern die Leitung. Gespeichert wird sie als Kennzeichen `is_leader` der Mitgliedschaft (`user_group_members`, Migration `036_group_leaders.sql`).

**Projektleitung.** Wer in einem Projekt die Projektrolle „Projektmanager“ (`project_members.role = 'manager'`) hat, liest die Profile der Agents, die Mitglied dieses Projekts sind.

**Was lesbar ist.** Name, Konto-ID, Kennzeichen Agent, Abteilungen, Gruppen, Projektmitgliedschaften mit Projektrolle; Rolle (Stellenbezeichnung des Agents, ersatzweise der Name seiner Rolle); Aufgabenbeschreibung (AGENT.md) und Persönlichkeit (SOUL.md); Modell und Anbindung, Reasoning, Zugriffsstufe; Stimme, sobald es sie gibt (PAGE-300); Auslastung (aktive Chats, laufende Plan-Schritte, offene zugewiesene Tickets); Zeitpunkt der letzten Aktivität.

**Was nie lesbar ist.** MEMORY.md, DREAM.md und das Gedächtnisarchiv eines anderen Agents sowie Chatinhalte sind für Gruppen- und Projektleitungen nicht lesbar. Zugangsdaten sieht niemand; Zugangsdaten, die in AGENT.md oder SOUL.md stehen sollten, werden beim Lesen maskiert. Administratoren sehen das Gedächtnis im Agent-Panel wie in PAGE-305 vorgesehen; die Profil-Schnittstelle liefert es nicht.

**Ändern.** Agents anlegen und ändern bleibt in der Benutzerverwaltung bei Administratoren. Die Profil-Werkzeuge schreiben nichts.

**Oberfläche.** In der Benutzerverwaltung zeigt die Gruppenliste die Leitung. Für Administratoren und die Leitung der Gruppe öffnet „Agents“ eine Übersicht mit Name, Rolle, Kurzbeschreibung (erster Absatz von AGENT.md), Modell und Auslastung; ein Klick öffnet das Profil schreibgeschützt. Texte sind auf Deutsch und Englisch (i18next), Farben stammen aus den Theme-Tokens (Hell und Dunkel). Die Seite „Benutzerverwaltung“ selbst steht weiterhin nur Personen mit Verwaltungsrecht offen; Leitungen ohne dieses Recht rufen ihre Agents über die Pages-Schnittstelle ab.

**Wo die Profile liegen (Befund).** Ein Agent ist eine Zeile in `users` (`account_kind = 'agent'`, `job_title` als Aufgabe/Rolle) mit einer Zeile in `agent_employees` (`connection_id`, `model`, `reasoning_effort`, `access`, `soul` = SOUL.md, `instructions` = AGENT.md, `memory` = MEMORY.md); Migration `backend/database/postgres/migrations/024_agent_employees.sql`. Gelesen wird er für die Benutzerverwaltung in `backend/service/employee/AgentEmployeeDirectory.ts` (`list`, `detail`), dem Agent-Panel `app/routes/users-agent-data.ts` und der MCP-Verwaltung `backend/service/mcp/agent/McpAgentService.ts`.

## Teil 2 – für die Seite „Pages-Schnittstelle und MCP: technische Umsetzung“

### Schnittstellenvertrag

Drei neue lesende Routen unter `/api/mcp/v1/`, alle `GET`. Authentifizierung (Gerätetoken), Antworthülle und Fehlerformat sind die der bestehenden Routen: ein Fehler ist `{ "error": "<code>" }` mit passendem HTTP-Status. Zeiten sind ISO 8601, Antworten höchstens 1 MiB; größere Ergebnisse laufen über `cursor` und `nextCursor`.

Die Rechte werden bei jedem Aufruf neu aus den gespeicherten Mitgliedschaften bestimmt – von demselben Dienst, den auch die Oberfläche benutzt (`AgentProfileReadService`). Felder, die die lesende Person nicht sehen darf, fehlen; ihre Namen stehen in `hiddenFields`.

#### `agents_list` – `GET /api/mcp/v1/agents`

Parameter (alle optional): `groupId`, `departmentId`, `projectId`, `cursor`, `limit` (1–100, Standard 20). Unbekannte oder doppelte Parameter sind `invalid_request`.

Antwort:

```json
{
  "agents": [
    {
      "id": "…",
      "displayName": "…",
      "isAgent": true,
      "role": "Projektmanager",
      "summary": "Erster Absatz von AGENT.md",
      "departments": [{ "id": "…", "name": "…" }],
      "groups": [{ "id": "…", "name": "A-Team" }],
      "model": {
        "connectionId": "…",
        "provider": "…",
        "model": "…",
        "reasoningEffort": null
      },
      "activeChats": 0,
      "runningSteps": 0,
      "openTickets": 3,
      "hiddenFields": [
        "memory",
        "dream",
        "memoryArchive",
        "chatContents",
        "credentials"
      ]
    }
  ],
  "total": 4,
  "nextCursor": null
}
```

Enthalten sind nur Agents, deren Profil die Person lesen darf, nach Namen sortiert.

#### `agents_read` – `GET /api/mcp/v1/agents/{agentId}`

Antwort: `id`, `displayName`, `isAgent`, `role` oder null, `agentMd` oder null, `soulMd` oder null, `departments`, `groups`, `projects` [{`id`, `name`, `role`}], `model` {`connectionId`, `provider`, `model`, `reasoningEffort`} oder null, `accessLevel` oder null, `voice` {`voiceId`, `speed`} oder null, `load` {`activeChats`, `runningSteps` [{`planId`, `runId`, `stepId`}], `openTickets` [{`id`, `key`, `title`}]}, `lastActiveAt` oder null, `hiddenFields`.

#### `groups_read` – `GET /api/mcp/v1/groups/{groupId}`

Antwort: `id`, `name`, `leaders` [{`id`, `displayName`}], `members` [{`id`, `displayName`, `isAgent`}]. Lesen dürfen Administratoren und Mitglieder der Gruppe.

### Fehler

| Code                | HTTP | Wann                                                                                                                                       |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid_token`     | 401  | Token fehlt, ist unbekannt oder widerrufen, Konto fehlt oder ist deaktiviert                                                               |
| `forbidden`         | 403  | Agent oder Gruppe existiert, die Person darf sie nicht lesen                                                                               |
| `not_found`         | 404  | unbekannter Agent oder unbekannte Gruppe                                                                                                   |
| `invalid_request`   | 400  | mit `reason` = Name des abgelehnten Parameters (`limit`, `cursor`, `groupId`, …); ein `limit` außerhalb 1–100 wird abgelehnt, nie begrenzt |
| `payload_too_large` | 413  | Antwort größer als 1 MiB                                                                                                                   |

Die Codes des Vertrags (`FORBIDDEN`, `NOT_FOUND`, `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`) stehen im Fehlerformat der bestehenden `/api/mcp/v1/`-Routen kleingeschrieben auf der Leitung.

### Rechte und `hiddenFields`

| Lesende Person               | `hiddenFields`                                                        |
| ---------------------------- | --------------------------------------------------------------------- |
| Administrator                | `["credentials"]`                                                     |
| Gruppen- oder Projektleitung | `["memory", "dream", "memoryArchive", "chatContents", "credentials"]` |

Personen ohne Recht erhalten bei `agents_read` `forbidden` und in `agents_list` keinen Eintrag.

### Festlegungen der Umsetzung

- **Gleiche Pfade wie die Agent-Verwaltung.** `GET /agents` und `GET /agents/{id}` waren bisher die Verwaltungssicht für Administratoren (PAGE-267), `GET /groups/{groupId}` die der Benutzerverwaltung (PAGE-280). Ohne weitere Angabe antworten sie jetzt mit dem Profil-Vertrag oben. Die bisherige Verwaltungssicht liefert `?view=administration` (zum Beispiel `GET /agents/{id}?view=administration` mit `revision` für eine Änderung); `POST`, `PATCH` und `DELETE` ändern sich nicht. Ein Client, der Agents ändert, muss `view=administration` setzen.
- **Rolle.** `role` ist die Stellenbezeichnung des Agents (`users.job_title`), ersatzweise der Name seiner Rolle.
- **Kurzbeschreibung.** `summary` ist der erste Absatz von AGENT.md ohne Überschriften und Formatierung, höchstens 240 Zeichen.
- **Zugriffsstufe.** `accessLevel` ist der gespeicherte Zugriffsmodus (`read_only` oder `yolo`). Feinere Stufen (PAGE-303) folgen, sobald es sie gibt.
- **Stimme.** `voice` ist `null`, solange es keine Agent-Stimme gibt (PAGE-300).
- **Aktive Chats** sind die Chats des Agents mit einem laufenden Chat-Auftrag. **Laufende Plan-Schritte** sind Schritte, deren Sitzung für das Konto des Agents gerade startet oder läuft (`acp_resource_leases`); die Kennungen sind keine Berechtigung, den Lauf zu öffnen. **Offene Tickets** sind dem Agent zugewiesene, nicht erledigte und nicht archivierte Tickets; `agents_read` nennt höchstens 200 davon, `agents_list` zählt alle.
- **Letzte Aktivität** ist der jüngste Zeitpunkt aus Chat-Aufträgen, Projektänderungen, Plan-Läufen und Lernläufen des Agents.
- **Oberfläche und Schnittstelle** lesen über denselben Dienst. Die Oberfläche bietet dieselben Daten unter `/users-api/groups/{groupId}/agents` (Übersicht für Leitung und Administratoren) und `/users-api/agent-profiles/{agentId}`.

## Abnahme nach dem Deployment (Betreiber)

1. All Might als Leitung des A-Teams eintragen (Benutzerverwaltung → Gruppen → Bearbeiten → „Leitung“).
2. All Might bitten, die Zuständigkeiten des A-Teams zusammenzufassen (`agents_list` mit `groupId`, dann `agents_read`).
