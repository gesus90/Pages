# PAGE-303: Wiki-Entwurf – Zugriffsstufen der Agents im Chat

Dieser Entwurf enthält die vorgesehenen Texte für zwei Wiki-Seiten. Der Lauf
ändert das Wiki nicht; All Might überträgt die Abschnitte nach der Abnahme.

---

## Teil 1 – für „Agents: Festlegungen“ (/wiki/93eb063a-a63c-4cac-8393-af182291a582)

### Zugriffsstufe je Agent

Jeder Agent hat eine **Zugriffsstufe**. Sie gilt für alle Chats mit dem Agent,
also für den direkten Chat auf der Chat-Seite und für seine Antworten in
Gruppen. Agent-Pläne sind davon nicht betroffen: Plan-Schritte behalten ihre
eigenen Laufoptionen (`access`, `shell`, `web`, `browser`).

| Stufe            | Was der Agent im Chat darf                                                                                                                                                                                    | Isolation            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Nur Pages**    | Nur die Pages-Werkzeuge. Shell, Dateien, Internet, Browser und andere MCP-Server sind technisch gesperrt, auch wenn eine Nachricht dazu auffordert.                                                           | –                    |
| **Arbeitsplatz** | Shell, Internet, Browser, jedes auf dem Rechner installierte Programm und die eingerichteten MCP-Server. Schreiben nur im Arbeitsordner des Chats. Kein Zugriff auf den Credential-Ordner und die Live-Daten. | bubblewrap (Pflicht) |
| **YOLO**         | Keine Einschränkung durch Pages: alle Programme, Netzwerk, Dateisystem mit den Rechten des Systembenutzers, unter dem Pages läuft, und alle eingerichteten MCP-Server.                                        | keine                |

- **Standard:** Neue und bestehende Agents stehen auf „Nur Pages“. Agents, die
  vor PAGE-303 auf dem früheren „YOLO“ standen (das immer in bubblewrap lief),
  stehen jetzt auf „Arbeitsplatz“ – dieselbe Wirkung, keine Ausweitung.
- **Wer ändert:** Nur Administratoren im aktiven Admin-Modus, im Reiter
  „Zugriff“ des Agent-Panels der Benutzerverwaltung. Gespeichert wird mit
  „Speichern“ des Panels, mit Revision. Andere Personen mit Benutzerrechten
  sehen die Stufe, können sie aber nicht ändern; der Server lehnt es ab
  (`accessAdminRequired`).
- **Arbeitsplatz ohne Isolation:** Funktioniert bubblewrap auf dem Rechner
  nicht, zeigt der Reiter das an und „Arbeitsplatz“ ist nicht wählbar
  (`isolationUnavailable`). Ein Chat auf „Arbeitsplatz“ startet nie ohne
  Isolation.
- **YOLO** wird erst nach einem Bestätigungsdialog übernommen: „Der Agent kann
  alles auf diesem Rechner lesen, ändern und löschen, auch Zugangsdaten und
  Live-Daten.“
- **Keine feste Werkzeugliste:** Die Stufe bestimmt den Umfang, der Rechner die
  Werkzeuge. Ein nachträglich installiertes Programm ist sofort nutzbar.
- **Pages-Werkzeuge** stehen in jeder Stufe bereit. Jede Pages-Aktion prüft
  Pages weiterhin gegen Rolle, Abteilungen und Projektmitgliedschaften des
  Agent-Kontos.
- **Dateien anhängen:** In „Arbeitsplatz“ und „YOLO“ hat der Agent die
  Pages-Werkzeuge `tickets_attach_file` und `wiki_page_attach_file`. Sie hängen
  eine Datei aus dem Arbeitsordner des Chats (zum Beispiel ein gerendertes
  PNG) mit den Rechten des Agent-Kontos an ein Ticket oder eine Wiki-Seite.
  Dateien außerhalb des Arbeitsordners – auch über symbolische Links – werden
  abgelehnt.

### MCP-Server

- Pages übernimmt die MCP-Server, die auf dem Rechner für die CLI des Agents
  eingerichtet sind (Herkunft siehe technische Seite). Pages liest die
  Konfiguration bei **jedem Chat** neu: Ein nachträglich eingerichteter Server
  steht ab dem nächsten Chat bereit, ohne Codeänderung und ohne Neustart.
- Nur „Arbeitsplatz“ und „YOLO“ bekommen diese Server; „Nur Pages“ bekommt
  keinen.
- Der Reiter „Zugriff“ zeigt informativ, welche Server Pages erkannt hat:
  Name, Transport (`stdio`, `http`, `sse`) und Konfigurationsdatei. Befehle,
  Header und Umgebungswerte zeigt er nie.

### Im Chat

- Die Vorgabe an den Agent wird aus seiner Stufe erzeugt.
- Recherche, Browserbedienung, Rendern und Ähnliches geschehen direkt im Chat;
  dafür wird kein Agent-Plan gestartet.
