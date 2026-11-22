# Historisches Format lokaler Agentenbesitzer

Diese Beschreibung hält das Altformat und seine früheren Funktionsnachweise
fest. Neue Plan-Arbeit verwendet ausschließlich den [Runner](LocalRunner.md).
Der verbliebene Code bindet existierende Besitzer wieder an und schließt sie
geordnet ab. Ein weiterer Zug wird erst nach bestätigtem Alt-Abschluss über
Runner gestartet; neue lokale Owner-Units werden nicht erzeugt.

Die folgenden Abschnitte dokumentieren den früheren Betrieb. Ihre Aussagen
über direkte Startwege gelten für gespeicherte Alt-Läufe. Die damaligen
externen Prüfaufträge bleiben unbestätigte historische Aufträge und sind
keine Abschlussvoraussetzungen der heutigen Plan-Umstellung.

Lokale ACP-Planagenten bekommen einen eigenen vertrauenswürdigen Sitzungsbesitzer. `local-agent.mjs` lädt den eigenständigen Owner-Build mit den tatsächlich benötigten Ausführungsdiensten, startet aber keinen Webserver, keine Migration, Startup-Recovery oder Hintergrundzustellung. Der Besitzer hält den echten ACP-Client, dessen offene Protokollanfragen, Recorder und native Sitzung. Die bestehende begrenzte native Worker-Unit läuft unter diesem Besitzer. Der HTTP-Prozess hält nur eine austauschbare Beobachtung.

## Start und Eigentum

Nach der bestehenden Autorisierung und ACP-Kapazitätszulassung speichert Pages einen privaten Startauftrag und dessen SHA-256 in PostgreSQL. Erst danach startet `systemd-run --user` die unabhängige Unit `pages-local-<instanceId>.service`, ohne `--pipe`, `--wait`, `PartOf` oder Bindung an die Web-Unit. Sie hat eigene Grenzen: 512 MiB RAM, 128 MiB Swap, 256 Tasks, 100 % CPU, höchstens 24 Stunden und 35 Sekunden Stop-Frist. Der native Kindprozess behält zusätzlich seine bisherigen Worker- und Namespace-Grenzen.

Das Task-Limit zählt Prozesse und Threads des Besitzers einschließlich seiner echten Werkzeug-Bereitschaftsprüfungen. Im Quellmodus läuft auch der Vite-Compiler in dieser cgroup; das Produktions-Bundle benötigt ihn nicht. Die Bereitschaftsprüfung startet vor der separaten nativen Worker-Unit und benötigt deshalb ein eigenes ausreichendes Task-Budget. Das frühere Limit von 64 wies im isolierten Quellmodus einen Fork ab, auch bei auf zwei CPUs begrenzter Affinität und weniger als 512 MiB gemessenem Speicherverbrauch. 256 ist ein endliches Budget für beide Startmodi; daraus folgt kein vermessenes Produktionsminimum. Es erhöht nur den möglichen gleichzeitigen Prozess-/Threadbestand je Besitzer. Speicher-, CPU-, Laufzeit-, Slice- und übergeordnete Grenzen bleiben wirksam; mehrere Besitzer teilen weiterhin die vorhandenen übergeordneten Ressourcen.

Die privaten Steuerdateien liegen unter `<data>/local-sessions/<instanceId>/` (Verzeichnisse 0700, Dateien 0600). Ein zufälliges Bearer-Capability schützt den ausschließlich lokalen Unix-Socket im Laufzeitverzeichnis des Dienstkontos. Eine neue HTTP-Anbindung erhält zusätzlich ein neues Importer-Token; IPC und Datenbank sperren damit frühere Beobachter aus. Startauftrag und MCP-Slot enthalten private Berechtigungen und gehören weder in Diagnoseausgaben noch in öffentliche Run-Antworten. Provider-Zugangsdaten stehen nicht im Startauftrag; sie werden im Besitzer über die bestehenden Pages-Grenzen aufgelöst. Die Unit übernimmt nur ausdrücklich aufgeführte Umgebungseinstellungen.

