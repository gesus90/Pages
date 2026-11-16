# Getrennte Plan-Runtimes

`pages-runs.mjs` lädt `build/runs/index.js`. `vite.config.ts` erzeugt diesen
Node-Einstieg im Modus `runtimes` unabhängig von React Router. Gemeinsam
benötigter Code liegt unter `build/runtime-chunks/`.

Neue Plan-Schritte laufen über Runner-Worker. Der Runs-Prozess plant und
steuert; native Prozesse, API-Aufrufe, Skripte und deren Prozessbereinigung
gehören zum Runner. Der frühere lokale Owner-Einstieg und seine
Neuerzeugung entfallen. Vorhandene Owner-Bundles und Runtime-Chunks bleiben
beim Build für bereits existierende Alt-Besitzer erhalten. Deren
Wiederanbindung und Abschluss bleiben als eng begrenzte Kompatibilität
verfügbar. Der aktuelle Vertrag steht unter [LocalRunner.md](LocalRunner.md).

`RunsServices` verbindet Plan-Konfiguration, Engine, Inbox, Recovery, native
Owner-Importe, Runner-API-Kanal, Aufräumen, Datenbank und Logging. Die
API-Fähigkeiten bleiben im API-Prozess. Schlanke Beobachter schreiben dort
entstehende Planereignisse weiterhin in die dauerhaften Automations- und
Benachrichtigungs-Inboxen, auch während der Startup-Recovery. Die API behält
Pica, Chats, Mobile-Endpunkte, Automationsausführung und die modellbezogenen
Katalog-/Preisscheduler. Integrationszustellung bleibt beim konfigurierten
Integrationsbesitzer. Im kombinierten Betrieb bleiben diese Rollen im Server.

## Zeitschleifen des Runs-Prozesses

