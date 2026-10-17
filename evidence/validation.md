# PAGE-69 – Abschließende Validierung

Stand: 17.10.2026, Branch `task/PAGE-69`, Basis `b4aa340`.
Der vom Auftraggeber gesicherte WIP-Commit `9bca41d` bleibt unverändert bestehen.
Alle unten aufgeführten schweren Läufe wurden nach dem Resume seriell ausgeführt,
jeweils nach `free -m`, ohne laufenden Dev- oder Scratch-Server. ESLint lief allein
mit seinem bestehenden Heap-Limit von 3072 MiB. Kein Coverage-Lauf.

## Gates und exakte Befehle

Arbeitsverzeichnis ist der beauftragte Worktree, bei den ausdrücklich markierten
MCP-Befehlen dessen Unterverzeichnis `mcp/`. Alle Timeouts sind harte äußere
Prozessgrenzen. Die abschließenden Exit-Codes werden außerdem außerhalb des Repos
in `/home/igor/Results/page69-20261017/exit-code.txt` festgehalten.

| Prüfung                                           | Befehl                                                | Exit / Ergebnis |
| ------------------------------------------------- | ----------------------------------------------------- | --------------- |
| Check, abschließender Lauf nach Bereinigung       | `timeout 600s pnpm run check`                         | 0               |
| Lint                                              | `timeout 600s pnpm run lint`                          | 0               |
| Produktionsbuild                                  | `timeout 600s ./node_modules/.bin/react-router build` | 0               |
| MCP-Build in `mcp/`                               | `timeout 180s node build.config.ts`                   | 0               |
| MCP-TypeScript in `mcp/`                          | `timeout 180s ./node_modules/.bin/tsc --noEmit`       | 0               |
| Provisioning-Syntax, ohne Ausführung/Installation | `bash -n scripts/provision-agent-tools.sh`            | 0               |

`pnpm` startete beim Resume erfolgreich; ein Launcher-EACCES-Fallback war nicht
erforderlich. Die unveränderten Skripte führen exakt Folgendes aus:

```sh
react-router typegen && tsc --noEmit && prettier --check .
node --max-old-space-size=3072 node_modules/eslint/bin/eslint.js . --max-warnings=0
```

Der Produktionsbuild enthält den Pages-MCP-Bundle neben dem Server. Die
vorhandenen Build-Warnungen zu CSS `::highlight`, Zod-Pure-Annotationen und
Chunk-Größen verhinderten den Build nicht. Check und Lint sind keine
Funktions- oder Coverage-Nachweise.

## Gezielte Unit-Tests

Alle Installations-, Download-, Netzwerk-, Credential- und Prozessgrenzen sind
gemockt. Die Zuordnung aller 16 Mindestfälle steht in
[unit-test-map.md](unit-test-map.md). Keine echten Installationen in Vitest.

```sh
timeout 180s ./node_modules/.bin/vitest run --config vitest.backend.config.ts --coverage.enabled=false --maxWorkers=1 tests/backend/backend/service/agents/tools tests/backend/app/routes/page69-tools-access.unit.test.ts tests/backend/backend/agents/cli/page69-mcp-bundle.unit.test.ts
```

Exit **0**: 11 Dateien, **60 Tests bestanden**, 3,11 s.

```sh
timeout 180s ./node_modules/.bin/vitest run --config vitest.frontend.config.ts --coverage.enabled=false --maxWorkers=1 tests/frontend/app/components/settings/page69-tools.unit.test.tsx
```

Exit **0**: 1 Datei, **7 Tests bestanden**, 2,03 s.

Unabhängiges MCP-Paket, getrennt von der Pages-Discovery, Arbeitsverzeichnis `mcp/`:

```sh
timeout 180s ./node_modules/.bin/vitest run --config vitest.config.ts --coverage.enabled=false --maxWorkers=1
```

Exit **0**: 32 Dateien, **801 Tests bestanden**, 6,41 s. Darin enthalten ist der
neue feste Health-Start ohne Credentialzugriff. Pages-Tests importieren keine
ausführbaren Module des unabhängigen Pakets.

