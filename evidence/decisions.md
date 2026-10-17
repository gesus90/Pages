# PAGE-69 – Eigenentscheidungen und Abnahmestand

Basis `b4aa340`, Branch `task/PAGE-69`, ausschließlich der beauftragte Worktree.
Die abschließenden Befehle und Ergebnisse stehen in [validation.md](validation.md).

## Abnahmekriterien

| Nr. | Kriterium                                             | Stand und Nachweis                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zentraler Tool Manager                                | Vollständig: feste Registry, Dependency-Graph, koordinierte Operationen, Health und Supervisor.                                                                                                                                           |
| 2   | Codex, Claude Code und OpenCode verwaltbar            | Vollständig: private Installation und echte Versionsproben aller drei CLIs im Scratch-Bereich.                                                                                                                                            |
| 3   | Codex ACP automatisch installierbar                   | Vollständig: verwaltete Auflösung im vorhandenen Runner; echte Initialize-Handshakes mit 2.1.1 und 2.2.2.                                                                                                                                 |
| 4   | Playwright MCP automatisch installierbar              | Vollständig: echte Installation und MCP-Initialize/Tools-Liste; Paketversion separat verifiziert.                                                                                                                                         |
| 5   | Browser automatisch bereitstellbar                    | Teilweise abgenommen: Download, Executable-Verweis, Sandbox-Probe und Diagnose implementiert/getestet. Echter Chromium-Start wegen Host-Sandbox blockiert; siehe offene Punkte.                                                           |
| 6   | Systeminstallationen erkennbar                        | Vollständig: bestehender Locator, sichere Pfadauflösung, ausführbare kompatible Versionen; Node und Bubblewrap real geprüft.                                                                                                              |
| 7   | Dependencies beim Pages-Start prüfbar                 | Vollständig: asynchroner Warmup, gespeicherte aktivierte Tools und CLI-Verbindungen, lokale Loginchecks. Optionale Fehler verhindern den HTTP-Start nicht.                                                                                |
| 8   | Fehlende freigegebene Tools automatisch installierbar | Vollständig: feste npm-Pakete/Browser, private Generationen, idempotente koordinierte Aufrufe. Privilegierte Host-Pakete bleiben beim Betreiber.                                                                                          |
| 9   | Automatische Reparatur                                | Vollständig: defekte verwaltete Generation wird funktional geprüft ersetzt; Mock-Regressionen für Defekte und fehlgeschlagene Kandidaten.                                                                                                 |
| 10  | Kontrollierte Updates mit Rollback                    | Vollständig: prüfen, atomar aktivieren, vorige Generation behalten; real 2.1.1 → 2.2.2 → 2.1.1. Neue freigegebene Code-Ziele werden beim Start automatisch übernommen; expliziter Rollback bleibt bis zu einer anderen Freigabe erhalten. |
| 11  | Bestehende Logins erhalten                            | Vollständig implementiert: getrennte Credential-/Tool-Verzeichnisse; Unit-Tests und realer synthetischer Credential-Marker. Echte Konten wurden nicht verwendet.                                                                          |
| 12  | ACP-/MCP-Prozesse automatisch starten                 | Vollständig im bestehenden Execution-Pfad: Initialisierung, gepinnte Versionen, autorisierte sessionbezogene MCP-Einträge; reale Modell-freie Proben, Session-Verträge gemockt.                                                           |
| 13  | Prozesse zuverlässig beenden                          | Vollständig im vorhandenen Closeout/Scheduler: Prozessgruppen, Tags, Eskalation und Lease-Pinning; echter Abbruch von Eltern-/Kindprozess bestätigt.                                                                                      |
| 14  | Dependency-Readiness vor Runs                         | Vollständig: bestehender `CliSessionExecution` verweigert den Start mit konkreter Tool-Ursache, bevor Credentials oder Prozesse verwendet werden. Auch Abbruch während geteilter Installation getestet.                                   |
| 15  | Sandbox-Sicherheit erhalten                           | Vollständig: Bubblewrap/Namespaces real geprüft; verwaltete Sessions verlangen Isolation, auch im Read-only-Modus. Tools/Node/MCP schreibgeschützt, fremde Homes und Daten geschützt.                                                     |
| 16  | Keine stillen Sicherheits-Fallbacks                   | Vollständig: fehlende Namespaces, Rechte, Modelle/Adapter oder Browser blockieren; kein anderer Provider/Runner, kein `--no-sandbox`.                                                                                                     |
| 17  | Administratoroberfläche                               | Vollständig: Einstellungen → Agents → Tools, DE/EN, feste Aktionen, persistierte persönliche Admin-Rechte in Loader/Action/Service; reale HTTP-Rechteprüfung.                                                                             |
| 18  | Verständliche Status-/Fehlermeldungen                 | Vollständig: alle geforderten Zustände, installierte/freigegebene Version, Quelle, Prozesse, Checkzeit, Loginchecks und sichere Diagnosecodes. Chromium-Sandbox separat erklärt.                                                          |
| 19  | Automatisierte Tests                                  | Vollständig: gemockte Unit-Tests für sämtliche 16 Mindestfälle, separate Backend-/Frontend-Suiten und unabhängige MCP-Tests. Bekannte Bestandsfehler werden offen ausgewiesen.                                                            |
| 20  | Neustart ohne manuelle Tool-Installation              | Für die erfolgreich geprüften Tools vollständig: persistierte Generationen werden wiederverwendet. Browser wird automatisch erneut geprüft/bereitgestellt, bleibt auf diesem Host an Kriterium 5 gebunden.                                |