Vor Übernahme oder Steuerung werden der gespeicherte Manifest-Digest und die Bindung an Konfiguration, Instanz, Run, Schritt und ursprünglichen Versuch geprüft. Der Nachweis bindet außerdem Boot-ID, UID, PID mit Startzeit, vollständige Prozessargumente, cgroup sowie `MainPID`, `InvocationID`, `ControlGroup` und `ActiveState` der tatsächlichen Unit. Ein Name oder eine PID genügt nicht. Ein geänderter oder fehlender Nachweis führt zu `plan_local_owner_unverified`: keine Übernahme, kein Signal, keine Freigabe unsicherer Reservierungen. Der Startauftrag wird durch `proof.json` einmalig beansprucht; ein gestorbener Besitzer darf denselben Originalprompt nicht erneut starten.

Bei einem fehlgeschlagenen `systemctl --user show` wird die Abfrage höchstens dreimal ausgeführt, mit jeweils zwei Sekunden Prozess-Timeout und 250 beziehungsweise 500 ms Abstand. Jeder Versuch liest die Prozessidentität erneut; nach erfolgreicher Unit-Prüfung wird sie nochmals geprüft. Eine lesbare, aber abweichende Unit-Identität wird sofort zurückgewiesen. Wiederholungen ersetzen keinen Besitzernachweis.

## Journal und Übernahme

Der echte ACP-Listener schreibt auch die bereits redigierten nativen Nachrichtenstücke vor deren Aggregation. Recorder-Mutationen, Nutzung, Sitzungsmeilensteine und das tatsächliche Turn-Ergebnis gehen in dasselbe monotone Journal. Jeder Eintrag besitzt Sequenz und Vorgänger-Digest. Serialisierte Inhalte bis einschließlich 4096 UTF-8-Bytes stehen direkt im Eintrag; größere Inhalte behalten ihre unveränderliche, synchronisierte Payload-Referenz aus dem Dateispeicher. Alte referenzbasierte Einträge bleiben lesbar. Erst nach Fsync von Inhalt, Index und Verzeichnis kann IPC den Eintrag liefern. Das Journal erfindet keine Providerantworten und bestätigt keinen fehlgeschlagenen Schreibvorgang.

Pages liest höchstens 200 kleine Indexeinträge pro Anfrage und prüft Sequenz, Digestkette und Payload-Prüfsumme. Unter einer gesperrten Importer-Zeile committen die öffentlichen Ereignisse einschließlich ihrer vorhandenen Datei-Chunks, Versuchszustand, Nutzung, Ergebnisreferenz, Wiederanbindungsmeilensteine und Importcursor zusammen in PostgreSQL. Die Session-Repositories können dafür der äußeren Importtransaktion beitreten. Dateiinhalte werden vor ihren Referenzen synchronisiert. Erst nach diesem Commit sendet Pages ACK; bei verlorenem ACK wird derselbe dauerhafte Cursor erneut bestätigt. Stabile Dedupe-Schlüssel bleiben zusätzlich erhalten; Nutzungswerte ersetzen den gleichen Turn, statt Tokens zu addieren. Ein unbekannter Commit-Ausgang wird aus der Datenbank zurückgelesen.

Nach einer dauerhaften Bestätigung entfernt eine Hintergrundbereinigung die Journal-Einträge bis zum ACK und ihre ausschließlich dort referenzierten Payload-Dateien in Portionen von höchstens 1000 Dateien. Datenbankreferenzen, insbesondere gespeicherte Turn-Ergebnisse, und noch unbestätigte Journalreferenzen schützen ihre Payloads. Eingebettete Turn-Ergebnisse erhalten beim Import eine eigene dauerhafte Ergebnisdatei. `ack.json` bleibt mit Sequenz und Digest als Kettenanker erhalten; Wiederanlauf und Folgeeinträge benötigen die gelöschten Dateien nicht. Start und ACK des Besitzers sowie Datenbankbereinigungen fordern einen zeitnahen Durchlauf an; zusätzlich läuft die Bereinigung einmal pro Minute, einschließlich vorhandener freigegebener Sitzungen. Die Journalbereinigung löscht keine Sitzungsordner; das bleibt am Löschen der Besitzerzeile gebunden.