## Vollständige Bestandsläufe

Die Umgebung für `npx` verwendet eine leere eigene npm-Konfiguration und einen
Scratch-Cache; sie liest keine echte npm-Konfiguration. Die lokalen Binaries
waren vorhanden, es wurde kein Paket nachinstalliert. Das Scratch-Verzeichnis
existierte während dieser Läufe und wurde danach gelöscht.

```sh
npm_config_userconfig=/dev/null npm_config_globalconfig=/tmp/page69-scratch/empty-global.npmrc npm_config_cache=/tmp/page69-scratch/npm-gates timeout 900s npx vitest run --config vitest.backend.config.ts --coverage.enabled=false --maxWorkers=1
```

Exit **1**, 100,02 s: **4637 bestanden, 3 fehlgeschlagen**, insgesamt 4640 Tests;
292 Dateien bestanden, 2 fehlgeschlagen. Ausschließlich die angekündigten Fehler:

- `page73-group-inputs.unit.test.ts`: `refuses claude_code before opening a group session`.
- `page73-group-model.unit.test.ts`: `rejects missing values, wrong types, deleted ports and groups with fewer than two agents`.
- `page73-group-model.unit.test.ts`: `refuses OpenRouter and direct Claude as distinct technical adapters even with the same model label`.

```sh
npm_config_userconfig=/dev/null npm_config_globalconfig=/tmp/page69-scratch/empty-global.npmrc npm_config_cache=/tmp/page69-scratch/npm-gates timeout 900s npx vitest run --config vitest.frontend.config.ts --coverage.enabled=false --maxWorkers=1
```

Exit **1**, 94,95 s: **245 bestanden, 6 fehlgeschlagen**, insgesamt 251 Tests;
44 Dateien bestanden, 4 fehlgeschlagen. Ausschließlich die angekündigten Fehler:

- `page61-plan-graph.unit.test.tsx`: Panning/Zoom und Flächen-/Sidepanel-Layout (2).
- `page72-plan-nodes.unit.test.tsx`: Typfarben bei Ausführungsstatus und Ticket-Workflow (2).
- `page73-group-editor.unit.test.tsx`: Agent-/Gruppen-/Ticket-/Parameter-Editor (1).
- `page51-pica-mascot.unit.test.tsx`: Pica-Maskottchen im Launcher (1).

Keine Abweichung von den angekündigten **3 Backend-/6 Frontend-Fehlern** im
abschließenden Bestandslauf. Bestehende Assertions wurden nicht abgeschwächt.
Der einzige angepasste bestehende Pages-Test ergänzt einen Mock für den neuen
Startup-Dienst, damit der Server-Unit-Test keine echte Instanz/DuckDB öffnet.

## Reale Scratch-Prüfung

Diese Prüfung ist getrennt von Vitest: ausschließlich eigene Konfiguration,
DuckDB, synthetische Nutzer und `HOME=/tmp/page69-scratch`, Port **3190**.
Keine echten Anbieter-Credentials, kein Modellaufruf, keine globale Installation,
kein Root, keine Änderung an Host-Sicherheitsrichtlinien.

- Echte private Installation und Versionsprobe: Codex 0.160.0, Claude Code
  2.1.293, OpenCode 1.18.34, Codex ACP 2.1.1/2.2.2, Playwright MCP 0.0.83.
- ACP-Initialize und MCP-Initialize/Tools-Liste erfolgreich. Playwright akzeptiert
  die tatsächlich verwendeten Argumente für Headless, Chromium, isoliertes Profil,
  Sandbox, Session-Aufzeichnung und Artefaktverzeichnis.
- Update 2.1.1 → 2.2.2 und Rollback erfolgreich; neues freigegebenes Ziel beim
  Start automatisch übernommen, expliziter Rollback beim weiteren Start erhalten.
  Abschließend aktive Generationen bytegleich, kein manueller Reinstall nötig.
