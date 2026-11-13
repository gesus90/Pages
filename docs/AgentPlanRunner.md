# Agent Plans, snapshots and runner events

[Documentation index](README.md). The current access and cloning contract is
[Cloning and teams](#klonen-und-teams-page-330-vertragsversion-18). Older
PAGE-118 descriptions below describe the legacy department default; explicit
`teams` grants and current owner/admin rules take precedence.

- [Plan editor and execution](#agent-plans)
- [Ticket parameters and assets](#ticket-parameters-and-assets-page-60)
- [Recovery](#restart-and-resume-after-a-disturbance-page-127)
- [Remote runner](PagesRunner.md)
- [Script runtime](../backend/service/agents/ScriptRuntime.md)
- [Runtime installation and adapters](AgentRuntime.md)

Agent Plan supports direct Bash, Python and Node.js script steps through configured
interpreter profiles. See the [script runtime contract](../backend/service/agents/ScriptRuntime.md)
for authorization, stdin/stdout, limits, parallel joins, pause/stop and recovery.
Its [three-review repair example](../backend/service/agents/ScriptRuntime.md#example-three-reviews-repair-recheck-and-finish)
shows explicit report bindings and a separate passing recheck gate.

## Plan snapshots and runner events (PAGE-142)

Lokale ACP-Planagenten verwenden ab PAGE-224 einen unabhängigen nativen Sitzungsbesitzer mit dauerhaftem Journal und Wiederanbindung desselben Runs/Versuchs. Normaler Pages-Shutdown trennt die Beobachtung; Nutzer-Stop bleibt wirksam. Eigentumsprüfung, Kompatibilität und Abnahmegrenzen stehen in [LocalAgentSessions.md](./LocalAgentSessions.md).

> Current control contract: [PAGE-184 / PAGE-185](./PAGE-184-185.md) documents
> Pages plan contract 13, Runner 1.15.0, business acceptance for every CLI,
> upper control actions, actual writer queues and logical workspace removal.
> The versioned historical sections below describe their original releases.

Planänderungen über Editor, MCP und Pica speichern ausschließlich eine neue Planrevision. Ein aktiver Run behält seine ursprüngliche Plan-/Node-Konfiguration. Nur die ausdrücklichen Aktionen Play und Resume dürfen Ausführung anfordern. Ein ausdrücklich fortgesetzter pausierter Run kann wie bisher eine neue, angehängte Ausführungsgrundlage übernehmen; die ursprüngliche Grundlage und erfolgreiche Checkpoints werden dabei nicht überschrieben.

## Snapshot und Anzeige

Vor dem Speichern eines Runs wird die vorbereitete Konfiguration nochmals strukturiert kopiert. `snapshot_json.execution` enthält Schema v1, Plan-ID, Run-ID, Planrevision und je Agent-/Script-Schritt eine initiale Versuchs-ID mit Schritt-ID. Das Modell, Reasoning, der Modellzugang und der Workspace werden als angeforderte Metadaten festgehalten. Die erste lokale Ausführung verwendet diese Versuchs-ID; weitere Versuche haben eigene IDs im vorhandenen Session-/Retry-Journal. Historische Runs ohne diese zusätzlichen Metadaten bleiben lesbar.

Ticket-Anhänge werden vor dem Start als private, nach SHA-256 deduplizierte Originalkopien im Datenverzeichnis unter `ticket-asset-snapshots/` gesichert (PAGE-331). Der private Snapshot enthält nur Dateinamen und Originalmetadaten, keine Binärinhalte oder Hostpfade. Weitere Versuche und Fortsetzungen derselben Ticket-Eingabe behalten diesen ersten Stand, auch wenn er leer war. Neue Anhänge werden nicht übergeben; geänderte oder entfernte Originale ersetzen die geprüften Kopien nicht. Eine Info-Zeile im Lauf-Log nennt die Abweichung, beispielsweise „1 Anhang kam nach dem Start dazu und ist nicht in diesem Lauf.“ Die aktuellen Ticketrechte bleiben erforderlich. Beschädigte, fehlende oder durch Symlinks ersetzte eigene Kopien führen weiterhin zu `parameter_ticket_changed`. Die privaten Originalkopien bleiben für Wiederaufnahmen erhalten; die bestätigte Prozessbereinigung entfernt nur die Workspace-Kopien. Historische Snapshots ohne gesicherte Kopien behalten ihre bisherige Prüfung.

Die Node-Konfiguration kann `executionTarget` enthalten: `{kind:"local"}` oder `{kind:"remote",workspaceId}`. Remote-Ziele stammen ausschließlich aus den registrierten Arbeitsbereichen, für die die Person Projektzugriff und die tatsächliche Abteilungsmitgliedschaft der SSH-Verbindung hat. Speichern prüft dies erneut, ohne SSH-Verbindung oder Verzeichnisprüfung auszulösen. Die Vorbereitung pinnt Workspace- und Verbindungsrevision, Namen und Pfad. Ein ausdrücklich gewähltes Remote-Ziel fällt niemals still auf lokale Ausführung zurück.

Die Referenzaggregation eines Laufs erhält das ursprüngliche Remote-Planziel und alle Remote-Arbeitsbereiche aus Knoten und Parametern. Damit prüft die Laufansicht deren aktuelle Rechte, und eine Pause vergleicht beim Fortsetzen den tatsächlichen Zielkontext statt einen fehlenden Zielwert.

Der Node-Dialog zeigt Ziel und Modellzugang, die Node-Karte kennzeichnet Remote. Laufdetails zeigen Plan-/Run-/Schritt-/Versuchs-ID, Revision, Ziel, Workspace, Modellzugang und Reasoning. Zugang bedeutet hier ausschließlich Verbindungs-ID, Name und Provider; weder SSH-Geheimnisse noch Provider-Schlüssel werden kopiert. Gemeldete effektive Session-Einstellungen bleiben von diesen angeforderten Einstellungen getrennt. Die obere Leiste zeigt Planname und Entwurfsrevision mit einer direkten Speichern-Aktion. Während eines aktiven Runs bleibt dessen Snapshot getrennt sichtbar; neue Revisionen gelten für den nächsten Run. Agent- und Script-Dialoge bearbeiten eine Kopie, die erst „In Plan übernehmen“ in den Entwurf schreibt. Abbrechen verwirft die Dialogänderungen. Zusätzliche Optionen bleiben aufklappbar. Revisionskonflikte behalten den Entwurf und zeigen einen Dialog mit Entwurfs- und gespeicherter Revision sowie der Möglichkeit zum Neuladen. Die Node-Karten nennen Host, Arbeitsbereich und beim Agent den Modellzugang. Scripts können ein eigenes registriertes Remote-Ziel auswählen; nur dessen Runner-Interpreter stehen dafür bereit.

Remote-Play verwendet seit der ausdrücklich freigegebenen Scope-Erweiterung in Lauf 6 den ausführenden Dispatcher von Runner 1.2.0. Start-Claim, Quellinhalt, Textparameter, Workspace-/SSH-Revision, Modellroute bzw. Binärdigest und Grenzen werden dauerhaft gebunden. Nicht bereite Remote-Ziele bleiben gesperrt. Die verfügbaren Betriebsarten und Grenzen beschreibt [PagesRunner.md](./PagesRunner.md#remote-pläne-scope-erweiterung-page-142).

## Ereignisübernahme

Das Protokoll aus PAGE-141 bleibt versioniert als v1. Ein Job kann eine von Pages autorisierte `plan`-Bindung tragen: `planId,runId,stepId,attemptId,planRevision`. `RunnerService.enqueue` akzeptiert diese Bindung ausschließlich für den privaten aktiven Run der berechtigten Person, passende Snapshot-Ziele und aktuelle Modell-/Remote-Rechte. Derselbe Versuch bekommt beim erneuten Einreihen dieselbe Job-ID. Einreihen speichert den vollständigen privaten Befehl vor der Auslieferung an den Runner.

Runner-Ereignisse müssen die gespeicherte Bindung unverändert mitführen. Terminale Planereignisse tragen `result:{output,stderr,closeout,exitCode,signal,reason}`, wobei `closeout` `confirmed`, `pending` oder `failed` ist. Ein erfolgreicher Abschluss benötigt bestätigtes Cleanup. Ausgabe wird vor der Run-Übernahme redigiert. Erfolgreiche Schritte erhalten einen unveränderlichen Checkpoint in der bestehenden Tabelle `agent_plan_checkpoints`; andere Zustände aktualisieren die vorhandene Run-Ansicht.

Migration `072_runner_plan_events.sql` ergänzt ausschließlich Ereignisbelege: Verbindung, Session, Sequenz, Ereignis-ID und kanonischen Digest. Ereignisbeleg, Run-Fortschritt, erfolgreicher Checkpoint und Runner-Checkpoint committen gemeinsam. Erst danach wird bestätigt. Auch ältere identische Ereignisse werden anhand ihres Belegs erneut bestätigt, ohne nochmals übernommen zu werden. Geänderte Payload bei gleicher ID, eine fremde Session, andere Bindung, ein falscher Versuch oder eine Sequenzlücke werden abgewiesen. Historische PAGE-141-Ereignisse ohne Digest erfordern Wiederabgleich.

Beim Wiederabgleich bleibt Pages maßgeblich; fehlende akzeptierte/laufende Jobs werden als `lost` abgeschlossen. Unbestätigtes Remote-Cleanup behält Workspace-Reservierungen. Startup-Recovery behandelt Remote-Runs nicht als lokale Prozesse. Ereignisübernahme und Wiederabgleich wiederholen keinen Launch. Noch nicht ausgelieferte Start-Claims behalten ihre ID; der Runner startet nur einen bislang nicht beanspruchten Claim. Die bestehende DAG-Engine disponiert nach dem bestätigten Ergebnis den nächsten Schritt.

## Parität zwischen Editor, Agentenwerkzeugen und Pica

Der gemeinsame Vertrag umfasst:

| Editor-Funktion                                                                                                | Agentenwerkzeug / natives Pica-Werkzeug                                                                                                     | Gemeinsame Prüfung                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pläne finden, lesen, Quellen und eigene Runs/Berichte                                                          | `list_plans`, `read_plan`, `read_plan_sources`, `list_plan_runs`, `read_plan_run`, `read_plan_run_reports`                                  | Sichtbarkeit, Ressourcen, private Runs                                                                       |
| Erstellen, Name/Freigabe/Workspace ändern, Nodes und Verbindungen bearbeiten                                   | `create_plan`, `update_plan`                                                                                                                | Planservice, Graph, Rechte, erwartete Revision, Operationsjournal                                            |
| Parameter anlegen/ändern/entfernen                                                                             | `create_plan_parameter`, `update_plan_parameter`, `remove_plan_parameter`                                                                   | derselbe Schreibpfad                                                                                         |
| Schleifen erstellen, konfigurieren, Mitglieder/Verbindungen/Previous-Bindungen ändern und auflösen             | gezielte `changes` in `create_plan`/`update_plan`                                                                                           | gemeinsame Editor-Funktionen und Graphprüfung                                                                |
| Vorlagen auflisten/lesen/speichern/einfügen; eigene Vorlagen ändern/löschen (ohne Editor-Oberfläche, PAGE-246) | `list_plan_templates`, `read_plan_template`, `save_plan_template`, `update_plan_template`, `delete_plan_template`, `changes.insertTemplate` | vorhandener Vorlagenservice, nur Eigentümer ändert/löscht, unabhängige Kopien                                |
| Löschen, Laufaktionen und Verfügbarkeit                                                                        | `delete_plan`, `play_plan`, `pause_plan`, `resume_plan`, `stop_plan`, `read_plan_control`                                                   | Eigentum bzw. eigene Runs, aktuelle Revision und Rechte                                                      |
| Remote-Ziel am Agent-Node                                                                                      | `updateNode.fields.executionTarget`                                                                                                         | sichtbarer registrierter Workspace im Planprojekt; ausführender Runner und passende Modellroute erforderlich |

Pica registriert diese Werkzeuge nativ im Pages-Backend. Die statischen Schemata und Beschreibungen kommen aus demselben Planwerkzeugkatalog; es wird kein MCP-Client, Serverprozess oder Transport gestartet. Die Aufrufe gehen über den vorhandenen `ChatToolExecutor` und denselben Planservice mit frischen Benutzerrechten. Pages setzt die Operations-ID; der Modellaufruf darf keine Identität vorgeben. Löschen folgt nur einer ausdrücklichen aktuellen Bitte der Person. Das vorhandene Aktionsbudget und die Sperre unverändert wiederholter fehlgeschlagener Schreibaufrufe bleiben wirksam.

Vorlagen ändern und löschen (`plans.templates.update`, `plans.templates.delete`, PAGE-246) gibt es für Agentenwerkzeuge, Pica und die Plan-API von Pages MCP; der Editor bietet dafür weiterhin keine Oberfläche. Plan und Vorlage werden nach ausdrücklicher aktueller Bitte der Person ohne Bestätigungswort gelöscht; Eigentum und gelesener Stand werden geprüft. Planänderungen, Vorlagenoperationen und reine Lesezugriffe starten keinen Run.

## Klonen und Teams (PAGE-330, Vertragsversion 18)

`clone_plan` und `POST /api/mcp/v1/plans/{planId}/clone` verwenden wie der
Klon-Dialog `AgentPlanCloning`. Die Quelle muss sichtbar sein. Kopiert wird
die aktuelle Revision; eine veraltete `expectedRevision` verhindert die Kopie
nicht. Ein leerer Name wird „Kopie von <Name>“, ein belegter Name bekommt eine
Zahl. Ist der Quellworkspace nicht nutzbar, wird der erste nutzbare Workspace
desselben Projekts gewählt; fehlt einer, lautet der Fehler `workspace_unavailable`.
Nicht nutzbare Agenten-, Modell- und Verbindungswahlen sowie nicht lesbare
Ticket-, Wiki- und Workspace-Verweise werden geleert. Alte Ticket-Flusskanten,
`git_closeout` und unbekannte alte Felder werden bereinigt. Zugangsdaten im
Quelltext bleiben ein Fehler (`credentials_in_text`).

Die Antwort enthält `adjustments` mit `workspace_replaced`, `name_suffixed`,
`source_revision_updated`, `legacy_form_cleaned` oder `reference_cleared` und,
wo zutreffend, der neuen `nodeId`. Diese Antwort wird mit der Kopie gespeichert
und bei einer Wiederholung derselben Operations-ID wiedergegeben. Im Editor
zeigen Text, Symbol und Rahmen offene Agenten- oder Modellwahlen an.

Klonen und `update_plan` nehmen optional `ownerId` und `teams` entgegen.
`ownerId` setzt nur ein aktiver Administrator. Teams enthalten höchstens 50
Einträge mit `kind`, `targetId`, `canRead`, `canEdit` und `canRun`. `kind` ist
`group`, `department` oder `user`. Eine Person muss aktiv sein und das Projekt
sehen dürfen; sie kann ausschließlich lesen. Änderungs- oder Startrechte für
eine Person werden mit `plan_user_team_read_only` abgelehnt. Der frühere
Werkzeug-Eingang `{kind, id, read?, edit?, run?}` bleibt lesbar. Ohne `teams`
bekommt die Kopie die normale Vorgabe des Anlegens. Die alte Freigabe
`usage`/`sharing` bleibt unverändert und wird nicht von der Quelle übernommen.

Zugriffs-, Klon- und Bearbeitendialog nutzen dieselbe Team-Suche, Team-Zeilen
und Besitzerwahl. Die kompakten Dialoge zeigen zunächst nur Name und „Weitere
Optionen“. Klonen bleibt verfügbar. Ein nur lesbarer Plan erklärt Besitzer
und fehlendes Änderungsrecht und bietet Klonen an. Nach erfolgreichem Klonen
öffnet die gespeicherte Kopie direkt; lokale ungespeicherte Änderungen der
Quelle werden dabei weder gespeichert noch übernommen. Ein Speichern von
Graph und Freigaben im Bearbeitendialog ist atomar; es zählt die Graphrevision
und, falls vorhanden, die gesonderte Zugriffsrevision samt Audit.

## Native Remote-CLI-Knoten (PAGE-151)

Runner 1.4.0 erweitert die bestehende Remote-Route um Codex und Claude Code. Nur Modelle aus dem authentifizierten CLI-Picker dieses Remote-Hosts sind auswählbar. Arbeitsverzeichnis, Werkzeug, Modell, Reasoning, Zugriffsstufe und Timeout stammen aus dem eingefrorenen Knoten. Ein neuer Knoten ist lesend; YOLO verlangt die ausdrückliche Wahl am Knoten. `workspace_write` bleibt entsprechend den lokalen ACP-Verträgen gesperrt. Lokale Ausführung bleibt unverändert.

Die Modellliste eines Knotens gehört zum Ziel: Sie entsteht aus dem Picker der Claude Code bzw. Codex CLI des Remote-Hosts und kann daher andere Versionen und Reasoning-Stufen nennen als die lokale CLI. Claude-Modelle tragen ihre Version im Namen (`Sonnet 5.5`) und zeigen die konkrete Modell-ID, die der Knoten speichert und als `--model` übergibt. Eine Stufe, die das Ziel nur für andere Modelle meldet, bleibt sichtbar, ist gesperrt und nennt das Modell als Grund. Wird das gespeicherte Modell oder die Stufe nicht mehr gemeldet, bleibt der Knoten unverändert, nennt den Grund und startet nicht.

Die neue Programmart ist eine native Einzelsitzung über den vorhandenen dauerhaften Runner-Job, keine interaktive ACP-Gruppensitzung. Finale Antworten enthalten Hostname und Remote-Pfad. Bereinigte Ergebnisse gehen über dieselben Resultatbindungen an Nachfolger. Bericht-/Todo-Diagnostik benutzt die vorhandenen Pages-Verträge. Pause wartet auf disponierte Knoten, Resume startet verbleibende Knoten neu; laufende native Sitzungen werden nicht eingefroren. Gruppen/Schleifen mit Remote-Ziel und Browser-MCP bleiben konkret gesperrt. Ab Runner 1.6.0 bietet der schrittgebundene Pages-Zugang auch Ticketänderungen entsprechend der Zugriffsstufe (PAGE-156).

Die bestehende Problemliste erhält Knotenbefunde für Werkzeug, Anmeldung, Katalog, Modellrevision, Runner-Verbindung, Identität, Workspace und Interpreter. Beim Plan-/Knotenzielwechsel blockiert ein lokales Script-Profil mit dem konkreten Interpreter-Hinweis, bis die Person ein Profil des Remote-Workspaces wählt. Die Modellauswahl erklärt auch leere Kataloge mit einem Link zur Synchronisation. Details und die getrennte GitHub-Schlüsselprüfung stehen in [PagesRunner.md](./PagesRunner.md#remote-cli-agenten-page-151-runner-140).

Ab Runner 1.7.0 kommt OpenCode als dritter Remote-Werkzeugweg hinzu (PAGE-154). Der Runner führt ihn über ACP aus, mit den auf dem Remote-Host eingerichteten Providern; die Modellliste des Knotens stammt aus dem OpenCode-Inventar des Hosts und durchläuft den globalen Modellfilter. Die geprüfte OpenCode-Version, der ACP-Vertragscheck anderer Versionen und die Meldung „Runner aktualisieren“ für ältere Runner beschreibt [PagesRunner.md](./PagesRunner.md#opencode-über-acp-page-154-runner-170).

Auch Remote-Fortsetzungen besitzen aktuelle Versuchsmetadaten im angehängten Snapshot. Bereits erfolgreiche Ergebnisse bleiben unverändert. Die Auswertung des CLI-Abschlussberichts erfolgt atomar mit dem Runner-Ereignis und dem unveränderlichen Erfolgscheckpoint; spätere Engine-Schreibvorgänge übernehmen diesen Remote-Session-Datensatz unverändert. Ein Stop vor dem dauerhaften Start-Claim wird als nicht gestartet abgebrochen.

## Remote-Ressourcen (PAGE-156)

Der private Snapshot eines Remote-Agent-Knotens enthält nun seine typisierten Parameter, autorisierte Ticket-/Wiki-Inhalte, Versionen, Remote-Workspace-Referenzen und Dateimetadaten mit Digest. Binärdateien und persönliche Zugangsdaten sind ausgeschlossen. Die öffentliche Ausführungsbasis enthält ausschließlich die gepinnten Ressourcenmetadaten. Übertragene Dateimetadaten sowie Werkzeug, Ziel und Ergebnis stehen im vorhandenen Run-JSON; eine neue Datenbankmigration ist dafür nicht erforderlich. Fortschrittsschreibvorgänge übernehmen dieses Pages-seitige Protokoll, statt es durch einen älteren Engine-Stand zu ersetzen.

Der Runner-Job trägt bei neuer CLI-Unterstützung `pagesAccess:1`. Flüchtige `pages-request`/`pages-result`-Nachrichten sind vom dauerhaften Job-/Ereignisjournal getrennt. Pages prüft Verbindung, Job, aktuelle Versuchs-ID, Run-/Schrittzustand und live Rechte, bevor es Dateien oder Werkzeugergebnisse überträgt. Die Session-Credential wird ausschließlich auf Pages ausgestellt, gehalten und widerrufen. Sie wird niemals an den Runner gesendet. Beendete, gestoppte oder abgelaufene Versuche können den Kanal nicht wiederverwenden.

Editor- und Startprüfungen nennen Knoten, Parameter und Ursache für nicht verfügbare Tickets, Wiki-Seiten, Workspace-Referenzen, Dateiübergabe und fehlende Runner-Fähigkeit. Die Übersetzungen liegen für Deutsch und Englisch vor. Ein Zielwechsel überschreibt keine Bindung und keinen Modellzugang. Ältere Runner bleiben für bestehende Textpläne nutzbar; Ressourcenparameter verlangen eine Aktualisierung auf 1.6.0. Details zu Dateiarten, Grenzen und Bereinigung stehen in [PagesRunner.md](./PagesRunner.md#ressourcenparameter-und-pages-zugang-page-156-runner-160).

## Beobachtung und Remote-Verlauf (PAGE-158)

Runner 1.8.0 ergänzt eine flüchtige, nach 30 Sekunden verfallende Plan-Beobachtung und bestätigte, begrenzte CLI-Verlaufspakete. Die Planansicht liest beim Öffnen sofort, danach bei einem aktiven Lauf alle 2 Sekunden und ohne aktiven Lauf alle 16 Sekunden; nach einer eigenen Aktion liest sie sofort neu. Ein verborgener Tab liest nicht, seine Beobachtung verfällt, und beim Zurückkehren öffnet die Ansicht sie mit einer sofortigen Abfrage neu (PAGE-206). Unveränderte autorisierte Antworten übertragen keinen Zustand (ETag/304). Ohne Planansicht gibt es keine Browser-Planabfragen. Der Runner prüft beobachtete Pläne alle 2 Sekunden, unbeobachtete aktive Jobs alle 15 Sekunden und leeren Betrieb alle 60 Sekunden; Heartbeats und die Offline-Grenze bleiben unverändert.

Der neue Verlauf wird im vorhandenen Sitzungsjournal atomar mit Ereignisbeleg und Runner-/Plan-Checkpoint gespeichert. Ein Fortschrittspaket enthält nur die Änderungen und verwendet den bereits dauerhaft gebundenen Ausführungsauftrag. Der eigene Verlaufscursor wächst strikt; Bestätigung und Wiederabgleich benutzen weiter die bisherige Ereignisfolge. Text, Werkzeuge und TODOs bleiben diagnostisch, die finale Antwort bleibt maßgeblich. Ältere Runner erhalten keine neue Nachricht und zeigen für Codex/Claude „Runner aktualisieren“. Größenlimits, Redigierung, Ereignisgrenze und Anzeige stehen in [PagesRunner.md](./PagesRunner.md#remote-live-verlauf-und-zuschauer-page-158-runner-180).

## Lange CLI-Läufe (PAGE-161)

Neue Remote-CLI-Knoten benötigen Runner 1.9.0 und dessen Chunk-Fähigkeit. Die private Rohhistory wird während des Laufs in 4-MiB-Chunks geschrieben; eine kumulative 32-MiB-Grenze gibt es nicht mehr. Native terminale Ergebnisse und bestätigter Closeout bleiben separat und erzeugen höchstens einen Erfolgscheckpoint. Der bestehende Ergebnisstring samt Remote-Herkunft bleibt für Parameterbindungen erhalten.

Die öffentliche Konsole hält 150 Ereignisse, lädt frühere Abschnitte über Sequenzcursor und streamt den erlaubten vollständigen Download aus dem Session-Journal. Alte Retention, fehlender Verlauf und konkrete Lesefehler werden angezeigt. Einzelereignis-, Ergebnis- und Dateisystemgrenzen sowie Upgrade und Recovery stehen in [PagesRunner.md](./PagesRunner.md#fortlaufende-ausgabe-und-getrenntes-ergebnis-page-161-runner-190). Eine History-Abfrage startet und rekonstruiert keinen Agenten.

## Remote-Kommunikation (PAGE-165)

Runner 1.10.0 ist für neue Remote-Starts erforderlich. Mehrere Remote-Läufe laufen unabhängig parallel, höchstens vier je Host-Konto; wartende Jobs nennen `capacity` oder `workspace`. Profile verschwinden bei Verbindungsproblemen nicht mehr, sondern zeigen ihren Zustand. Stop wird dauerhaft gespeichert, versuchsgebunden zugestellt und getrennt nach angefordert, empfangen und bestätigt angezeigt. Fristen, Zustände, Upgrade und Rollback beschreibt [PagesRunner.md](./PagesRunner.md#remote-kommunikation-parallele-läufe-und-stop-page-165-runner-1100).

## Decision, boolesches Ergebnis und Ereignis-Eingang (PAGE-174)

Die Node **Decision** verzweigt einen Plan anhand des booleschen Ergebnisses eines Agenten. Ein Agent mit verbundenem Ergebnis-Ausgang `passed-out` meldet `true`, wenn sein Abschlussbericht angenommen wurde, und `false`, wenn der Bericht gültig ist und nur nicht erfüllte Kriterien oder offene TODOs enthält. Fehlende, unlesbare oder widersprüchliche Berichte und technische Fehler bleiben Fehler des Agenten und werden nie zu `false`. Der Scheduler wertet die Decision selbst aus (kein Modell, kein Provider) und aktiviert genau einen der Ausgänge `true-out` oder `false-out`; der nicht gewählte Zweig und alles dahinter gilt als `skipped`.

Bei **jedem** Durchlauf liest die Decision das Ergebnis des zugehörigen Agentenstarts neu (`Quelle#Start`); ein früherer Wert, ein bereits gelesener Start oder eine verspätete Antwort einer älteren Runde wird nie als neues Ergebnis verwendet, ein fehlender Wert lässt die Decision mit `plan_decision_input_invalid` fehlschlagen. Der **Ereignis-Eingang** `event-in` eines Agenten startet einen bereits gelaufenen Agenten erneut: Das Textergebnis des Senders wird als Folge-Prompt in dieselbe offene ACP-Sitzung gesendet, nicht als erneute Hauptanweisung (`created`/`continued`/`recovered`; fehlt die Sitzung, startet eine neue und wird als `recovered` gekennzeichnet). Ein Sender ohne nutzbaren Text (`plan_event_prompt_empty`), mehr als 100000 Zeichen, mehr als 25 Starts je Knoten (`plan_activation_limit`) und nicht unterstützte Orte (Gruppen, Schleifen, Remote, Nicht-ACP-Runner, Tickets mit Completion-Gate) werden mit konkreten Gründen abgelehnt.

Vertrag, Randfälle, Pause/Fortsetzen, Persistenz und Grenzen stehen in [backend/service/agents/branching/README.md](../backend/service/agents/branching/README.md). Im Editor tragen die Ports eigene Farben und Beschriftungen (Bedingung/Boolean violett, `true` grün, `false` bernstein, Ereignis blau); eine Kante endet exakt auf der Mitte ihres Ports, auch nach Zoom und Größenänderung.

## Sequenzanzeige des Laufs (PAGE-177)

Die untere Lauffortschrittsanzeige nummeriert ausschließlich Ausführungen von Agents und Scripts. Start, Ende, Decision, Stack, Parameter sowie Loop- und Group-Container erhöhen den Zähler nicht; sie bestimmen nur Reihenfolge, Wiederholung und Auswahl. Jede Ausführung ist ein eigener Block: jeder Start eines Knotens (`activation`, frühere Starts aus `history`) und jedes Mitglied je Loop-Durchlauf (`run.loops[].iterations[].nodes`). Der Blockschlüssel ist `Knoten#Start` bzw. `Loop#Durchlauf/Mitglied` und damit derselbe, wenn ein geplanter Block später tatsächlich startet. Die Auswahl öffnet den Datensatz genau dieser Ausführung; ein früherer Start zeigt den in `history` gespeicherten Stand.

Die Projektion (`app/components/agents/plans/plan-step-sequence*.ts`) wird bei jedem Polling-Stand vollständig aus dem aktuellen Run-Datensatz und der ausgeführten Planrevision berechnet. Mehrfach zugestellte oder wiederholt gelesene Stände ergeben dieselben Blöcke. Verspätete Ergebnisse älterer Starts verwirft bereits der Scheduler (`isStaleStart`). Ein fortgesetzter Run (`origin.kind = "resume"`) übernimmt die bestätigten Ergebnisse und ergibt damit dieselbe Historie ohne Doppelblöcke. Ein Neustart ist ein eigener Run mit eigener Sequenz.

Tatsächlich gestartete Blöcke stehen zuerst, in Flussreihenfolge. Die Knoten eines Ereigniszyklus werden Runde für Runde verschränkt: Das Ziel des Ereignisses und alle Knoten seiner Region, die zum Sender führen, wiederholen sich je Runde. Danach folgen geplante (sichere) und angenommene (unsichere, schraffierte) Blöcke. Schätzungen verschieben deshalb nie die Nummer eines gestarteten Blocks. Regeln der Vorschau:

- Count-Loop mit bekannter Anzahl: alle Durchläufe geplant. Bei `max` mit aktiver Endbedingung ist nur der erste Durchlauf sicher, die übrigen sind Annahmen. Eine erst im Lauf bekannte Anzahl gilt bis dahin als ein angenommener Durchlauf.
- While-Loop: Nur der nächste Durchlauf nach dem letzten bekannten Check wird angenommen. Ein `false`-Check entfernt ihn, ein weiterer Durchlauf fügt den nächsten hinzu.
- Offene Decision: Der `true`-Zweig wird als Annahme fortgeschrieben, Knoten nur des `false`-Zweigs fehlen. Nach der Entscheidung zählt nur der gewählte Zweig; übersprungene Knoten verschwinden aus der Vorschau. Läuft oder lief der Sender eines Ereignisses in dieser Runde sicher, folgt die nächste Runde als Annahme.
- Ein beendeter Lauf zeigt keine Annahmen mehr; nicht erreichte geplante Knoten bleiben als nicht gestartet sichtbar.

Der Zähler zeigt die aktuelle Position und den Gesamtumfang, bei Annahmen als `3 / ca. 9`. Darunter steht getrennt die Zahl tatsächlich erfolgreich abgeschlossener Ausführungen. Wiederholungen tragen die Durchlaufnummer (`↻2`, im Namen „Durchlauf 2“).

## Ticket parameters and assets (PAGE-60)

Declare a single parameter of type `ticket`, for example `ticket` or `referenz`.
Its saved value stays `{ "type": "ticket", "ticketId": "…" }`; users do not
select an additional asset parameter. At execution, Pages resolves it to:

```ts
{
  id: "ticket-id",
  key: "PAGE-60",
  title: "Ticket title",
  description: "The complete, untrimmed ticket description",
  assets: [
    { source: "ticket", id: "attachment-id", link: "/aufgaben/attachments/attachment-id" }
  ],
  markdown: "# PAGE-60: Ticket title\n\nDescription and stored acceptance criteria",
  version: "opaque revision"
}
```

| Placeholder              | Instruction text                                                     | Separate file delivery |
| ------------------------ | -------------------------------------------------------------------- | ---------------------- |
| `{{ticket.description}}` | Exact complete description                                           | None                   |
| `{{ticket.assets}}`      | Asset references with parameter name, ticket ID and key              | All ticket assets      |
| `{{ticket}}`             | Compatible complete ticket text, including title and stored criteria | All ticket assets      |

The same syntax works with any declared ticket parameter name, such as
`{{referenz.description}}` and `{{referenz.assets}}`. Substitution happens only
once: placeholders inside a description or file are literal data. Repeated
placeholders do not duplicate the files within a parameter. Each delivered file
carries its parameter name, ticket ID/key, original reference and filename;
two parameters selecting the same ticket retain two distinct associations.
An empty asset list is valid and leaves the full description available.

Assets include every ticket attachment and used Markdown image/file references
to `/aufgaben/attachments/<id>`, `/wiki/attachments/<id>` and
`/agent-assets/<id>`, including reference-style Markdown links. As with Pages
wiki references, a server address or deployment prefix can precede these paths;
only the Pages identifier is resolved, never an external network resource.
Duplicate references are delivered once per parameter. Code examples do not
request files. External or relative PNG/TXT links and images must first be
uploaded to Pages; they fail explicitly instead of becoming filename-only input.
PNG images and complete UTF-8 text files are supported (including TXT uploaded
as `application/octet-stream`); other binary formats fail explicitly. A plan
step receives at most 64 files and 512 MiB (536,870,912 bytes) of unencoded
file contents in all (PAGE-292). The first 10 MiB are read into memory and
offered to the model as before; every further file is measured as a stream and
reaches the agent as an original file only, in a copy inside its workspace, so
memory and model content stay bounded. Files an agent downloads or returns keep
their own limit of 10 MiB. Exceeding a limit fails the run without truncating
or omitting a file.

Direct runs and Agent Plans share this resolution and delivery path.
OpenAI, OpenRouter, Anthropic and Google API agents receive native image blocks
and separate complete text blocks. Codex, Claude and OpenCode ACP sessions receive PNG
image blocks after the adapter advertises image support; text is an embedded
resource when supported, otherwise a complete separate text block. Standalone
text-only CLI requests do not support file delivery and report
`parameter_asset_transfer_unsupported` when files are selected. A model/provider that rejects image input fails the run;
Pages never silently falls back to metadata or another model.

For a following agent in a plan, bind the same ticket source to its ticket
parameter. Pages resolves that ticket again under the executing user's current
rights and retains the description, asset references and parameter association.
An agent result is text: a result-to-ticket connection is refused with the
explicit `ticketHandoff` graph finding. A text result derived from ticket assets
also requires those same tickets and asset lists to be bound to the receiving
agent; otherwise the runtime reports `parameter_asset_transfer_unsupported`.
Runtime-native subagent delegation is
outside Pages' structured handoff contract; it is not a way to obtain additional
Pages permissions or a guaranteed asset transfer.

Every file read uses its original ticket, wiki or staged-asset access policy.
Ticket selection and sharing never grant file rights. Plan snapshots contain
references, not file bytes or reusable download credentials. Immediately before
the API/ACP prompt, Pages rechecks the executor, ticket and each file. Changed
asset references between preparation and transmission require a new run. Text,
status and checkbox revisions alone do not invalidate the file handoff; ticket
and file authorization are still checked against current state. Missing,
deleted, inaccessible, unreadable, invalid-UTF-8 and oversized
files produce an explicit error; the prompt is not sent partially. Historical
run reads also reauthorize the original asset references, even after their
links have been removed from the ticket description.

## Agent Plans

Under **Agents → Agent Plan** (`/agents/plans`) the plan editor is one
[React Flow](https://reactflow.dev/) canvas over the whole content area beside
the global navigation, from the global header to the bottom of the window
(PAGE-102). It shows only the nodes, their connections and one compact zoom bar
at the top left: **−**, the current zoom in percent, **+** and **Fit all nodes**.
An expandable plan/run panel floats inside the editor, alongside the zoom bar
on wide canvases and below it on narrow ones (PAGE-106). It is independent of
the graph and its zoom. There are no permanent side/bottom panels or MiniMap;
the canvas has no frame and no scroll area of its own. The Pages background and its
dotted raster continue under the graph in the light/dark semantic palette; the
dots fade out towards the edges. Drag the empty area to pan; the wheel or pinch
gesture zooms. Fitting keeps the existing positions and leaves room for the zoom
bar. The initial fit runs when the graph opens; run-status updates keep the
viewport and selection, and the canvas follows window and sidebar resizing.

Without a `planId` in the address the editor opens the plan named **Task2**
among the plans you may read, your own one first. This is a provisional
default, not a stored setting, and nothing is created for it. A `planId` in the
address takes precedence. If the requested plan or Task2 is missing or not
readable, the canvas stays empty and says so; no other plan is opened instead.
The panel starts collapsed on every page opening; its state is not stored.
Its header shows project, workspace, server status and Play/Pause/Resume/Stop.
Expand it to choose a plan, rename it, select a project and one of its
workspaces, and explicitly save. Full context names stay available in the
expanded panel. Workspace administration uses the existing management page.
The existing Pica plan operations and their save paths remain: the owner and
the members and leaders of a plan's team (see Team plans and templates) save and run it.
Readers a plan is only shared with see control metadata without private run
outputs and cannot edit or run the plan.
Polling failures leave the editor and local draft mounted. Run actions remain
disabled until the server can be reached again; reconnect only reads state and
never resends a mutation. The panel's controls stay visible while its expanded
content scrolls.
The zoom bar sits directly below the panel in the same floating stack and
follows its expanded or collapsed height. The stack stays inside the editor
when the navigation or window changes size; pan and zoom move only the graph.

Move nodes, frames, starts and ends by their header or checkpoint symbol.
Canvas coordinates range from 0 to 6000 and are stored as whole numbers;
fractional pointer coordinates round to the nearest whole number, without
snapping to the dotted raster. Pan and zoom change the view, not the saved
coordinates. Names, instructions, parameters and supported run options are
edited directly on each agent node.

An ACP group is a yellow session container on the grid (PAGE-113), with no
flow, input, result or session ports. Agent connections determine execution;
the frame is never an additional executable step. The first member sets the
technical runner class: Codex, Claude Code or OpenCode over ACP. Other runner
classes and API agents are refused without reconfiguration. Empty groups remain
neutral drafts and may be saved, but cannot run.

Members keep their own ports and may connect to agents inside or outside any
frame. Moving an agent across a frame preserves its connections and bindings.
Only explicit flow edges add dependencies; the group's positions and membership
order add none. Simultaneously ready turns of the same group queue in the
scheduler's stored frontier order. Independent groups keep their own concurrency.
The common workspace of one group is protected by this serial turn queue.

A loop-boundary move is refused when it would discard flow connections, result
bindings or the loop's condition. Disconnect or unbind the affected items, or
clear the condition, before moving the member. Dissolving a group or loop keeps
its members and internal connections; connected frame edges, frame input aliases
and previous-iteration bindings must be repaired explicitly first. Pages does not
invent replacement flow connections. The editor and the agent tools apply the same rule.

The header shows the runner, a readable status and successful agent steps over
the known group membership of the selected run. Failures and blocked inputs
precede activity; unfinished groups reflect pause and stop controls. Failed or
cancelled steps never count as successful. Missing run membership or access
errors show an unknown total; an empty total paints no completed ring. The finite
DAG scheduler does not implement dynamic iterations.

When a recorded failed or cancelled predecessor prevents a node from running,
the run details name that predecessor. Older runs and branches without a proven
dependency may have no recorded source; Pages does not guess one.

The chevron collapses the frame into a compact card with a small ring and its
count beside it. This is local React state, initially open and reset by a new
visit/reload; it neither saves the plan nor controls execution. Hidden members
remain in the graph. External lines keep their original agent names and link
identities, ending at noninteractive visual anchors on the compact card. These
anchors are not group ports and cannot create new connections. Dense external
links have spaced labels naming the actual agents and short leader lines to
their noninteractive anchors; the frame stays compact. Expanding restores
the same member positions, internal/external edges and selection without moving
the viewport. Names remain available through focus and tooltips.

Older JSON plans are upgraded idempotently when read and before saving or run
preparation. A legacy frame edge is resolved only when exactly one entering or
leaving member exists. Otherwise the original edge remains and blocks execution;
the group editor offers an explicit agent endpoint choice. Legacy input aliases
become their actual member bindings/defaults; original boundary definitions stay
readable as provenance. No historical run snapshot is rewritten. The existing
JSON schema needs no SQL migration. Removing only a frame requires unresolved
legacy frame edges to be repaired first and keeps all member connections.

Every member must resolve to the same adapter, connection, model, reasoning,
workspace/directory, tools, permissions and sandbox; inherited defaults are
resolved first. Conflicts identify the agent and setting. The first member that
actually runs opens one ACP session per group and run. Subsequent members send
turn-scoped instructions through `AcpSession.next` and `session/prompt` to that
same session in the same process. The session is retained until every actual
member has succeeded, or run closeout/Stop ends it. This includes a later
frontier whose member depends on work outside the group. A failed
opening, missing continuation method, changed effective runtime or lost process
never permits a silent replacement session. Each turn reauthorizes access.

The footer's read-only ACP identifier belongs to the selected run and group;
without a real recorded identifier it says "not created yet". ACP identifiers
are not native thread IDs, process IDs or durable restart handles. After a
process exit or host restart, continuation of a lost retained session blocks rather
than opening an empty context. A deliberately new run gets a new session. Every
group turn still requires accepted business progress. Pause drains active work
and preserves retained sessions; Stop revokes access
and closes active or idle retained sessions. Credentialed provider continuation
must be verified separately for each installed runner version; a local dummy ACP
peer proves only Pages' protocol, queue and error handling.

The practical example can be reproduced with
`pnpm exec tsx scripts/agent-group-proof.ts --data <isolated credential data>
--connection <connection UUID> --workspace <empty workspace> --model <model ID>
--effort <effort> --output <artifact folder>`.
The script uses transient definitions and in-memory plan storage with the real
scheduler, parameter binding, acceptance and Codex adapter. It connects no Pages
plan bridge, changes no tickets, and records neither credentials nor account files.

A parameter node contains one name and one value: string, finite number or a
single valid JSON value, including an object or array. Invalid JSON is rejected
without creating fields from its properties. Numbers and JSON are passed as
text to the existing agent text parameters. Workspace and wiki references are
single values of their existing types and require matching input ports and
current resource access.

Drag from an **OUT** port to a compatible **IN** port, or click the OUT and
then the IN. While a connection is open, INs that accept it are marked green
and the others dashed; a release on the empty grid or Escape adds nothing:

- Solid **Flow OUT → Flow IN** edges control order. Agents have both ports;
  a **Start** has only OUT and an **End** only IN.
- Dashed **Data OUT → named Data IN** connections bind values directly to an
  agent parameter. Data alone never schedules a node.
- A ticket node is a value source, not a step: it has one **Ticket OUT** and no
  flow ports, and needs no Start. Connected to a ticket parameter, the agent
  receives the complete ticket as that parameter's value when the plan runs; a
  text parameter of an earlier plan still receives the ticket markdown. Plans
  that used tickets as flow checkpoints open with direct edges between the
  neighbours of those tickets. A ticket's status never changes implicitly.
- The ticket field of a ticket node opens a large choice below it (PAGE-109):
  search by key or title, a **Kanban phase** filter from the project's own
  workflow (menu and chips share one state; several phases combine with OR,
  the search with AND), and an order by title, creation or change time in
  either direction, newest change first by default. Opening it reads the
  project's visible, active tasks and subtasks again; archived, hidden and
  other projects' tickets never appear, also not in the count. Only choosing a
  row changes the node's ticket; arrows move, Enter chooses, Escape closes, and
  keys typed there never reach the canvas.
- A data IN accepts one source. Disconnect before rebinding. Wrong directions,
  unknown ports, incompatible types, duplicate connections and flow cycles
  are rejected. Predecessor-result connections are optional and require a flow
  path from the producing agent to the consuming agent. A flow edge alone
  passes no result: the result reaches an agent only through a declared text
  input bound to that result whose placeholder, such as `{{ergebnis}}`, its
  AGENT.md uses, once and as plain text. A bound result that AGENT.md does not
  use is marked unused and passes nothing. A placeholder without a source is
  refused before Play, named as ambiguous when several earlier agents could
  provide it; a result is never picked by itself.

Click a connection or its labelled chip, then use its **Disconnect** button to
remove it alone; both nodes stay.
Square flow handles and round data handles have larger pointer hit areas;
labelled port buttons offer the same validated connections from the keyboard.
Every connection is a soft Bezier curve, also its preview while it is drawn and
while nodes move: flow connections are solid, data connections dashed; both
have directional arrows, labels and visible selection. Invalid targets are
marked in the preview, and a refused IN chosen with the port buttons is named
below the zoom bar.
The node menu holds only **Delete** (PAGE-109): it removes the node together
with its own connections, never the referenced ticket, agent or run history.
Delete or Backspace removes the selected
node or connection while the grid or the selected node's header has focus, but
never while a field, menu or dialog has it.

An executable plan needs at least one usable agent, an explicit Start and a
reachable End. Every flow node must be reachable from a Start and lead to an
End; every required flow IN/OUT must be connected. Required agent inputs,
including a configured working directory, need connected, nonempty values.
Adding an agent node asks for a permitted connection/model pair and creates an
independent node configuration. Its working-directory input binds to the plan's
workspace. The pencil edits its name, instructions, typed parameters, run
options, model and reasoning level. Changing a model keeps instructions, inputs,
bindings and run options; unsupported options need an explicit correction.
Node templates remain optional independent copies, subject to current model
and resource rights at save and insertion. A withdrawn selection remains visible
and is refused at save and Play without a fallback. Inside an ACP group, models
of another runner stay listed but disabled; detach the node to select them.
In the node editor (PAGE-176) the execution target stands once above the
model choice. Pica, agent profiles, plan nodes, the palette, node cards and
page agents use this one choice with the same fixed measures (PAGE-248): 40 px
fields, 36 px rows and 20 × 20 provider tiles, with model and reasoning side by
side. Its panel starts with a search field and lists the target's models under
collapsible tools in a fixed order (Claude Code, Codex, Antigravity, OpenCode,
OpenRouter, Z.AI, then other API connections), each header naming the access
and model count. OpenRouter and Z.AI are tools of their own, visible with their
stored API key and still run through OpenCode; a model reachable through both
OpenCode and the direct API connection is listed once. Without an OpenCode key
OpenCode offers only its free models. Rows show the short catalog name without
a trailing "Free". A green Free badge marks only a model whose catalog states a
prompt and completion price of exactly zero for that very variant; a missing
price is never free. Only chat models are listed: text in, text out, no image,
video or audio output, and tool calls, as the stored catalog states them. No
catalog states a model's purpose, so the classification and moderation models
the ticket names (`openai/gpt-oss-safeguard-20b`, `meta-llama/llama-guard-4-12b`,
also under an OpenCode provider prefix) are left out by their exact ID; the
safeguard model states text in and out and tool calls like a chat model. A
saved assignment to a hidden model stays and shows as unavailable. The search
covers name, model ID, tool, access and source of every model, also in closed
tools, opens the tools with matches and restores the previous collapsed state
when cleared. Arrow keys move, Enter chooses or folds, Left/Right fold while
the search is empty, Escape closes the panel. The models come complete with
the page; the server keeps the catalogs current, a change appears with the
next page load, and the panel warns only after a failed catalog refresh. The
selection stores the listed model's full connection, route, model and
provider.
Double-clicking an
agent node opens its PageAgentCLI console instead: the fixed ticket panel over
the dimmed plan with the node's session history, workspace and Git state,
requested and confirmed model and reasoning, context occupancy, token and cache
counts, and an instruction field. Opening it starts no process and closing it
stops neither the session nor the run. A group asks which of its agent steps to
open, and runs other than the newest active one are read only. Template edits, including
edits during an active run, never change existing nodes. Inserting the same
template again uses its current defaults. Existing saved plans receive their
independent copies once at server startup, under their normal revision checks.
Earlier plans keep their values and bindings. They need explicit Start/End
nodes and connected required parameters before Play.

**Ctrl+S** (**Cmd+S** on macOS) saves the plan wherever the focus is in the
editor; nothing is saved automatically. A save persists the metadata,
positions, port references, connections and values. Incomplete drafts can be
saved; invalid connections cannot. Revision checks reject conflicting writes.
During a drag, the shortcut saves the current position in its current frame;
moving farther or dropping it into another frame is a new unsaved edit.
Navigation and tab closing warn about unsaved changes, and run polling does not
replace an edited draft. A stored plan is confirmed by a toast; a running save,
a refused save and a read-only plan are named in a short notice below the zoom
bar. An agent whose current template cannot be loaded is not inserted, and the
group dialog says so. Read-only access also disables React Flow
dragging and connection creation; selection, pan/zoom, the agent console and
the existing read-only node dialog stay available.

Deleting a plan removes it for everyone it is shared with. Only its owner may,
and the server refuses anyone else; the editor offers no delete action. A plan
with a running or paused run cannot be deleted; finished runs stay in the run
records of the agents.

**Play** in the panel requires an explicitly saved draft and always starts a
new run. The server also retains its combined save-and-play action: unsaved
changes of the owner are saved first, under
the same plan, as the next revision, and that revision is started; the new
revision and the run are stored together, so a refused save starts nothing and
a refused start leaves the plan unchanged and the edits in the editor. A plan
that changed elsewhere in the meantime is a conflict and is never replaced by
the older version. Every Play is a new run with its own ID and fresh node
states: results, errors and blocked nodes of earlier runs carry over neither
into the run nor into the parameters of its nodes, and earlier runs keep their
snapshot. During Run, Pausing, Paused and Stop closeout, Play is disabled
with a stop-first explanation. Concurrent starts are rejected for the entire
plan, and working-copy reservations also protect other plans. Solid branches run independently. Non-ACP execution has at most two
concurrent nodes across the service; native ACP starts share the separate global
resource queue described below. A join waits for every incoming predecessor to succeed; a
failed predecessor blocks its continuation. Independent CLI branches may not
write to the same working copy. Within one run, parallel ACP nodes in the
supported read-only mode may inspect the same copy. A direct script is treated
as a writer: order it after any other script or local CLI node that uses the
same resolved copy, so a review cannot observe a simultaneous write. The existing
reservation between separate runs remains exclusive, including read-only runs.
A server restart reconciles interrupted runs and their process state; a remote
job can outlive the Pages process. Working copies are released only after the
original attempt's cleanup is confirmed.

If a workspace conflict refuses Play before a run exists, Pages records the
requester's most recent refusal with its time, attempted revision, affected
authorized nodes and targets when known, and the reservation observation.
The panel labels this as past evidence separately from current Play availability.
A refused save-and-play does not save its draft; a remote registered path is
not presented as a proven canonical identity. Details are hidden if the
requester no longer has access to the target. `read_plan_control` exposes the
same personal refusal to agents. Stable preparation failures, including an
unavailable interpreter and bounded graph-validation findings, are also recorded.
The editor's older-entry action and `read_plan_control` with
`includeStartRejections: true` read one personal entry at a time; pass
`nextBefore` as `beforeRejectionId` for the next page. Entries retain
the attempted revision and remain historical after repair. Findings are limited
to 50; filtering is marked explicitly. Failures outside preparation are not
invented as pre-run history.

For a newly prepared remote run, the reservation also covers the registered
canonical path paired with its connection and, when available, its confirmed
SSH host key. This conservatively rejects matching aliases before dispatch;
the runner independently checks the actual path and coordinates workspaces
for runners of the same operating-system account. A shared host key is not
proof that two paths are the same physical filesystem, and reservations of
older runs may not include these additional keys. Different host identities,
accounts or filesystem namespaces need independent coordination.

The connection of an agent decides its runner: a Codex CLI or Claude Code
connection runs the node as an Agent Client Protocol (ACP) session through the
adapter of its CLI (`codex-acp` or `claude-agent-acp`, installed for the server
account next to the CLI, whose sign-in it reuses; see
[ACP adapters](AgentRuntime.md#acp-adapters-for-the-cli-runners)); an OpenCode connection starts
its native `opencode acp` session in the node's workspace, without an adapter
package or a fallback to `opencode run`; an API connection stays a request without tools. Play stores a stable snapshot of each node's effective
configuration. Before a node starts, Pages uses that snapshot and binds every
parameter (a placeholder is never sent unresolved) and fixes the node's **todo list** (task list items of the node
instruction and of the bound tickets' descriptions) and **acceptance criteria**
(the acceptance criteria of the bound tickets). Both are stored with the run and
appended to the prompt together with an optional progress report. Later template
or saved-node edits leave the run unchanged; current template usage, model grants
and referenced resource permissions are still checked before execution. The sent
prompt and requested model, reasoning and run options remain available in the run
record. The exact model, reasoning effort and the agent's run options (workspace access, shell,
web, time limit) are passed with fixed, verified switches; a combination a
runner cannot enforce, including the retired workspace-write mode of a CLI
agent, blocks the start. The ACP adapter must offer and confirm the stored model,
effort and mode before the prompt is sent, and an adapter that maps the model
to a choice of its own (Claude) is checked against the model it reports with
its first usage update; otherwise the node fails with its own reason, and
Pages never switches to another model, to an API connection or back to an
earlier runner. Every runner works unattended:
nothing waits for a person, and an action the options do not allow is refused
instead of asked.

A Codex CLI, Claude Code or OpenCode agent runs in exactly one of two permission modes,
chosen on the Agent Plan node. **Read only** reads the workspace and Pages content
and may search the web, but creates, changes and deletes no files, runs no
commands and calls only reading Pages tool operations; the server offers no
changing tool to it, and inside bubblewrap the workspace is mounted read-only.
For Claude Code the model gets no tool but Read, Glob, Grep, WebSearch and
WebFetch, so no file change and no command exists for it, and Pages answers
every remaining request itself. Codex reads files only through its shell,
which Read only switches off, so a Codex node in Read only works with Pages
content and the web; give it YOLO, or Claude Code, when it has to read the
workspace. **YOLO** gives the session every tool of the runner without
approval prompts: files in the workspace, shell, web and the full Pages tool
catalog with the executor's rights. It starts only inside the bubblewrap
isolation, which keeps the instance folders and the other credentials out of
reach. An agent without run options reads only; an agent saved with the earlier
workspace write mode does not start until one of the two modes is chosen, and
it never becomes YOLO on its own. A Codex configuration file Pages does not
manage (`config.toml` in the connection's Codex folder, or `.codex/config.toml`
of the workspace's project) blocks the start, because it could add servers or
providers the agent does not name. A Claude session ignores the user and
workspace settings of Claude Code (`settingSources` is empty), reaches only its
own Pages MCP server (the account's connectors and user MCP servers stay out),
keeps no session history and switches off the automatic model fallback.

Codex CLI, Claude Code and OpenCode YOLO plan nodes can use the GitHub connection stored
in the selected workspace's Pages project. Pages rechecks the executor's
workspace access and project management rights (the existing GitHub write
permission) before decrypting that project's token. The agent connection,
model, plan bindings and prompt contain no GitHub secret. Read only nodes do
not receive GitHub credentials. Switching project GitHub synchronization off
keeps the connection available for these explicitly authorized repository
operations; synchronization settings are independent of repository access.

Install `gh` for the server account and configure the repository URL and token
in the project's GitHub settings. Prefer a fine-grained token restricted on
GitHub to that repository, with **Contents: read and write** for branch pushes
and **Pull requests: read and write** when the task needs pull requests; grant
other permissions only as needed. Organization approval, SSO, repository rules
and token expiry still apply. Pages does not borrow `GH_TOKEN`, `GITHUB_TOKEN`,
the server's `gh` login or desktop keyring. Missing tokens, decryption failures,
missing `gh` or missing project write rights appear in the node's effective
`github` diagnostic, while unrelated YOLO work can continue. Configure the
connection and explicitly start a new run after correcting such a problem.
A Git command that needs GitHub also names the problem and this repair on its
error output: when the session has no credential, and when GitHub answers 401
for the stored token.

Before a session starts, Pages asks GitHub for the Git push advertisement of the
repository with the stored token, which changes nothing. The answer appears in
the `github` diagnostic and in `PAGES_GITHUB_ACCESS` inside the session. It only
describes the token: the token stays in place whatever GitHub answers, and Git's
own answer decides. A scheduled synchronization that gets a 401 also clears the
connected state of the integration, so the panel no longer shows a rejected
token as connected; saving a token and testing the connection sets it again. The
connection test reads the repository, so it does not prove push access.

`sh "$PAGES_GIT_PUBLISH" <branch>` is the publish command of a session with a
credential. It pushes HEAD to that branch of `origin` without force, repeats
only transport failures, at most three times, and prints `PUBLISHED` only after
reading the remote branch back and finding HEAD there. It never changes local
commits or branches, and repeating it after an interruption is safe. Pages tells
the agent to use it and to report anything else as not published, but does not
check that claim itself.

An operator can give one plan step a Git route over a host SSH identity, for a
repository whose project token cannot serve. There is no default: without a
complete entry in `config.toml` no session gets this route.

```toml
[[agentGitBridges]]
projectId = "<project>"
planId = "<plan>"
stepId = "<step>"
repository = "owner/name" # exactly the repository of the project's integration
sshAlias = "<Host of the server account's SSH configuration>"
pushRefs = ["refs/heads/main"] # empty or missing: fetching only
```

Pages reads the entry at start. It applies only to a local YOLO session of
exactly that step outside a group, while the executor manages the project. No
key, SSH configuration, home or agent socket enters the namespace. The session
gets a private socket and a small client that Git starts instead of `ssh`. The
Pages server decides each request before anything reaches its SSH client: only
this session's capability, destination `git@github.com`, that repository, and
`git-upload-pack` or, with `pushRefs`, `git-receive-pack`. It then runs a fixed
`ssh` call of the alias with strict host key checking, checks live access again
and relays protocol bytes. For a push it reads the update commands first and
forwards nothing unless each names a listed branch and none deletes one. The
alias must resolve to GitHub, or the session does not start. Ending the session
closes the socket. Each transfer is logged with its service, exit code and
updated branches.

**The route carries the write authority of that SSH identity.** A listed branch
can be force-pushed: whether an update is a fast-forward depends on objects the
bridge does not have, so protect the branch on GitHub. The agent decides what to
push, like any YOLO agent holding a credential.

Each ACP session gets a temporary `GH_CONFIG_DIR` outside its connection HOME,
with directory mode 0700 and file mode 0600. Only that directory is mounted
read-only into its namespace. A destination filter delegates HTTPS Git
credential responses to native `gh auth git-credential` only for the connected
repository, with or without `.git`. Matching SSH remote URLs are rewritten to
HTTPS for the process. Git settings travel through the environment and never
change the working copy's `.git/config`. Normal closeout and cancellation end
session processes before removing the directory; failed launches clean it up,
and startup recovery removes interrupted sessions' credential directories.
Each leftover directory is handled on its own. When Pages cannot confirm that
every process of its session ended, or cannot remove it, the directory stays,
the server log names it, the server starts normally and the next start tries
again. Until then the session keeps its ACP capacity and its run keeps the
working copy reserved. A file system without a creation time for the directory
cannot bound the process scan, so an unreadable process of the server account
then leaves the cleanup unconfirmed, unless the directory predates the last
boot.
Codex shells preserve the environment Pages has already allowlisted, including
`GIT_CONFIG_KEY_*`, without loading a user shell profile.

The destination filter and `GH_REPO` default are **not a restriction of the
token itself**. A YOLO process can read its own temporary token, invoke `gh`
with another repository or use the API directly, up to the token's native
GitHub permissions. Pages does not downscope a classic or otherwise broad
token. Use a token restricted by GitHub when repository isolation is required.
The handoff exposes only the selected project's token, never credentials of
another Pages project or connection.

Every Codex CLI, Claude Code or OpenCode plan node gets the Pages tools of its
step through the plan bridge, an HTTP MCP endpoint of Pages itself
(`/api/v1/plan-bridge`), with its own credential: in Read only with every
reading operation, in YOLO with every operation of the executor, both under the
executor's current rights. The session gets a random bearer of exactly this
step. The API process that serves the bridge holds it in memory only; it never
reaches the database, a manifest, a journal, a log, an argument list or an
environment. A local native owner receives it once over its private socket
and keeps it in memory, and the adapter gets it only in the `session/new`
request. Behind it stands the step credential, which Pages keeps as a hash for
the upload and attachment checks and whose clear text never leaves the API
process. The API admits a call only while the stored run runs (or is pausing) and a
step of the bearer's session (the members of a retained group share it) is
`running`, checked anew for every call; so the bearer is refused as soon as its
step has finished, failed, been cancelled, paused or recovered, even while other
steps of the run continue, and it is refused after every restart of the API
(a native session that survives the restart keeps running without Pages tools).
With `runsMode = "separate"` the engine asks the API for the bearer over the
private run API socket and receives the bearer only. The default address is
the loopback port of the process itself (`PAGES_AGENT_API_URL` overrides it); several API instances behind one shared
address are not supported, because each instance only knows its own bearers. This
internal bridge starts no separate MCP process. The paired-device API is a
separate access path, described below.

Every session node requires a regular runner turn and a clean, confirmed
closeout. **OpenCode nodes and all internal group members additionally
require business acceptance**: the closing `pages-report` must prove every todo and
criterion, with real evidence for criteria. A missing, invalid or incomplete
report fails these nodes and blocks successors. Read-only OpenCode nodes report
ticket todos because their credential cannot tick the checkboxes. YOLO ticket
todos must also be checked in Pages. Standalone Codex and Claude nodes retain
their existing diagnostic-only progress behavior. Runner failures, incomplete
turns, permission denials, timeouts, failed process exits, unavailable resources
and failed cleanup remain execution failures. A remote OpenCode command pins
its report contract and bound ticket requirements before dispatch. Pages checks
them again after confirmed runner closeout and before recording a successful
checkpoint. If the engine is lost or an older dispatched command has no pinned
contract, the result is retained for diagnosis and cannot release successors.
No manual acceptance step is added.

After an OpenCode or local session turn, Pages rereads the authorized ticket checklists in both report
scopes and reconciles current requirements with the original report IDs. New or
edited requirements receive new IDs, so earlier evidence cannot prove different
work. A bound todo normally follows its current ticket checkbox; read-only
OpenCode nodes instead need the completed todo in their report. Without a ticket
entry, the report supplies the status. Open, missing
and unknown work remains visible, including when the report is absent. Criteria
keep the reported assessment, evidence diagnostics and current ticket checkbox.
For standalone Codex and Claude nodes, execution success makes no claim that
all business work was completed. OpenCode acceptance checks the report and
current checklist; it cannot independently prove the truth of reported evidence. Agents
may tick completed items under the existing server-side rights and optimistic
revision checks; after a conflict they reread and reconcile the current list.
A failure to authorize or read the ticket leaves the assessment unavailable;
remote OpenCode fails the node without inventing a report verdict.

When a completed execution has an open or rejected recorded report, its node
and run progress use a warning instead of the success color. The details show
the recorded assessment, summary and reported issues. This display does not
change the stored process result or add a new execution gate.

The run view shows per node the runner, session mode, session and process
identity, times, actual process exit, closeout, requested and effective
configuration, diagnostic progress and a link to the original sent prompt. The
normalized **execution result** is `0` after regular completion and clean
closeout, and `-1` for technical failure or cancellation. Internal group turns
release the next step after regular turn completion, retaining the same native
session after accepted business progress; their process result remains pending
until its shared closeout. A
process crash is never inferred to be success from a favorable progress report.

The existing `completion` field selects only the progress scope: `report`
(default) describes todos and acceptance criteria; `todos` describes the current
todo list without criteria or synthetic defaults. Both scopes require an
accepted report for OpenCode and group members; other standalone nodes retain
diagnostic progress. In the todo scope, a writing agent moves the ticket to
in-progress, ticks completed todos live and moves it to review when all current
todos are done. Read only cannot change tickets. Legacy OpenCode workspace-write
settings require an explicit mode choice before a new run; saved model IDs and
historical results are not rewritten.

Run status distinguishes Running, Pausing, stable Paused, Stopping, Succeeded,
Failed and Cancelled. Blocked details explain validation failures and execution
errors. **Pause** closes the dispatch gate: queued work yields without starting,
while every dispatched branch and console turn drains. Only then is the full
stable-ID frontier persisted and editing enabled. Failures remain failures;
terminal End markers acknowledge completed work without a pointless Resume.
**Resume** reauthorizes the executor and prepares the saved plan revision.
It atomically checks the paused boundary and current draft revision, reserves
any additional writing copies, and appends an immutable continuation basis in
`agent_plan_continuations` (migration 060). The original snapshot, successful
step contracts, inputs and results remain unchanged. The panel distinguishes
unsaved edits, the saved draft revision and the adopted continuation revision.
Changed pending inputs and connections apply to the same run without replay.
Edits to already completed node configurations only affect a new Play run.
Deleting a required frontier node blocks Resume with a restart explanation;
changing dependencies of completed work also requires a restart. Existing
group sessions retain their runtime identity; incompatible changes are refused.
A paused run cannot move to another project or workspace through Resume.
**Stop** persists its irreversible request first, exposes closeout while owned
work settles, and releases reservations only after confirmed cleanup. An
unconfirmed closeout remains a visible failure and keeps its reservations.
Stopping never rolls back external changes. Reload preserves server state.
After a server interruption, unfinished runs are marked failed
rather than silently replaying work; processes and step credentials the
interrupted sessions left behind are ended at startup. These scans skip
unreadable processes of the server account that started before the run, such
as its service manager; a later unreadable process keeps the cleanup
unconfirmed. A new run is an explicit action. Historical runs that failed only
because of report or business findings retain their stored failure and blocked
successors. They are not rewritten or restarted. Resume applies only to an
active paused run and does not retry failed nodes; an ended historical run
requires an explicitly started new Play run, which uses the current
diagnostic-only completion rule.

Plans may be private, global, or shared with Pages groups and departments
using OR/AND membership. Global sharing still requires access to the plan's
project and workspace. Only the owner and the members and leaders of the plan's team may edit or start a run;
everyone else a plan is shared with only reads it. A department target of a share
matches members and leaders alike. Every executor needs their own
current agent/model and ticket/wiki permissions; sharing never delegates
credentials. Only the executor may read, pause, resume or stop their run, and
resource access is rechecked on the server before execution and disclosure.

### Team plans and templates (PAGE-118)

A person who is a member or the leader of exactly one department creates plans
and node templates for the team of that department. Leading a department
(`managed_departments`) counts like being a member (`department_members`) here
and only in the agent plan area: the union of both relations decides, each
department once, so someone who is member and leader of the same department
belongs to one department, while a member of one and leader of another belongs
to two. The department is stored with the object when it is created and is never
derived again from whoever saves it later. A person with no or several
departments creates objects without a team, which stay as private as before; no
department is guessed for them.

- **Access.** The members and leaders of the department who can also open the
  project of the plan read, change and run the same plan, and list and insert the same
  templates in the Templates tab (after a normal reload; there is no live
  co-editing). Both conditions are checked again on every server operation and
  for every access path: the plan page, the plan tools of agents and Pica. A project
  access alone, a membership or leadership alone, and an administrator role
  never count (an administrator who neither belongs to nor leads the department
  has no access to its plans; project access itself stays as the project rules
  define it, so a leader who is not a member of a department-bound project needs
  that access from elsewhere). The existing share of a plan with departments
  reads the same departments: a leader matches a department target without the
  `manage_users` capability that sharing an agent asks for. A revoked membership or leadership, a revoked project access or a
  deactivated account takes effect in an editor that is already open: its next
  save is refused. Templates stored before PAGE-118 have no team and stay
  personal.
- **Plans of before teams.** Migration 062 marks the plans that exist when it
  runs (`legacy_share_pending`; plans created later are never marked). Each
  server start decides the marked plans once with the rule that applies when a
  plan is created: an owner who now belongs (as member or leader) to exactly one department brings
  the plan into that department, and it is a normal team plan afterwards
  (owner, revision, content, runs and the recorded editor unchanged). An owner
  without a department keeps the plan marked, so a later start shares it once
  the owner has joined or leads one; an owner with several distinct departments keeps it private
  and the mark is dropped (no department is guessed), as does a name the
  department already uses in the project. Nothing is renamed, merged or deleted.
  Plans competing for one name in one department are decided by ascending plan
  ID, so the smallest ID wins; plan IDs are random and no creation time is
  stored, so this is only reproducible, not a judgement of age. A plan created
  after the migration is never shared retroactively. The step is idempotent and
  logs only counts; a failure never stops the server from starting.
- **Saving.** A save by another member raises the revision of the same plan; plan
  ID, owner, team and project stay. Every team member may also change the
  workspace of the plan to another workspace **of the same project** that the
  person may use (checked for the person who saves, never through the owner's
  access) and may change the usage and the share, with the same validation as
  the owner; a share only lets others read the plan, never change it. Moving
  the plan to a workspace of **another project** and deleting the plan stay with
  the owner: project and department form the shared area and the name space,
  so a move would shift who sees the plan and which names it collides with
  (`plan_project_owner_only`, HTTP 403). The plan page has no share editor, so
  the share is changed through the plan tools of agents and Pica; a save from the plan
  page carries the share unchanged. Runs, workspace reservations and the
  pause rules are unchanged: a paused run keeps its original workspace and
  cannot resume on a plan that was moved. The person who saved
  last is recorded (`updated_by`, `updated_at` of `agent_plans`) and not shown. A
  stale revision is a conflict that overwrites nothing and copies nothing; the
  editor offers to reload the plan and asks before it drops unsaved edits.
- **Names.** The name of a plan is compared trimmed, NFC-normalized and without
  case (`agentPlanNameKey`), by the plan page as an early warning, by the server
  and by a unique index on project, department and normalized name. Two plans of
  one team and project cannot share a name, whoever created them; a parallel
  creation or rename has exactly one winner, and the other gets a localized
  message at the name field (`plan_name_taken`) that names no plan, department or
  person. Nothing is renamed or numbered. Plans without a team are outside this
  rule, so existing duplicates stay as they are and cannot make the migration
  fail; a legacy plan whose name a team already uses stays without a team. Template
  names stay unique per owner, as before.
- **Credentials.** A team never lends access. Whoever saves or starts a plan needs
  their own current agent, model, ticket and wiki rights; there is no fallback to
  the creator or the last editor, and every run belongs to the person who
  started it.

### React Flow migration inventory and acceptance (PAGE-87)

Historical evidence from 2026-10-17, retained for traceability. The UI comparison,
SSR/hydration description and then-current permissions below are not the current
product contract: PAGE-235 uses a static app; current canvas behavior is above,
and current access/cloning is described at the start of this document.

The inventory below is from the domain definitions, editor, input readers,
repository, permission service and run views on the PAGE-86 base. It describes
the preserved contracts, not a claim that a live database roundtrip was run.

| Model or behavior      | Preserved contract                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start / End            | Stored IDs and coordinates; only Flow OUT / IN respectively; completed checkpoints turn green, other checkpoints stay neutral.                                                                                                                                                  |
| Agent                  | Independent configuration (name/revision, model grant, model, provider, reasoning, complete template and run options), personal assignment, instruction, completion scope and bindings.                                                                                         |
| Ticket                 | Task reference and live workflow badge; a value source with no flow ports; legacy ticket-to-text bindings remain supported.                                                                                                                                                     |
| Parameter              | Name, format (string/number/JSON), typed text/number/ticket/workspace/wiki value and data output.                                                                                                                                                                               |
| Variable               | Legacy named global text value and data output.                                                                                                                                                                                                                                 |
| Group                  | Name, position, ordered membership records, member-relative coordinates, explicit internal edges (or existing legacy-chain reading), retained legacy boundary metadata, direct member bindings and shared-session display.                                                      |
| Flow                   | Outer and internal edges remain separate; only same-level flow ports connect; duplicate edges and cycles are refused.                                                                                                                                                           |
| Data                   | Literal bindings stay in the model; source bindings refer directly to value nodes; legacy group aliases are resolved on read; result bindings retain predecessor/path requirements. Data never becomes a scheduling edge.                                                       |
| Editing                | Existing source filters, button/drag insertion, copied template defaults, movement, selection, node dialog, inspector, group assignment/removal choice, disconnect and node removal remain attached to domain actions. Double-click still opens the PAGE-86 node/group console. |
| Runs                   | Waiting/running/succeeded/failed/paused/cancelled, blocked/cancellation diagnostics, group sessions, historical runs, progress, console and run controls keep their existing meanings.                                                                                          |
| Access and persistence | Owner-only editing, executor-only run access, server authorization, optimistic revisions, Save/Play payloads, dirty-draft leave guard, in-flight edit preservation and run polling retain their existing implementations.                                                       |

`plan-flow-model.ts` is a one-way rendering projection, not a new save format.
It keeps references to Pages domain nodes and maps members to React Flow
`parentId` with the existing member-area offset. A committed move uses the
existing move/place actions; connection events use the existing domain validator
with an explicit source and target, avoiding a state-update race between
starting and completing a connection. Measurements, drag previews, selection
metadata, viewport and MiniMap state never enter the saved plan. Opening or
polling a plan performs no layout or replacement of pinned configurations.
No schema, backend execution, scheduler or authorization change is part
of this migration. Project/milestone diagram implementations remain unchanged.

Source comparison of the implemented interface (not screenshot evidence):

| Before PAGE-87                                                | After PAGE-87                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Custom transformed canvas, pointer gestures and SVG curves    | React Flow canvas, measured handles, native dragging, zoom/fit controls and MiniMap                                        |
| Floating configuration/source/run panels over a fading raster | Framed canvas with separate configuration, selection/source and run areas; collapsible narrow-screen panels                |
| Node title/type and custom port buttons                       | Symbol plus type/title hierarchy, semantic type border, existing run badge, 24px pointer handles and keyboard port buttons |
| Custom curves for both connection kinds                       | Solid flow curves, dashed data paths, direction markers, named chips and a connection inspector                            |
| Selection details inside the tab of the selected type         | One inspector above independently usable source tabs; explicit draft/save/read-only/loading feedback                       |

The superseded plan SVG renderer, line-action positioning, pointer/link/move
gesture hooks and viewport implementation are removed. Shared domain editing,
source dropping, geometry for group membership and the keyboard deletion guard
remain because they enforce Pages behavior rather than implement a parallel
canvas engine. React Flow 12.12.0 is pinned; its declared React/React DOM peers
accept the repository's React 19 versions. The library supports
[SSR](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration): the provider
receives the initial graph and nodes have initial dimensions; client hydration
measures their handles and draws the edges. The Pages static type gate checks
the integration against the installed types.
PAGE-87 used the free built-in components and attribution and linked the MIT
notice from canvas help; PAGE-102 replaced them with the zoom bar, hid the
attribution and keeps the notice with the source (see License).

Verification boundaries on 2026-10-17:

- Final static gates: `pnpm run check` exited **0** (React Router typegen,
  `tsc --noEmit`, `prettier --check .`); the subsequent
  `node --max-old-space-size=3072 node_modules/eslint/bin/eslint.js . --max-warnings=0`
  exited **0**. These results establish no runtime or visual acceptance.
- Only the required static `check` (route type generation, TypeScript and
  Prettier) and ESLint gates are run. Existing tests remain unchanged; no tests,
  coverage, harness, build, provider/model call or real agent execution is run.
- Read-only port inspection found existing listeners on both 3000 and 3100.
  Neither is started, stopped, replaced or used for mutations. The current
  task forbids server changes and test runs, and an existing 3100 listener is
  not evidence that it serves this implementation from an isolated snapshot.
- No database is opened/copied/migrated, no test-user credential is read, and
  no external service or original dataset is changed.
- TODO 1 (inventory), 2 (dependency/license) and 8 (old renderer removal and
  affected documentation) are implemented. TODO 3–6 have their code changes,
  but their live acceptance remains open: actual save/reload comparison of
  larger plans, all editing/connection/group actions, read-only gestures,
  conflict/in-flight-edit handling and status-update viewport stability.
- TODO 7 is **not performed**: login to a task-owned isolated copy, browser
  console inspection, Light/Dark and desktop/tablet/narrow visual inspection,
  keyboard/pointer checks and real before/after screenshots are outstanding.
  No screenshots or successful runtime/model execution are inferred from the
  source comparison or the static gates. Existing tests that describe details
  of the former renderer have neither been adapted nor executed in this task.

### Restart and resume after a disturbance (PAGE-127)

When the newest run of a plan failed or was stopped, its executor sees a
**Recover the run** section in the run panel: the state (recoverable,
interrupted by a server stop, failure not classified, stopped on purpose), the
failure point with its reason, the last verified checkpoint, the plan revision
the run executed and the one saved now, the origin of a run that came from an
earlier one, and every concrete blocker. Two separate actions follow:

- **Start from the start** creates a new run with a new identity from the
  saved revision shown on the button. The earlier run, its results,
  checkpoints and journal stay unchanged and link to the new run. Files and
  branches are not reset; the executor confirms that every node runs again,
  including actions that may already have taken effect.
- **Continue from the last safe state** creates a new run linked to the
  earlier one. Successful results whose checkpoint names the same output
  digest are taken over unchanged; nothing else counts as done. Only open,
  failed or interrupted work runs again, each as a new attempt with the saved
  revision, which must keep every completed node, its dependencies, its group
  and every started loop unchanged (`plan_completed_changed`). A script that
  was disabled and skipped in the earlier run must stay disabled: enabling it
  again refuses Continue and Resume with `plan_skipped_step_enabled` and its
  node ID, because running it now would invalidate the completed steps after
  it; only a new run with Play executes it. A loop keeps its
  completed iterations and the completed members of its unfinished iteration.
  Every node that had started — an agent session or a script process — needs
  the executor's explicit reviewed decision first (`review_required`); its
  prompt then begins with a recovery notice. **Continue the earlier agent
  session** is offered only where the adapter announced `session/resume`, the
  session ID is known and the profile keeps sessions on disk: Codex plan nodes,
  Claude Code plan nodes (private plan home, kept seven days after a failed run
  and moved to the recovery run) and Pica; loops start fresh sessions, so they
  offer **New attempt** only. A refused
  native resume fails the node visibly (`acp_session_resume_failed`); there is
  no silent fallback. A run stopped on purpose can also continue through this
  reviewed action; the stopped original stays unchanged. Only the newest run
  of a plan can be continued, once.

Before anything starts, current plan, agent, workspace, ticket and asset
rights are checked again and processes of the earlier run must be proven
gone: every session and script whose end was not confirmed is ended by its own
tag and unit, then its working copies and ACP leases are released; otherwise
the action fails with `cleanup_unconfirmed` and nothing starts. **Release**
does this alone. For an unconfirmed remote attempt it requests cleanup of the
original job even when the failed run was never stopped; retry the release
after the runner has confirmed closeout. The runner retains its working-copy
reservation while a worker is alive or a closeout is missing or failed.
A local script whose earlier cleanup failed is checked again by its original
instance tag; its private script resources are removed only after the process
has ended. The release journal records the decision without rewriting the
earlier run. A local agent or loop session whose closeout remains unconfirmed
can still block release; ask an administrator to investigate its processes
and resource cleanup. The recovery panel names recorded local sessions,
scripts, remote attempts and loops with unconfirmed closeout while a reservation
is held. A process scan alone does not prove that every temporary session
resource was cleaned up. A terminal status alone does not release an active engine.
A failed local cleanup or process scan names the affected node and reports a
fixed reason such as denied scan access, an unavailable scan, remaining
processes or a resource cleanup failure. The decision remains refused and can
be retried after the cause is addressed. The last bounded cleanup failure is
persisted with its time, original run/revision, known attempt and requested
action. The panel and the agent tools show it as historical even after release or a server
restart. A diagnostic-storage failure is reported separately and never claims
release. Only the latest recorded failure is exposed; this is not a paginated
process-scan history.
A server shutdown records running work as interrupted; nothing is resumed
automatically at startup.

Agents can read these decisions with `read_plan_run_recovery`,
request cleanup with `release_plan_run`, or explicitly request a new linked run
with `restart_plan_run` or `continue_plan_run`. Restart requires confirmation
that all steps can repeat; continuation requires the selected mode and reviewed
step IDs. These commands use the same recovery checks and never start a run as a
side effect of reading, saving or cleanup.
`read_plan_run_diagnostics` reads one authorized attempt with separate result,
stdout and stderr, recorded exit and closeout, and a completeness indication.
For remote scripts, stdout is retained even without a declared result port;
the runner's stderr is a bounded diagnostic tail and upstream filtering cannot
always be detected by Pages.
Long diagnostics are returned as snapshot-bound chunks; the operation does not
provide the complete session-event history or the checkpoint itself.
`read_plan_run_checkpoint` separately reads an authorized, filtered checkpoint
in snapshot-bound chunks, with the original stored digests.
`read_plan_run_session_events` separately reads retained session events using
the authorized plan/run/node/attempt key. It returns up to 32 events per page
(default 16), with exclusive `after`/`before` sequence bounds and optional
snapshot-bound text chunks. The run and diagnostic reads expose the current
attempt key; diagnostic retry summaries name prior recorded attempts. Reading
an earlier retry requires its stored journal and the original owner/run/node
binding. Missing journals are reported as unavailable, not reconstructed.
These reads do not offer native-session steering or replay.

Agent Plan retries known temporary provider failures up to ten times with
increasing delays. Technical ACP session failures get exactly three total
attempts, each at least ten seconds apart, and continue through the adapter's
native resume where it is confirmed. A new session is used only when no tool
activity could have changed external state; shared sessions without native
resume stay blocked as a concrete safety boundary. Writing remote jobs follow the
same contract through Runner 1.16.0 (`continuationVersion`), which reports the
native session and the proven tool activity; an older runner keeps them blocked
as `remote_evidence_missing`. Every stop before the budget is spent names its own
cause (`closeout_unconfirmed`, `resume_unavailable`, `session_not_kept`,
`remote_evidence_missing`, `effect_unknown`) apart from `exhausted`.
An exhausted quota with an explicit reset waits until one minute after that
reset; an unknown reset stays blocked. The run details and `read_plan_run`
retain the policy, attempts, cause, attempt count and scheduled time. Routing
never switches models. See the [plan retry contract](../backend/service/agents/PlanRetries.md).

`POST /agent-api/plan-runs/:runId/recovery` accepts the same actions with the
run's current recovery `revision` and an idempotency key:
`{"action":"restart","revision":4,"confirmRepeat":true}`,
`{"action":"resume","mode":"native_resume"|"new_session","reviewedStepIds":[…]}`
or `{"action":"release"}`. The decision is journaled in the transaction that
creates the new run; a repeated key returns the first result, an older
revision is refused, and a plan with an active run starts nothing second. The
answer names the new run (`runId`). `GET` on the same path returns the view
the panel shows.

### Plans in the Pica chat and for plan agents

Pica reaches the plans under the same rules as the plan page: list and read
visible plans with their nodes, connections and status (`idle`, `running` or
`paused`, latest run, and whether the plan could start), create plans, change
their structure (nodes, flow connections and agent inputs) and their parameter
nodes one by one, list one's own runs of a plan newest or oldest first in pages,
select the newest, the first or a named run, and read the reports of a run, each
tied to its run and node. Only the owner and the members and leaders of the plan's team
change a plan, its share and its workspace within the project (another project and deleting only the owner); a hidden plan answers
like a missing one, and runs stay private to the person who started them. Pica
finds a plan by name, asks back when several match, shows run dates and statuses
in plain words, and cannot start, stop or delete plans. The plan agents of a
running step reach the same tools through the plan bridge, narrowed to their
step.

### MCP access and internal bridges

The earlier removal of an external MCP server is historical. The current
repository implements a paired-device HTTP API under `/api/mcp/v1/`
(see [User management API](McpUserManagement.md) and
[Storage API](StorageApi.md#pages-mcp-api-page-299)).
The standalone MCP client lives outside this repository; its installation
and external-client compatibility were not verified in PAGE-332. Pica keeps
its job-token bridge, plan agents their step-bound bridge, and remote runners
their own pairing and channel.

The optional `listenAddress` and `publicUrl` in the TOML file name the
interface the server listens on and the origin users reach it at; Pica's
operator browser reads the origin as a Pages origin. Earlier files that name it
as `[mcpHttp].publicUrl` are still read and are rewritten as `publicUrl` when
Pages saves the file.