| Schleife                                                      | Abstand                                                          | Begründung / Schreibverhalten                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlanRunCommandWorker`                                        | 500 ms, zusätzlich Socket-Weckruf                                | Verlust eines Weckrufs und abgebrochene Befehlszustellungen werden zeitnah versöhnt; leere Inbox und unveränderte Owner erzeugen keine Metadatenänderung.            |
| `AgentWorkspaceCleanupService`                                | 2 s                                                              | Liest nur fällige Pflichten; die persistierte Wiederholungsfrist bleibt maßgeblich.                                                                                  |
| Agent-Umgebungs-/Storage-Wartung (`WikiMaintenanceScheduler`) | 60 s, einmal beim Start                                          | Versöhnt Dateireste, Speicherwarnungen, abgeschlossene Läufe und freie Toolgenerationen ohne neue Planstarts; Daten werden bei tatsächlichem Aufräumbedarf geändert. |
| `AgentPlanOneShotScheduler`                                   | 15 s, einmal beim Start                                          | Dauerhafte Löschfristen erfolgreicher Einmalpläne sind nach Neustarts zeitnah fällig.                                                                                |
| `AgentRunLogRecorder.flush`                                   | 1 s                                                              | Bündelt vorhandene Logzeilen; ein leerer Puffer wird nicht geschrieben.                                                                                              |
| `AgentRunLogRecorder.prune`                                   | 6 h, einmal beim Start                                           | Führt Diagnoseaufbewahrung unabhängig von neuen Planläufen aus.                                                                                                      |
| PostgreSQL-Besitzverbindung (`PostgresSessionLock`)           | 15 s                                                             | `SELECT 1` erkennt Verlust der exklusiven Runs-Besitzverbindung; keine Nutzdatenänderung.                                                                            |
| `ServiceWatchdog`                                             | `WATCHDOG_USEC / 3000`, begrenzt auf 100 ms bis 10 s; sonst 10 s | Nur mit `NOTIFY_SOCKET`; prüft tatsächlichen Inbox-/Datenbankfortschritt, ohne Nutzdaten zu schreiben.                                                               |
| Logger-Datenbankmetriken                                      | 5 s                                                              | Aggregiert Diagnostik im Log, keine Nutzdatenänderung.                                                                                                               |
| `planTurnTimeout`                                             | 100 ms, nur während eines befristeten Turns                      | Zählt aktive Ausführungszeit; Pausen zählen nicht gegen die Frist. Kein SQL.                                                                                         |
| Swarm-Leases                                                  | 40 s (= 120 s / 3), nur bei aktivem Swarm                        | Erneuert ausschließlich tatsächlich belegte Swarm-Leases vor Ablauf.                                                                                                 |

Weitere zeitgesteuerte Wiederholungen sind `setTimeout`-basiert:
ACP-Warteschlangen und Lease-Reconciliation nur bei Bedarf, Journal-Importe
nur angehängter Sitzungen, Journal-Kompaktion gebündelt nach 1 s und als
60-s-Sicherheitslauf, Remote-Verbindungswiederherstellung nur nach Verlust.
`AgentDeferredGarbage` ist ereignisgesteuert: Commit bzw. Wartung stößt einen
Durchlauf an. Währenddessen bleibt die Scheduling-Sperre gesetzt; eigene
Purge-Commits können keinen zweiten Durchlauf erzeugen. Zurückgestellte
Pflichten werden frühestens nach 60 s erneut bearbeitet. Geschützte Läufe
lösen weder Fehlerindex-Schreibarbeit noch eine leere Ablehnungsbereinigung
aus. Die Schutzbedingungen werden vor einer wirklichen Löschung nochmals
unter Zeilensperre geprüft.

Native Kindprozesse haben eigene unveränderte Schleifen: Owner-Stop/Deadline
250 ms, Owner-Retirement 1 s, Script-Control 100 ms. Sie sind keine
zusätzlichen Scheduler im Runs-Hauptprozess.

Nicht mehr in `pages-runs`: Automations-Scheduler/-Agent-Worker,
Modellkatalog-Scheduler, beide täglichen OpenRouter-Preisaktualisierungen,
Live-Change-Heartbeat, Remote-Konsole, Browser-/Chat-/Employee-Schleifen,
Discord/GitHub-/Mobile-Zustellung, Wiki-/Session-Wartung der API,
Runner-/Mobile-WebSocket-Heartbeats. `RunApiBridge`-Cleanup (500 ms) gehört
weiterhin ausschließlich zur API. Die Automationsausführung der API startet
Pläne bei `runsMode = separate` über die bestehende Befehls-Inbox.

## Historische Funktionsbelege und damalige QA-Hinweise

Die folgenden Nachweise und offenen Hinweise stammen aus der früheren
Runtime-Trennung. Sie werden hier erhalten; sie sind keine ausgeführten
Prüfungen der aktuellen Runner-Umstellung und keine zusätzlichen
Abschlussvoraussetzungen. Deren gezielte Nachweise und Grenzen sind in
[LocalRunner.md](LocalRunner.md) dokumentiert.

Ergebnis der gezielten Läufe ohne Coverage: 16 Dateien / 180 Tests grün;
ein zusätzlicher Test zur Installation der Planbeobachter vor Recovery grün;
ach der ACP-Trennung nochmals 5 Dateien / 70 Tests grün (mit Überschneidungen
zum ersten Lauf), zusätzlich 3 Tests zur Pica-Berechtigungsübergabe grün. Alle Läufe verwenden `pnpm exec vitest run --config
vitest.backend.config.ts --coverage.enabled=false` mit expliziten Dateifiltern.

Die fokussierten Unit-Tests prüfen Rollenverdrahtung, Recovery-/Shutdown-Reihenfolge,
unveränderte Owner-Proofs ohne UPDATE, konkurrierende Adoption,
Purge-Reentranz, Wiederholungsfrist und schreibfreie geschützte/leer gelaufene
Bereinigung. Bestehende fokussierte Tests sichern lokale Sitzungen und
Plansteuerung ab. Externe Grenzen werden gemockt; kein Providerlauf ist nötig.

Igor hat Speicher- und CPU-Messungen am 15.11.2026 aus dem Ticketumfang
gestrichen. Ein MB-Ziel, eine Vorher-/Nachher-Messung, eine Benchmarkkampagne
oder eine dafür zu startende Wegwerf-Instanz sind keine Aufgabe oder
Abschlussvoraussetzung. Ressourcenmessungen wurden nicht durchgeführt;
daraus wird kein gemessener Speicher- oder CPU-Erfolg abgeleitet.

Die technische Umsetzung liegt in Commit `7fdda59c`. Die vorhandenen
Funktionsbelege bleiben erhalten und werden wegen der entfallenen
Messanforderungen nicht wiederholt. Lint, Check, Typecheck, Build,
Gesamtsuiten und Coverage sind **an die Abschluss-QA übergeben**; sie wurden
vom Ticket-Agenten nicht als grün nachgewiesen.

Die bereits dokumentierten QA-Hinweise bleiben bestehen: 19 abweichende
Erwartungen in einem Retention-Test verlangen `state = 'pending'`
statt der unveränderten Schutzbedingung `state <> 'completed'`; zwei
Erwartungen in einem OpenCode-Pause-Test passen nicht zur
vorhandenen Codex-basierten Pause-Implementierung. Diese Tests und
Verhaltensregeln wurden nicht abgeschwächt oder fachfremd geändert.

Gemeinsamer Testserver, `/opt/pages`, Port 3000, `~/.pages`, Live-Dienste,
Live-Datenbank und Session-Pläne bleiben unberührt. Es erfolgen kein Push,
Rebase, Branchwechsel oder Deployment.