- Gebauter HTTP-Server: Admin-GET 200 mit Inventar und `no-store`, Node-Prüfung
  200; normale Benutzer GET/POST 403; anonym GET/POST 302; unbekannte ID und fremder
  Origin 400. Der äußere Router weist den fremden Origin bereits ab.
- Browser-Aktivierung: HTTP 409 mit `browser_sandbox_unavailable`; übersetzte
  Host-Erklärung sichtbar, Pages weiterhin HTTP 200. Download und ausführbare
  Chromium-Version 155.0.8059.12 erreicht, echter Sandbox-Start auf diesem Host
  nicht möglich. Kein `--no-sandbox` und keine Policy-Änderung.
- `CliSessionExecution.open` blockiert fehlendes Node mit
  `node / missing_dependency / not_installed` vor Credentialzugriff/Spawn.
  Reales Prozesspaar nach Abbruch vollständig beendet.
- Letzter Scratch-Server PID **598340** mit `kill 598340` beendet; Prozessende
  und geschlossener Port 3190 geprüft. Scratch und temporäre Archive gelöscht.

Zusätzliche abschließende Befehle: privater ACP-Test über lokales `tsx` mit
Timeout 50 s, HTTP-Rechteprüfung über Python mit Timeout 60 s und
Prozess-/Run-Sperrprüfung über lokales `tsx` mit Timeout 45 s: jeweils Exit **0**.
Die Hilfsdateien lagen nur im anschließend gelöschten Scratch-Verzeichnis;
sichere Ergebnisse ohne Credentials: [scratch.json](scratch.json).

## Unterbrechung und vorbereitende Fehler

Der Auftraggeber meldete den vorherigen OOM-Abbruch um 20:34. Für den dadurch
abgebrochenen alten Lauf liegt kein gesicherter Exit-Code vor; es wird keiner
erfunden. Der WIP-Snapshot `9bca41d` wurde beibehalten.

Beim Resume wurden die etwa 1,9 GB privaten Scratch-Tools während der Gates
vorübergehend auf das Worktree-Dateisystem archiviert, um RAM/tmpfs zu entlasten.
Der erste erneute Check endete **2**, weil Prettier dieses anfangs im Repo-Root
liegende große Archiv als Text lesen wollte (`Invalid string length`). Es wurde
ohne Änderung der Check-Regeln in den bereits ausgeschlossenen lokalen Cache
verschoben. Beide eigenen Archive sind abschließend gelöscht.

Die Browser-HTTP-Prüfung endete zunächst zweimal **1**: zuerst wegen der
Scratch-/tmpfs-Benutzerquote beim Browserdownload (Systemfehler -122), danach
wegen eines zu früh gestarteten Requests vor dem Listener. Nach Speicherfreigabe
und Listener-Prüfung bestand dieselbe Prüfung mit Exit **0** und der erwarteten
Host-Sandbox-Diagnose. Keine Host-Quote oder Policy wurde verändert.

Nach Archivwiederherstellung wurde ACP zunächst mit `permission_denied` angezeigt.
Die private Einzelprobe und der folgende gebaute Server meldeten `ready`, ohne
Änderung am Quellcode oder an Dateirechten für den Wiederholungsversuch. Die
Ursache ist nicht isoliert; der letzte erfolgreiche Status und die Beobachtung
sind beide dokumentiert. Ein zusätzlicher Vergleich im temporären HTTP-Helfer
scheiterte an String-gegen-Objekt-Vergleich der Pointer; nach Korrektur des Helfers
bestätigt der Bytevergleich unveränderte aktive Generationen.

Vor dem OOM gab es einen zusätzlichen Scope-Fehler im neuen Manifest-Pfadtest;
er wurde durch Verwendung der vorhandenen Pages-Versionskonstante behoben,
ohne die Scope-Prüfung zu ändern. Außerdem scheiterten einzelne vorbereitende
Vitest-Läufe an temporären Transformdateien (`ENOENT`). Die abschließenden
gezielten und vollständigen Läufe zeigen diese Fehler nicht. Die Exit-Codes
dieser unterbrochenen früheren Versuche wurden nicht nachträglich rekonstruiert.