- Jede Werkzeugnutzung ist sichtbar: unter der Antwort als aufklappbarer
  Eintrag mit Befehl/Werkzeug, Eingabe und Ergebnis; während der Agent
  arbeitet, als Liste „Laufende Werkzeugnutzung“. Ein laufender Aufruf lässt
  sich mit „Abbrechen“ beenden; der Agent antwortet dann mit dem bisherigen
  Stand. „Stopp“ im Kopf beendet die ganze Antwort.
- Der Chat-Kopf zeigt die Stufe als Etikett („Zugriff: …“), YOLO rot mit
  Warnsymbol.

### Schutz

- Jede Änderung der Stufe steht mit Person, Zeitpunkt, alter und neuer Stufe in
  der „Aktivität“ des Agents und im Serverprotokoll (`agent.access.changed`).
- Pages gibt Zugangsdaten nicht von sich aus in Vorgabe oder Chat. Eingabe und
  Ergebnis jedes Werkzeugaufrufs laufen durch die bestehende Filterung
  zugangsdatenartiger Inhalte und werden auf 4.000 Zeichen gekürzt; Header- und
  längere Umgebungswerte der übernommenen MCP-Server werden in Protokollen
  maskiert.
- Zeitlimit und Ausgabegrenze: Chats laufen über denselben ACP-Startweg wie
  Plan-Schritte, in derselben begrenzten Arbeitseinheit und mit der Frist der
  Chat-Antwort; Befehlszeitlimits und Ausgabegrenzen der CLI gelten wie im
  Plan-Schritt.

---

## Teil 2 – für „Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung“ (/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440)

### Herkunft der früheren Chat-Sperre

Vor PAGE-303 war die Sperre an drei Stellen fest verdrahtet:

1. `backend/agents/acp/PicaClaudeHelper.ts`, `picaHelperUsage()`: Jede
   Nachricht an einen Agent mit Claude Code bekam den Satz „Run no other command
   and open no other file.“ – auch bei gespeichertem Vollzugriff, weil
   `PicaAcpJob.turnInput()` (`backend/service/chat/acp/PicaAcpJob.ts`) ihn über
   `PicaAcpCredential.usage()` immer anhängte.
2. `backend/service/employee/AgentEmployeeInstructions.ts`: „Nutze
   ausschließlich die bereitgestellten Werkzeuge …“ stand unabhängig vom Zugriff
   in jeder Vorgabe.
3. Technisch: Das Chat-Profil `CHAT_PROFILE` in
   `backend/agents/acp/ClaudeAcpProfile.ts` erlaubt nur `Bash`/`Read`, und
   `decidePicaHelperPermission()` genehmigt nur den exakten Helper-Aufruf des
   Turns. Für Codex und OpenCode startet Pages im Chat einen nativen Pica-Build,
   der alle eingebauten Werkzeuge verweigert (`selectPicaNative()` in
   `backend/agents/cli/CliSessionExecution.ts`). Außerdem lädt keine CLI ihre
   eigenen MCP-Server: Claude Code läuft mit `settingSources: []` und
   `strictMcpConfig: true`, alle CLIs mit dem Credential-Ordner der Anbindung
   als Home.

### Datenmodell

- `agent_employees.access`: `read_only` (Nur Pages), `workspace`
  (Arbeitsplatz), `yolo` (YOLO). Migration
  `backend/database/postgres/migrations/043_agent_access_levels.sql` setzt den
  früheren Wert `yolo` auf `workspace` und erweitert den Check.
- `agent_activity.kind` erlaubt `access`; `detail` enthält `from`, `to`,
  `actorId` und `person`.
- Typen: `definition/AgentEmployee.ts` (`AGENT_EMPLOYEE_ACCESS_MODES`,
  `hasHostTools`, `AgentAccessEnvironment`, `AgentDetectedMcpServer`).

### Ablauf

- **Speichern:** `AgentEmployeeAdministration.create/update` →
  `requireAccessChange()` (nur `UserPolicyService.isAdministrator`, also Admin
  im aktiven Admin-Modus; „Arbeitsplatz“ nur mit Isolation) →
  `AgentActivityService.recordAccessChange()` in derselben Transaktion.
- **Panel:** `GET /users-api/agents/:id` liefert zusätzlich `canChangeAccess`
  und `accessEnvironment` (`AgentAccessEnvironmentService`: bubblewrap-Probe,
  höchstens einmal pro Minute; erkannte MCP-Server). Reiter
  `app/components/users/agents/agent-access-section.tsx`.