Der öffentliche PageAgentCLI-Verlauf behält seine bestehenden Grenzen und API: 4000 Zeichen je Ereignis, 2000 jüngste Ereigniszeilen, begrenzte Seiten und die vollständigen vorhandenen Datei-Chunks. Native Rohstücke bleiben bis zur Bestätigung im privaten Owner-Journal. Die Web-Beobachtung liest externe Übernahmen für ihre bestehenden Verlauf-Abonnenten nach. Ein Close gilt erst nach bestätigtem nativem Cleanup und vollständig importiertem Abschlussjournal als erledigt. Die privaten Steuerdateien bleiben für Diagnose und eindeutige Zuordnung erhalten. Das Freigabedatum verhindert eine erneute Übernahme regulär pensionierter Besitzer.

## Neustart, Gruppen und Stop

Startup beweist lokale Besitzer **vor** GitHub-Schlüsselbereinigung, ACP-Lease-Recovery und Plan-Recovery. Nur bewiesene Besitzer behalten ihre bisherigen Ressourcen und Schlüssel. Unsichere Identitäten werden ausdrücklich protokolliert und quarantänisiert. Nicht dauerhafte Script-/Legacy-Arbeit eines gemischten Runs durchläuft weiterhin ihre eigene bestehende Cleanup-Prüfung. Bereits abgeschlossene Runs importieren einen ausstehenden Abschluss und pensionieren nur bewiesene Besitzer.

Die Pensionierung abgeschlossener lokaler Runs wartet beim Start insgesamt höchstens fünf Sekunden, unabhängig von der Anzahl ihrer Besitzer. Die voneinander unabhängigen Bereinigungen beginnen parallel; eine hängende Bereinigung läuft nach dem Ereignis `agent.local_owner.settlement_deferred` im Hintergrund weiter. Andere Recovery-Pfade übernehmen währenddessen weder dieselbe Anbindung noch deren Wartezeit. ACP-Kapazität und Arbeitskopien bleiben bis zum bestätigten Prozessende reserviert; der Start-Timeout ist kein Freigabenachweis. Ohne bestätigten Closeout bleiben Reservierungen erhalten.

Die Engine lädt den gespeicherten Snapshot, denselben Run und Versuch sowie private Branch-Zustände mit konsumierten Kanten und ausstehenden Ereignisprompts. Die Wiederanbindung sendet kein ACP-Initialize, Session-New oder ursprüngliches Prompt. Ein bereits abgeschlossenes natives Turn wird aus seiner dauerhaften Ergebnisreferenz ausgewertet. Gruppen, wiederverwendete Loop-Sitzungen und Ereignisagenten erhalten ihre ursprünglichen Holder und MCP-Slots zurück; ein laufender zusätzlicher Konsolen-Turn bleibt in der Engine als bereits disponierte Arbeit registriert. Neue Folge-Turns durchlaufen wieder aktuelle Rechte- und Konfigurationsprüfungen. Versiegelte Abschlussberichte bleiben für die Wiederholung der Auswertung erhalten.

Normaler Pages-Shutdown trennt Beobachter über Engine, Ressourcen-Wrapper und Session-Proxy, ohne diese nativen Besitzer oder deren ACP-Pipes zu schließen und ohne den Run als unterbrochen zu speichern. Ein expliziter Nutzer-Stop bleibt dagegen dauerhaft im Run gespeichert. Der Besitzer prüft diesen Zustand auch ohne HTTP-Verbindung und beendet seine eigene native Sitzung; IPC-Cancel schreibt zusätzlich eine dauerhafte Stop-Quittung. Nach einem Pages-Neustart bleibt der gespeicherte Stop wirksam. Besitzer werden erst nach geprüftem Cleanup und übernommener Historie freigegeben. Eigentumsfehler berechtigen niemals zum Beenden einer fremden Unit.