## Eigenentscheidungen

1. Bestehende `CliLocator`, `AgentCliRuntime`, `CliSessionExecution`, ACP-Engine,
   Credential-/Login-Dienste und Ressourcen-Scheduler bleiben maßgeblich. Keine
   zweite Execution-Engine, keine vorweggenommene PAGE-67-Logger-Anbindung.
2. Offizielle Registry-Versionen wurden am 17.10.2026 tatsächlich per HTTPS
   abgefragt. Nachweise einschließlich Integritäten: [registry.json](registry.json).
   Ziele: Codex 0.160.0, Claude Code 2.1.293, OpenCode 1.18.34, Codex ACP 2.2.2
   (auch 2.1.1 freigegeben), Playwright MCP 0.0.83 mit dessen exakter
   Playwright-Abhängigkeit 1.64.0-alpha-1790635538000. Der ACP-interne Codex ist
   auf die ebenfalls nachgewiesene Version 0.160.1 begrenzt. Keine erfundenen
   Versionen, kein `latest`, keine automatischen Major-Upgrades.
3. `<Instanz>/tools` enthält private unveränderliche Generationen, npm-Cache und
   Probe-Home. Credentials bleiben im bisherigen Datenverzeichnis. Kandidaten
   werden erst nach Funktionsprüfung atomar aktiviert. Die reale Generation
   behält auch nach Rollback ihre Versionsmetadaten. Alte Generationen bleiben
   für aktive Sessions/Recovery erhalten; automatische Speicherbereinigung ist
   nicht vorgesehen.
4. npm verwendet Argument-Arrays, feste Registry und zwei verschiedene leere
   private Konfigurationsdateien (moderne npm-Versionen lehnen denselben Pfad
   für beide ab). Keine globalen Installationen, keine geerbten npm-Credentials.
   Installationsskripte bleiben aus; nur die bekannten Top-Level-Setups von
   Claude/OpenCode laufen ausdrücklich. Probe-/Installer-Temporärdateien werden
   ebenfalls unter dem privaten Probe-Verzeichnis angelegt.
5. Node 24 ist Voraussetzung für verwaltete Tool-Runs, passend zum bestehenden
   MCP-Paket (`engines.node >=24`). Pages selbst startet weiter mit
   `Node >=22.22`; native Runs unter Node 22 erhalten eine Versionsdiagnose.
   Node, Bubblewrap und Browserbibliotheken werden vom Betreiber bereitgestellt.
6. Pages MCP wird beim Produktionsbuild mit seinem vorhandenen unabhängigen
   Build erzeugt und neben `build/server/index.js` ausgeliefert. Der feste
   interne Startmodus `health-check` initialisiert MCP ohne Credentialzugriff;
   er verwendet ausschließlich synthetisches Token und unerreichbares Loopback.
   Normale Starts und alle Tool-Aufrufe behalten ihre Pages-Autorisierung.
   Pages-Tests importieren keine ausführbaren MCP-Module; keine Test-Aggregation.
7. MCP-Proben verwenden das unterstützte Protokoll `2025-11-25`. Playwrights
   Handshake nennt seine Laufzeitversion, deshalb bestätigt zusätzlich das
   echte installierte Paketmanifest die freigegebene MCP-Paketversion.
8. Playwright verlangt Admin-Aktivierung und ausdrückliches Agent-Opt-in im
   YOLO-Modus. Pica erhält keinen zusätzlichen Browserzugriff. Browserprofile
   sind isoliert; Artefakte liegen unter `.pages-artifacts/<Session>` im
   autorisierten Workspace. Chromium-Sandbox bleibt eingeschaltet.
9. Neue freigegebene Code-Ziele werden für aktivierte verwaltete Tools beim
   Start nach Funktionsprüfung automatisch installiert. Der atomare Pointer
   merkt sich das zuletzt behandelte Ziel; ein ausdrücklicher Rollback bleibt
   beim nächsten Neustart erhalten. Erst ein anderes freigegebenes Code-Ziel
   löst wieder eine automatische Aktualisierung aus. Kompatible übernommene
   Systemtools werden nicht unbeaufsichtigt ersetzt. Fehlgeschlagene Kandidaten
   lassen alte Generationen und aktive Sessions bestehen. Keine periodischen
   Registry-Abfragen, keine Versionsziele aus Web-Eingaben.