- **Chat-Start:** `AgentEmployeeSessions.employeeRun()` →
  `employeeAcpRunner(assignment, access, hostMcpServers)`
  (`backend/service/chat/acp/EmployeeAcpRunners.ts`):
  - `read_only` → Laufmodus „Nur Lesen“, Chat-Profil mit Helper bzw. nativer
    Pica-Build, keine Host-MCP-Server – technisch gesperrt wie bisher.
  - `workspace` → Laufmodus `yolo` (Profil `CHAT_FULL_ACCESS_PROFILE`,
    `bypassPermissions`), Stock-Runner, Host-MCP-Server, bubblewrap Pflicht
    (`requireAcpIsolation`).
  - `yolo` → wie `workspace`, aber `AcpChatOptions.isUnisolated`;
    `CliSessionExecution.isolateWorker()` startet den Worker dann ohne
    Namespace. Nur dieser Fall überspringt die Isolation; Plan-Schritte nie.
- **Vorgabe:** `createAgentEmployeeInstructions()` erzeugt den Zugriffsabsatz
  aus der Stufe; `picaHelperUsage(path, hasHostTools)` erlaubt bei Host-Tools
  andere Werkzeuge neben dem Helper.
- **MCP-Server im Chat:** `chatMcpServers()` (`PicaAcpRunners.ts`) setzt
  `session/new.mcpServers` = Pica-Bridge (falls der Runner sie braucht) +
  Host-Server. Die CLIs übernehmen sie über ACP; Claude Code bleibt bei
  `strictMcpConfig`, lädt also genau diese Liste.
- **Werkzeugnutzung:** `PicaAcpToolCalls` liest `tool_call`/`tool_call_update`
  der ACP-Sitzung (Titel, `rawInput`, Inhalt/`rawOutput`), maskiert und kürzt
  sie und schreibt sie als `tool`-Ereignis (`isNative`, `input`, `output`) ins
  Job-Journal. `AgentEmployeeSessions.toolCalls()` faltet das Journal des
  neuesten Jobs (`foldToolCalls`) für die Chat-Seite: Aufrufe je Antwort und die
  laufenden Aufrufe.
- **Abbrechen:** Chat-Seite Intent `cancel-tool` →
  `AgentEmployeeSessions.cancelTool()` → `PicaAcpService.cancelTool()` →
  `PicaAcpJob.cancelTool()` → `AcpSession.cancelTool()` →
  `AcpTurnControl.cancelWith()`: `session/cancel` beendet den laufenden Prompt
  samt Aufruf, der Turn geht sofort mit einem Hinweis an den Agent weiter.
- **Dateien anhängen:** `PicaHostFileTools` registriert
  `tickets_attach_file`/`wiki_page_attach_file`; `AgentHostFiles` prüft per
  `realpath`, dass die Datei im Arbeitsordner des Chats liegt, und lädt sie über
  `TaskAttachmentService.upload` bzw. `WikiService.uploadAttachment` mit dem
  Agent-Konto hoch.

### Herkunft der MCP-Konfiguration

`backend/agents/cli/CliHostMcpServers.ts` liest bei jedem Chat-Start die
Benutzer-Konfiguration der CLI des Agents aus dem Home des Systembenutzers, unter
dem Pages läuft:

| CLI         | Datei                                                                     | Schlüssel                                                                                                     |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Claude Code | `~/.claude.json` (`claude mcp add -s user …`)                             | `mcpServers.<name>`: `command`/`args`/`env` oder `type`+`url`/`headers`                                       |
| Codex       | `$CODEX_HOME/config.toml`, sonst `~/.codex/config.toml` (`codex mcp add`) | `[mcp_servers.<name>]`: `command`/`args`/`env` oder `url`/`http_headers`; `enabled = false` wird übersprungen |
| OpenCode    | `$XDG_CONFIG_HOME/opencode/opencode.json`, sonst `~/.config/opencode/…`   | `mcp.<name>`: `type: local` mit `command[]`/`environment` oder `type: remote` mit `url`/`headers`             |
| Antigravity | `~/.gemini/antigravity/mcp_config.json`, dann `~/.gemini/settings.json`   | `mcpServers.<name>` wie Claude Code (`url`, `httpUrl`, `serverUrl`)                                           |

- Die CLIs selbst sehen diese Dateien nicht, weil Pages sie mit dem
  Credential-Ordner der Anbindung als Home startet; Pages reicht die Server
  deshalb über ACP weiter.
- Unlesbare oder ungültige Dateien werden protokolliert und übersprungen; sie
  verhindern keinen Chat. Server mit den Namen `pages` oder `pages-pica` werden
  ignoriert, damit sie die Pages-Werkzeuge nicht ersetzen.
- In „Arbeitsplatz“ läuft ein `stdio`-Server innerhalb von bubblewrap; das Home
  des Dienstkontos ist dort verborgen. Ein Server, dessen Programm nur im Home
  liegt, funktioniert deshalb nur in „YOLO“.
- Austauschbar: `CliHostMcpServers` nimmt Home, Umgebung und Leser als
  Abhängigkeit, `AgentAccessEnvironmentService` die Isolationsprobe und die
  MCP-Erkennung – so lassen sie sich in der Entwicklungsumgebung nachstellen.