Der Besitzer prüft alle 250 ms auch die weitere Bindung an Run, Schritt, Versuch und Instanz, einschließlich Loop-Mitgliedern. Ein beendeter Run, ein fehlgeschlagener oder abgebrochener Versuch, ein ausgetauschter Versuch oder ein bereits abgeschlossener/fehlgeschlagener Closeout beendet die eigene native Arbeit über deren Abort- und Containment-Grenze. Vor Start und Folgeprompt gilt dieselbe Prüfung. Laufende, pausierende und pausierte Runs mit gültigem Versuch überleben weiterhin den Beobachter-Neustart; ein Datenbank-Lesefehler erfindet keinen Stop. Explizites Closeout bricht einen noch offenen Turn vor Datenbankzugriff und Journal-Drain ab. Die Erkennung eines inzwischen fehlgeschlagenen Versuchs erfolgt beim nächsten erfolgreichen Poll; die vorhandene Prozessbeendigung behält ihre begrenzte Eskalation.

Der vorzeitige Abschlussweg des früheren Befunds ist im Code nachvollziehbar: `LocalAttachedSession.readOnce` prüft auch beim Journal-Polling den Besitzer. Ein `plan_local_owner_unverified` verwirft den offenen Turn und trennt den Beobachter. Der Step-Runner versucht daraufhin Closeout, obwohl kein natives Turn-Ende vorliegt. Scheitert die Prüfung auch dort, entsteht `plan_closeout_failed`. Zuvor prüfte der unabhängige Besitzer nur einen fehlenden Run oder `stopRequested`, sodass ein als fehlgeschlagen gespeicherter Versuch weiterarbeiten konnte. Der synchrone Startup-Pfad `startAgents → settleFinished → bind/close → drain` wartete auf dessen Abschluss. Isolierte Funktionstests belegen diese Fehlergrenzen und die neuen Regeln; die konkrete erste auslösende Anfrage des Vorfalls und ein tatsächlicher systemd-Reexec wurden damit nicht nachträglich reproduziert. Änderungen an needrestart oder am Upgrade-Fenster bleiben eine Betriebsentscheidung.

## Kompatibilität und Grenzen

Migration `012_local_session_owners.sql` ist additiv: Owner-/Ergebnismetadaten, privater Engine-Dateiverweis und `closed_at` für versiegelte Schrittberichte. Ältere Datensätze ohne Besitzernachweis werden nicht nachträglich als dauerhafte Sitzungen ausgegeben. API-Requests, Pica-Chat/Login und lokale Scripts behalten ihre bisherigen Ausführungswege. Remote-Runner behalten unverändert ihre Authentifizierung, Bestätigungen und 45-Sekunden-Ausführungslease; das lokale IPC verwendet keine gelockerte Remote-Lease.

Vorausgesetzt sind Linux mit cgroup v2, ein erreichbarer systemd-Usermanager des Dienstkontos, dessen privates Laufzeitverzeichnis, PostgreSQL und gemeinsamer privater Dateispeicher. Produktionsbetrieb nutzt `build/local-owner/index.js`, die gemeinsamen `build/runtime-chunks/` und `local-agent.mjs`; der Quellmodus lädt den Owner über eine eigene Vite-Konfiguration ohne React-Router-Plugins. Die Rollen und Zeitschleifen sind in [PlanRuntimeFootprint.md](PlanRuntimeFootprint.md) beschrieben. Ein Host-Reboot, gestorbener Besitzer, beschädigtes Journal oder ausgetauschte Konfiguration wird nicht durch erneutes Senden eines Prompts kaschiert. MCP-Anfragen an den Webdienst können während dessen Ausfalls scheitern; der Besitzer ersetzt keine fachliche Werkzeugantwort.

Die Implementierung allein belegt keine Laufzeitabnahme. Erforderlich bleiben eine tatsächliche temporäre Produktinstanz und ein echter autorisierter lokaler Agent: gezielter harter HTTP-Prozessverlust bei weiterlebendem Agenten, Wiederanbindung und Erfolg desselben Versuchs, genau einmal übernommene echte Ereignisse sowie Stop über die authentifizierte Oberfläche. Ein credentialloser Startfehler oder eine nachgebildete ACP-Sitzung erfüllt das nicht. Zentrale QA muss außerdem die bestehenden Recovery-, Session-, Bericht- und Ressourcen-Doubles auf die additiven Verträge prüfen.