10. Die bestehende `pages-server.unit.test.ts` erhält nur einen Mock an der neu
    hinzugekommenen Startup-Grenze. Assertions wurden nicht abgeschwächt. Der
    dokumentierte Warmup darf in einem Server-Unit-Test keine echte Instanz oder
    Datenbank starten. Im unabhängigen MCP-Paket wurde der neue Health-Modus
    in dessen bestehendem Startup-Unit-Test ergänzt.

## Offene Punkte und Grenzen

- **Kriterium 5 / Abschnitte 10–11:** Der reale Browserdownload gelang.
  Chromium meldet auf diesem Host mit aktivierter Sandbox `No usable sandbox`.
  Ein erfolgreicher echter Browserstart, Screenshots und ein kompletter
  Browser-Run sind deshalb nicht abgenommen. Die eigene sichere Diagnose
  `browser_sandbox_unavailable` blockiert den betroffenen Run. Host-Policies,
  Root-Rechte oder Sandbox-Einstellungen wurden nicht verändert. Die Unit-Tests
  prüfen Start/Closeout/Fehler und MCP-Session-Einbindung mit Mocks.
- **Abschnitt 2:** Firefox ist optional installier-/prüfbar; Browser-Sessions
  verwenden Chromium. Eine Firefox-Auswahl je Agent ist nicht implementiert.
- **Abschnitt 14:** Linux-Provisioning-Skript und Container-/Deployment-Hinweise
  sind vorhanden. Das Skript wurde nur syntaktisch geprüft, keine privilegierten
  Pakete installiert. Es gab hier keine bestehende Container-Definition;
  ein tatsächlicher Docker-Image-Build ist nicht abgenommen.
- Echte Anbieter-Anmeldungen, Modellaufrufe und ein vollständiger angemeldeter
  ACP-Run wurden gemäß Credential-Vorgabe nicht durchgeführt. Prompt-, Modell-,
  Credential- und Pages-MCP-Verträge sind mit Mocks im bestehenden Runner geprüft.
- **Kriterien 3/7/20, Beobachtung beim Resume:** Nach dem Wiederherstellen des
  temporär archivierten Scratch-Verzeichnisses wurde Codex ACP zunächst mit
  `permission_denied` angezeigt. Die direkte private Initialize-/Health-Probe
  und danach der erneut gestartete gebaute HTTP-Server meldeten beide `ready`,
  ohne Änderung am Quellcode oder an Dateirechten für diesen Wiederholungsversuch.
  Die Ursache des Zwischenzustands wurde nicht isoliert. Der letzte HTTP-Nachweis
  bestätigt dieselben aktiven Generationen und Betriebsbereitschaft aller
  aktivierten CLIs/ACP/MCP; diese Beobachtung bleibt für die Betreiberprüfung
  dokumentiert und wird nicht als behobener Produktfehler bezeichnet.
- Ein früher Gesamt-Backend-Lauf enthielt einen zusätzlichen neuen Scope-Fehler
  durch einen direkten Manifestimport im neuen Pfadtest. Der Test verwendet
  jetzt die Pages-Versionskonstante; die Scope-Prüfung blieb unverändert. Der
  anschließende vollständige Lauf hat ausschließlich die drei angekündigten
  PAGE-73-Bestandsfehler. Einzelne vorbereitende Mehrdatei-Testläufe scheiterten
  beim Laden temporärer Vitest-Transformdateien (`ENOENT`); die Wiederholungen
  und vollständigen Läufe werden in der Validierung separat ausgewiesen.

## Abschließende reale Prüfung

Der aktuelle Produktionsbuild wurde ausschließlich mit `HOME=/tmp/page69-scratch`,
eigener Konfiguration/DuckDB und Port 3190 geprüft. Im letzten HTTP-Inventar sind
Node, Bubblewrap, Codex, Claude Code, OpenCode, Codex ACP, Pages MCP und Playwright
MCP betriebsbereit. Chromium meldet die oben beschriebene Host-Sandbox-Grenze;
die deaktivierten externen Claude-ACP-/Firefox-Einträge sind nicht geprüft.
Admin-GET und feste Prüfaktion liefern HTTP 200, normale Benutzer bei GET/POST
403, anonyme Requests 302, unbekannte Tool-IDs und fremder Origin 400. Die
abgewiesene Browser-Aktivierung liefert 409 mit konkreter Diagnose; Pages bleibt
erreichbar. Ein Run ohne Node wird vor Credentialzugriff/Spawn blockiert; ein
realer Eltern-/Kindprozess endet nach Abbruch.

Die letzte Instanz wurde mit `kill 598340` beendet, Port 3190 anschließend als
geschlossen geprüft. `/tmp/page69-scratch` und die temporären Runtime-Archive
wurden gelöscht. Die sicheren strukturierten Ergebnisse stehen in
[scratch.json](scratch.json). Port 3000/3100, reale Credentials und die
Produktivinstanz wurden nicht verwendet; kein Push, Merge oder Deployment.
