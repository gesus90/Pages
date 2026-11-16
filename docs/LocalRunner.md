# Runner auf dem Pages-Server

Der lokale Runner verwendet denselben Einstiegspunkt und denselben Jobvertrag
wie Remote-Runner. Einstellungen → Agents zeigt ihn als „Dieser Server“ mit
Verbindungsstatus, Runner-Version, letztem Lebenszeichen und Werkzeuginventar.

## Installation und Update

Nach Bereitstellung des Pages-Codes unter `/opt/pages` richtet
`sudo bash /opt/pages/deploy/runner/install.sh <Instanz>` den Dienst
`pages-runner@<Instanz>.service` ein, aktiviert ihn für den Systemstart und
startet die API neu und einen noch nicht aktiven Runner. Bereits aktive Runner
erhalten neue Releases über den authentifizierten Updatevertrag; aktive Schritte
verschieben die Aktualisierung. Siehe [Runner-Updates](PagesRunner.md#adresse-und-sichere-runner-updates). Diese Provisionierung gehört zu Installation und
Update. Der bestehende Pages-Dienstbenutzer `pages` und die Verzeichnisse unter
`/etc/pages/<Instanz>` und `/var/lib/pages/<Instanz>` werden weiterverwendet.
Die API und der Runner müssen mit demselben Benutzer und denselben Pfaden
betrieben werden; angepasste Installationen passen die Units entsprechend an.

Das Setup läuft vor der API und vor dem Runner. Es erzeugt einmalig
`/var/lib/pages/<Instanz>/runner/config.json` im privaten Verzeichnis (0700),
mit zufälligem Runner-Token, Runner-ID und Session-ID. Die Datei hat Modus 0600. Wiederholungen erhalten Identität und Jobjournal; eine Portänderung
ändert ausschließlich den Endpunkt. Pages speichert nur den Token-Digest
in der bestehenden Runner-Tabelle. Eine abweichende Identität wird abgelehnt
und ersetzt keine vorhandenen Aufträge.

Die Adresse ist immer `ws://127.0.0.1:<port>/runner/v1/channel/…` mit dem
Subprotokoll `pages-runner.v1`. Pages prüft beim Upgrade die tatsächliche
Socket-Adresse, lehnt Forwarding-Header ab und verlangt weiterhin das Token.
Die lokale Verbindung muss direkt zur API gehen. Bei einer Aufteilung der
Dienste darf der lokale Kanal nicht über den Ingress oder Core umgeleitet
werden. Der Port stammt aus `/etc/pages/<Instanz>/config.toml`.

`Restart=always` stellt den Transport nach einem Absturz wieder her. Der
Installer aktiviert zusätzlich den dauerhaften Benutzer-Service-Manager von
`pages`. Die bestehenden pro Auftrag angelegten cgroup-v2-Scopes ermöglichen
Pause, Fortsetzen und Stop. Dafür sind wie beim Remote-Runner ein geeigneter
Linux-Kernel, systemd, Bubblewrap und die benötigten Werkzeuge erforderlich.
Die Dienst-Unit beendet beim Transportneustart nur den Runner-Hauptprozess;
die getrennten Worker bleiben bestehen.

## Einheitliche Plan-Ausführung

Neue Plan-Snapshots tragen `runnerProtocolVersion: 1`. Alle Agenten und
Skripte verwenden Runner: lokale CLI-Konten, API-Provider, Remote-Modelle,
Gruppen, wiederverwendete native Sitzungen, Schleifen und deren innere
Skripte, Modellentscheidungen und Swarms. Eine Umschalteinstellung oder ein
Fallback auf einen direkten lokalen Start existiert nicht mehr.

Die Engine verwaltet Graph, Reihenfolge, Bedingungen und fachliche Abnahme.
`RunnerPlanExecution` und `RunnerPlanScripts` schicken ausschließlich
persistierte Claims an den vorhandenen API-/Runner-Kanal. Der getrennte
Runs-Prozess benutzt hierfür denselben Vertrag über `RunApiClient`.

Jeder native Zug erhält einen eigenen Claim. Folgende Züge setzen die
bestätigte native Sitzungs-ID fort. Gruppen und wiederverwendete
Schleifen-Sitzungen behalten dadurch ihren Verlauf, obwohl der Worker eines
abgeschlossenen Zuges bereits aufgeräumt ist. Eine verweigerte native
Fortsetzung erzeugt einen Fehler und öffnet keine Ersatzunterhaltung.
Remote-Auswahl, Konto, Workspace, Modell und Berechtigungsmodus bleiben
gebunden. Dynamische Datei- und Gruppenbindungen werden pro Zug privat
festgehalten und bei jeder Übertragung erneut autorisiert.

API-Aufrufe verwenden die vorhandenen Provider-Payloads und Antwortleser.
Der HTTP-Aufruf läuft im Runner-Worker. Schlüssel werden über den
bestehenden authentifizierten Hilfskanal nur im Speicher geliefert; sie
stehen nicht im dauerhaften Jobauftrag. Große Payloads und Prompts werden
in begrenzten Hilfskanal-Paketen aus dem privaten Dateispeicher gelesen.
Native OpenCode-Konten behalten ihre verschlüsselte Schlüsselauflösung;
verknüpfte Provider behalten ihren ausgewählten Endpunkt. Der explizit
berechtigte Host-Modus liest seine Login-Umgebung innerhalb des lokalen
Runner-Workers.

Runner 1.21.0 liefert dafür auch die API- und Host-Umgebungs-Module im
Setup-Artefakt mit. Der Plantransport verlangt die explizite Fähigkeit
`managedExecutionVersion: 1`; ein älterer Runner startet keinen Ersatzpfad.

## Steuerung, Historie und Freigabe

Pause während eines Zuges und Fortsetzen verwenden `execution-pause` mit
passender Bestätigung des ursprünglichen Workers. Eine Bestätigung muss
zur aktuellen Anforderung gehören. Beendete Worker benötigen keine
weitere Suspendierung. Stop bleibt ein dauerhafter Auftrag und gibt
Ressourcen erst nach bestätigtem Cleanup frei. Prozessbeobachtung,
Ausführungsfristen, Hänger-Erkennung und Prozessbereinigung neuer Arbeit
liegen beim Runner. Ein Beobachter-Neustart beendet keinen Worker.

Ein verwalteter Worker schreibt unabhängig vom Modellfortschritt jede
Sekunde ein Lebenszeichen. Antwortet sein Supervisor länger als zwei
Minuten nicht mehr, übernimmt der Runner dessen bestätigte Bereinigung
und meldet den Claim als verloren. Eine bestätigte Pause ist ausgenommen;
nach dem Auftauen beginnt die Frist erneut. Lange Modellantworten mit
weiter reagierendem Supervisor bleiben zulässig, auch ohne Ausführungsfrist.

Native TODOs und Token gelangen in die bestehenden Versuchsjournale.
Folgezüge verwenden die vollständige Ereignisanzahl des vorherigen Zuges
als Sequenzbasis; ein neuer Versuch beginnt bei null. Codex-Bewertung und
Claude-Abrechnung nutzen weiterhin ihre vorhandenen Speicherwege. Swarms
bekommen native TODOs über ihren bestehenden Listener. Ein bestätigter
Prozessabschluss ersetzt keine fachliche Abnahme und verändert kein
bereits erfolgreich abgenommenes Schrittergebnis.

Migration `068_runner_job_archive.sql` archiviert bestätigte terminale Jobs
getrennt von der begrenzten aktiven Transportliste und erweitert die
Journal-Sequenzspalten auf `BIGINT`. Lange Schleifen erreichen dadurch
keine lebenslange Jobzahlgrenze. Wiederanbindung und Wiederholungen finden
den ursprünglichen Claim auch nach dessen Auslagerung. Private Outcomes
und terminale Auftragsinhalte werden nicht in Reconcile-Antworten kopiert.

Der transaktionale Claim repariert auch einen Neustart zwischen Dispatch
und Sitzungsbeobachtung. API-Anfragen werden dann wieder angebunden.
Neue Wiederholungsversuche erhalten dagegen einen neuen Claim. Bestätigte
Abschlussbelege können bei der Wiederherstellung nur voranschreiten;
eine veraltete Engine-Ansicht öffnet bestätigte Ressourcen nicht wieder.
Späte Abschlussbelege schließen auch gestoppte Läufe bei getrenntem
Scheduler automatisch ab, ohne deren fachliches Ergebnis zu verändern.

Workspace-Reservierungen bleiben bei ausstehendem Runner-Closeout erhalten,
auch bei Stop, Neustart und expliziter Recovery. Lokale Git-Helfer und
Binärübertragungen werden vor der dauerhaften Abschlussbestätigung
aufgeräumt. Eine ungültige Besitzerbindung darf kein Cleanup auslösen.

## Upgrade bestehender Läufe

Gespeicherte Formate, Journale, Berichte, TODOs und Token bleiben lesbar.
Die vorhandene `LocalSessions`-Anbindung dient nur noch dem Nachweis,
Wiederanbinden und Abschluss bereits existierender Besitzer. Sie startet
keine neue Unit. Auch der Skript-Kompatibilitätspfad folgt ausschließlich
einer vorhandenen Aufzeichnung.

Ein laufender Alt-Zug darf fertig werden. Vor einem weiteren Zug wird sein
Besitzer bestätigt geschlossen; danach setzt Runner dieselbe native
Sitzung unter einer frisch autorisierten Werkzeugfreigabe fort. Fehlt der
Abschlussnachweis, bleiben die Ressourcen reserviert. Ein verlorener
Skripteigner wird als unterbrochen behandelt und sein Skript nicht erneut
gestartet. Bereits gespeicherte Runner-Abschlussbelege werden beim
Wiederanlauf ausgewertet, ohne auf eine weitere Verbindung oder Meldung
zu warten. Noch nicht beanspruchte neue Ausführungsabsichten werden unter
der beendeten Dispatch-Sperre abgeschlossen.

Die alten Startskripte und der Owner-Einstieg werden nicht mehr erzeugt.
Der Build entfernt vorhandene Owner-Bundles und deren gemeinsame
Runtime-Chunks nicht während des Übergangs; bereits geladene Alt-Besitzer
behalten ihre Dateien. Der Upgrade-Pfad verlangt weder eine Beobachtungsfrist
noch einen bestätigten produktiven Drain.

Arbeitsbereiche und Reservierungen bleiben dieselben. Die Runner-Konten
werden aus dem bisherigen `data/agents/<Verbindungs-ID>/home` gelesen;
Codex, Claude Code, OpenCode und Antigravity verwenden die danebenliegenden
bisherigen Konfigurationsverzeichnisse. Es findet keine Anmeldung und kein
Kopieren oder Verschieben von Zugangsdaten statt. Vor dem Start prüft Pages
erneut Plan-, Modell-, Workspace- und Skriptfreigaben.

Der lokale Runner liest Konten, Anmeldestatus und die aktiven verwalteten
CLI-Versionen alle fünf Minuten erneut ein. „Werkzeuge aktualisieren“ in
seiner Zeile löst den Abgleich sofort aus. Neu eingerichtete Konten und
Werkzeugupdates benötigen dadurch keinen Dienstneustart. Bereits laufende
Aufträge behalten ihren Prozess und ihre gespeicherte Identität.

## Dauerhafte Chats

Chats und Unterhaltungen behalten ihren vorhandenen Sitzungspool und ihre
sitzungsgebundene Werkzeugbrücke. Ihr Lebenszyklus ist unabhängig von der
Plan-Ausführung.

## Gezielte Funktionsnachweise im Arbeitsbereich

Die folgenden direkten Aufrufe liefen am 16.11.2026 über
`node --import tsx --input-type=module` mit Eingaben über Standardeingabe.
Es wurden keine Prüfdateien oder Testinfrastruktur angelegt.

| Ablauf                                           | Praktischer Nachweis                                                                                                                                                                                        | Ergebnis und Grenze                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider, Gruppen und Skripte                    | `RunnerPlanExecution`, `AgentPlanGroupSessions`, `RunnerPlanScripts`: 17 Claims für sechs CLI-Adapter, fünf API-Provider, zwei Gruppenzüge, entfernten Agenten und äußeres, inneres sowie entferntes Skript | Schema-validierte Aufträge, gleiche native ID bei Gruppenzügen, Loop-Besitzer, Verbindungsautorisierung und Claude-Budgetprüfung; Transport und Modelle ersetzt                                                                             |
| Öffentlicher API-Schrittablauf                   | `AgentPlanStepRunner.run` → `RunnerPlanExecution` → Claim und Ergebnis, anschließend Wiederanbindung                                                                                                        | Erfolgreicher Datensatz mit gespeichertem Claim; nach Neustart kein zweiter Dispatch; Modell und Persistenz ersetzt                                                                                                                         |
| API-Worker                                       | `executeApiRequest` über einen temporären Unix-Socket zu `RunnerManagedAccess`, für fünf Provider                                                                                                           | Mehrteilige UTF-8-Payload, native Antwortleser, Schlüsselredaktion, Rate-Limit mit Reset, unerreichbare Gegenstelle und entzogene Planrechte; `fetch` ersetzt, keine Netzwerkanfrage                                                        |
| Steuerung und Alt-Züge                           | `RunnerManagedJobs`, `AgentPlanGroupSessions`, `drainLegacyPlanSession`, `recoverManagedRunnerRun` und `projectManagedRunnerJob`                                                                            | Freeze/Thaw-Bestätigungen, Stop mit Cleanup, Detach samt Gruppenweitergabe ohne Cancel, geordneter Übergang desselben Threads, Wiederherstellung ohne Reconnect und unveränderter fachlicher Erfolg; externe Grenzen ersetzt                |
| Archiv und Abschluss                             | 1005 nacheinander abgeschlossene Claims über `RunnerJobQueue`, dazu `RunnerRepository.checkpoint` und `checkpointRunnerMessage`                                                                             | Neun aktive Einträge, ursprünglicher ausgelagerter Claim wiedergefunden, Journalcursor im Archiv aktualisiert, Cleanup vor Checkpoint; falsche Bindung löst kein Cleanup aus; SQL-Transaktion und Transport ersetzt, keine Leistungsmessung |
| Wiederholungsversuche und Dispatch-Unterbrechung | Request-Pfad, `RunnerPlanScripts`, `restoreManagedRunnerClaims`, `mergeConfirmedRunnerJobs`                                                                                                                 | Wiederanbindung wird einmal verbraucht; neue Versuche verwenden neue Claims; innere Skripte erhalten ihren gespeicherten Claim zurück; alte Ansichten und fremde Belege öffnen keine Freigabe                                               |
| TODOs und Token                                  | `createLiveHistory` → `persistRunnerStructuredProgress`, dazu Claude-Ledger-Funktionen                                                                                                                      | TODO und Token unter ursprünglichem Versuch und richtigem Zug, Codex-Abrechnungsdaten erhalten, wiederholter Claude-Beleg ohne zusätzliche Token; SQL-Grenze ersetzt                                                                        |
| Dateien und Journalzüge                          | `RunnerManagedFiles`, `remoteGroupParameters`, `RunnerPlanSession`                                                                                                                                          | Eingefrorene Originalbytes und Digest, Zustellbeleg beim richtigen Versuch, Gruppenalias sowie kollisionsfreie Sequenzbasis und Reset beim neuen Versuch; Datei-/Repositoryzugriff ersetzt                                                  |
| Ausgelieferter Runner                            | 34 Laufzeitmodule aus den Setup-Platzhaltern in ein temporäres Verzeichnis übernommen; Ausführungsmodul geladen und Einstieg mit `--version` aufgerufen                                                     | Einstieg meldet 1.21.0 einschließlich API- und Umgebungs-Modulen; kein Setup, Dienststart oder Deployment ausgeführt                                                                                                                        |
| Supervisor und Skriptausgabe                     | `isWorkerStalled`, echtes temporäres Worker-Lebenszeichen, `prepareAgentHome`, `JobOutput`                                                                                                                  | Gesunder, hängender, eingefrorener und aufgetauter Zustand unterschieden; Kontenvorbereitung ohne Programmausführung; vertrauliches stderr führt zum Skriptfehler und zurückgehaltener Ausgabe; temporäre Dateien entfernt                  |

Zwölf Engine-, Runner-, Provider- und Import-Module wurden direkt geladen,
ohne Dienste zu starten. Die Quellpfade wurden vom Start über Claim,
Steuerung und Ergebnis bis zum Abschluss nachgelesen. Zusätzlich wurden
gefundene Fehler bei Wiederanbindung, Wiederholungen, Archivcursor,
Gruppen-Detach, Skriptfreigabe und Setup-Auslieferung korrigiert und die
betroffenen Pfade erneut direkt aufgerufen.

Nicht bestätigt sind echte Modellantworten, native Provider-Fortsetzungen,
produktive cgroup-Suspendierung, produktive Alt-Läufe, Remote-Maschinen und
eine PostgreSQL-Migrationsausführung. Diese Produktivprüfungen wurden nicht
durchgeführt und werden nicht als bestanden ausgewiesen. Dienste,
produktive Daten und Zugangsdaten wurden nicht verändert. Es erfolgte kein
Deployment und kein Push.

Lint, Check, Typecheck, Formatprüfung, Build, Testsuiten und Coverage:
**nicht ausgeführt (Vorgabe Igor)**.