## Aktueller Testbestand

Die Backend-Suite findet `*.test.ts` und `*.spec.ts` unter
`backend/agents/local/`. Im aktuellen Quellbestand liegen dort keine
Testdateien. Die Tests für `PagesRuntime` und `RunsMode` ersetzen
`LocalSessionMode` durch ein Double. Die Tests für die Journalbereinigung
prüfen Speicherverhalten außerhalb des lokalen Session-Verzeichnisses. Die
früheren Unit-Tests für Beobachter, Owner-Start, Folgezug, Turn, Kontrolldateien,
Owner-Modus, Discovery, Öffnen und Wiederanbindung sind nur in der
Git-Historie unter `tests/backend/backend/agents/local/` vorhanden, etwa in
Revision `bcf4e75ccdc9c30c513becce5a2b0ec375362b57`.

### Ausführbare Module

Die Tabelle erfasst alle 27 ausführbaren Module relativ zu
`backend/agents/local/`. Für jede Zeile fehlen aktuelle Messwerte für
Statements, Branches, Functions und Lines. Ohne Instrumentierung bleibt auch
die Liste der ungetroffenen Zweige unbekannt. Der Quellbestand enthält keine
`.mjs`-Module und keine rein deklarativen Dateien. Insbesondere enthält
`LocalSessionContracts.ts` ausführbare Schemas und Validierungsfunktionen.
Gemessene Metriken mit 0/0 werden gemäß der Backend-Suite als `n/a` ausgewiesen.

| Modul                           | Verhalten und zu kontrollierende Grenze                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `LocalAcpJournalListener.ts`    | Native ACP-Stücke, Nutzung und Recorder-Aufrufe in Journal-Reihenfolge                                               |
| `LocalAttachedSession.ts`       | Wiederanbindung, Polling, Folgezug, Abbruch und bestätigtes Closeout über IPC, Importer und Timer                    |
| `LocalControlFailure.ts`        | Zulässige Fehlercodes und bereinigte Diagnosen                                                                       |
| `LocalDeferred.ts`              | Auflösung und Ablehnung eines aufgeschobenen Promise                                                                 |
| `LocalFinishedSessions.ts`      | Deduplizierte Parallelbereinigung mit begrenzter Wartezeit und injiziertem Cleanup                                   |
| `LocalJournalRecords.ts`        | Digest der beiden Datensatzformen und Lesen des dauerhaften Journalankers                                            |
| `LocalOwnerControl.ts`          | Registrierte Freigabe und Besitzabfrage über Callbacks                                                               |
| `LocalOwnerHttp.ts`             | Private Socket-Bindung, Capability, Anbindungstoken, Befehlsvalidierung und Antwortgrenzen über HTTP und Dateisystem |
| `LocalOwnerReady.ts`            | Bereitschaftsnachweis mit privater Datei, Dateiwächter und Timeout                                                   |
| `LocalOwnerRetirement.ts`       | Beendigung und Wiederholung bei temporären Fehlern über Uhr, Run-Abfrage und Cleanup                                 |
| `LocalOwnerRunAuthorization.ts` | Bindung an laufenden Run, Schritt, Versuch, Instanz und Closeout-Zustand                                             |
| `LocalOwnerSession.ts`          | Lebenszyklus, Folgezug, Pausieren, Abbruch und Closeout mit ACP-, Journal- und Persistenzgrenzen                     |
| `LocalSessionCompletion.ts`     | Gespeicherte Ergebnisse und Meilensteine aus Repository und Payload-Speicher                                         |
| `LocalSessionContracts.ts`      | Laufzeitvalidierung für Start, Besitzernachweis, Journal und IPC-Befehle                                             |
| `LocalSessionEndedOwner.ts`     | Freigabe erst nach bestätigtem Ende und erfolgreichem Cleanup                                                        |
| `LocalSessionFiles.ts`          | Private Dateirechte, begrenztes Lesen sowie atomare Veröffentlichung und Aufräumen bei Schreibfehlern                |
| `LocalSessionForcedRelease.ts`  | Trennung explizit ersetzter Runs über Freigabefunktion und Beobachter                                                |
| `LocalSessionIdentity.ts`       | Instanzschlüssel aus Schlüsselmaterial und Konfigurationspfad                                                        |
| `LocalSessionImport.ts`         | Journalreplay, transaktionale Übernahme, Cursor und Wiederaufnahme über Repository und Payload-Speicher              |
| `LocalSessionJournal.ts`        | Dauerhafte Digest-Kette, begrenzte Seiten, ACK und Wiederanlauf über Dateien und Payload-Speicher                    |
| `LocalSessionLaunch.ts`         | Start- und Turn-Verträge sowie Fallback auf Manifest und Checkpoints                                                 |
| `LocalSessionMode.ts`           | Einmalige Registrierung und Abfrage des prozesslokalen Owner-Modus                                                   |
| `LocalSessionOutbox.ts`         | Versuch, öffentliche Ereignisse und Nutzung als Journal-Mutationen                                                   |
| `LocalSessionOwnership.ts`      | Bindung an Startauftrag und Prozessidentität mit privaten Dateien, `/proc` und systemd                               |
| `LocalSessionTools.ts`          | Reservierung erforderlicher Tools und Abhängigkeiten über den Tool-Supervisor                                        |
| `LocalSessionTransport.ts`      | Authentifizierte, begrenzte Unix-IPC-Anfragen, Timeout und Fehlerabbildung                                           |
| `LocalSessions.ts`              | Auffinden, Wiederanbinden, Steuern und Freigeben früherer Besitzer über IPC, Repositories und Ressourcenverwaltung   |

