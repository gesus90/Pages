# PAGE-69 – Mindestfälle aus Abschnitt 15

Alle hier genannten Unit-Tests mocken Installation, Downloads, Dateisystem,
Provider, Netzwerk und native Prozesse an den jeweiligen Grenzen. Die separaten
realen Scratch-Prüfungen sind keine Unit-Tests und werden nicht in diese Suiten
aufgenommen.

Basisverzeichnis der Tool-Tests:
`tests/backend/backend/service/agents/tools/`.

| Mindestfall                               | Testdatei / beobachtetes Verhalten                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fehlendes Tool installieren               | `page69-manager.unit.test.ts`: genau ein verifizierter Kandidat, aktive Generation.                                                                                                              |
| Vorhandenes Tool verwenden                | `page69-manager.unit.test.ts`: kompatible Systeminstallation ohne Installer-Aufruf.                                                                                                              |
| Inkompatible Version erkennen             | `page69-manager.unit.test.ts`, `page69-health.unit.test.ts`: unsupported statt ready; nur freigegebener Ersatz.                                                                                  |
| Defekte Installation reparieren           | `page69-manager.unit.test.ts`: neue Generation, defekter Bestand nicht weiterverwendet.                                                                                                          |
| Gleichzeitige Installationen koordinieren | `page69-manager.unit.test.ts`: konkurrierende Aufrufer teilen Installation/Ergebnis.                                                                                                             |
| Update und Rollback                       | `page69-manager.unit.test.ts`, `page69-files.unit.test.ts`, `page69-update-startup.unit.test.ts`: alter Bestand bei Fehler erhalten, Probe vor Aktivierung, tatsächliche alte Versionsmetadaten. |
| Logins erhalten                           | `page69-manager.unit.test.ts`, `page69-installer.unit.test.ts`, `page69-runtime.unit.test.ts`: Credential-Grenze getrennt, keine Lösch-/Schreiboperation.                                        |
| ACP-Handshake                             | `page69-health.unit.test.ts`, `page69-runtime.unit.test.ts`: vorhandene ACP-Engine/Fake-Peer, exakte Treiber-/Versionsprüfung, Prompt und Modell unverändert.                                    |
| MCP-Server startet                        | `page69-health.unit.test.ts`: Fake-Stdio, Initialize, Initialized, Tools-Liste, Paketversionsprüfung und Closeout.                                                                               |
| Browser startet                           | `page69-browser-script.unit.test.ts`, `page69-health.unit.test.ts`: Probescript mit gemocktem Playwright ausführen; Sandbox, Navigation, Closeout und Fehlerdiagnose.                            |
| Bubblewrap prüfen                         | `page69-sandbox.unit.test.ts`, `page69-health.unit.test.ts`: echte Probe-Grenze statt bloßer Dateipräsenz, Namespace-Fehler blockieren.                                                          |
| Fehlende Rechte blockieren Installation   | `page69-manager.unit.test.ts`, `page69-installer.unit.test.ts`: EACCES/EPERM und Root abweisen, keine Credentials ändern.                                                                        |
| Run bei fehlenden Dependencies verhindern | `page69-runtime.unit.test.ts`: `CliSessionExecution.open` verweigert vor Credentialzugriff/Spawn; auch ausfallende zweite Namespace-Probe.                                                       |
| Abbruch beendet Prozesse                  | `page69-runtime.unit.test.ts`: bestehende Prozessgruppen-Kündigung, Lease erst nach bestätigtem Closeout freigeben.                                                                              |
| Neustart stellt Betriebsbereitschaft her  | `page69-manager.unit.test.ts`, `page69-runtime.unit.test.ts`: aktivierte Tools ohne Neuinstallation rekonstruieren, gespeicherte lokale Anmeldung prüfen.                                        |
| Unberechtigte Verwaltung verweigern       | `page69-manager.unit.test.ts`, `tests/backend/app/routes/page69-tools-access.unit.test.ts`: frische persönliche Admin-Rechte in Loader/Action/Service; feste IDs und Origin.                     |

Weitere Frontend-Abdeckung:
`tests/frontend/app/components/settings/page69-tools.unit.test.tsx` prüft DE/EN,
Status-/Aktivitätsanzeige, Aktionen, Fehler und ausdrückliches Browser-Opt-in.
Der unabhängige Health-Start des MCP-Pakets ist ausschließlich in
`mcp/tests/src/start.unit.test.ts` getestet.