### Vorhandene Messungen

Der vorhandene V8-Bericht vom 21. November 2026 um 00:34:57 (UTC+1) aus
einem lokalen Arbeitsbaum auf Basis von
`dd5650305f412e209f5d5558835629bf7fb4fbf4` enthält
`coverage-summary.json`, `coverage-final.json` und `scope-inventory.json`.
Er weist vollständige messbare Zähler für 138 Module der fünf bereits
konfigurierten Bereiche aus. Für `backend/error` enthält derselbe
Arbeitsbaum eine experimentelle Konfiguration und einen neuen Test. Deren
Artefakte weisen 2 vollständige und 42 unvollständige Module, 45
ungetroffene Zweigausgänge und einen fehlenden Modulmesswert
(`AgentAuthorizationError.ts`) aus. Der Bericht belegt diese Messung auf
dem älteren Arbeitsbaum. Auf dem aktuellen Stand fehlen Nachweise für
`backend/error`, Agent-Katalog, Agent-Runtime, Simulation, Agent-Provider
und lokale Sessions. Für die bereits konfigurierten Bereiche liegen keine
Messwerte zur aktuellen Revision vor.

### Patches und Betriebsprüfung

Unter `backend/agents/local/` liegen keine Patches. Die Daten für die
nativen Builds liegen separat in
`backend/agents/codex-patch/pages-tool-policy.patch`,
`backend/agents/opencode-patch/pages-pica.patch` und
`scripts/pica-native-build/opencode-offline.patch`. Diese Patchdateien
gehören nicht zur V8-Modulmessung. Zur Betriebsprüfung gehören die
Anwendbarkeit auf die festgelegten Upstream-Stände, die Verifikation des
fertigen Artefakts und die Prüfung des jeweiligen ACP-Verhaltens mit den
gepatchten Clients in einer isolierten Instanz. Die Build-Eingaben und die
Artefaktgrenzen stehen in der [Anleitung für native Builds](../scripts/pica-native-build/README.md).

Für lokale Sessions bleiben die Wiederanbindung nach Prozessverlust,
einmaliger Journal-Import sowie Abbruch und Ressourcenfreigabe mit einer
isolierten Instanz zu prüfen. Die Prüfung des Schreibpfads mit synthetischen
Dateien belegt ausschließlich dessen lokales Dateiverhalten.
