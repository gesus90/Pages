# Pages-Dienste unter systemd

## Einrichtung

`deploy/pages.target` bündelt die tatsächlich implementierten Dienste der
Instanz `default`: API/UI (`server.mjs`), Planläufe (`pages-runs.mjs`), GitHub/FCM
(`pages-integrations.mjs`) und PostgreSQL. Es gibt keine zusätzliche SSR-Unit.
Der Rust-Dienst `pages-core` (PAGE-237, `deploy/core/pages-core@.service`, 256M)
hält auf Wunsch die Live-Streams; er kommt erst mit der Umstellung einer Instanz
hinzu ([deploy/core/README.md](../deploy/core/README.md)). Der unabhängige Beobachter ist ein kurzer Hilfsprozess mit
Timer; er benötigt weder eine erreichbare Datenbank noch einen laufenden
Anwendungsdienst. Backup- und Restore-Check-Timer unter `deploy/postgres/`
bleiben eigenständige Betriebsaufgaben.

Die Vorlagen richten keine Installation ein. Eine produktive Installation und
Aktivierung ist ein eigener Betriebsauftrag. Dafür vorgesehen sind:

1. Ein Betriebskonto `pages`, ein vollständig eingerichtetes PostgreSQL-Cluster
   und eine gesicherte Konfiguration `/etc/pages/default/config.toml` mit
   `firstRun = false`, erforderlicher `databaseUrl`,
   `runsMode = "separate"` und `integrationsMode = "separate"`. API und Worker
   verwenden dieselbe Konfiguration und denselben Datenordner. `databasePath`
   bezeichnet weiterhin den historischen Datenpfad; seine Eltern enthalten
   Payloads, Schlüssel, Sockets und `service-monitor/status.json`.
2. Den versionierten, zentral geprüften Build samt Abhängigkeiten und allen
   Einstiegsskripten unter `/opt/pages` bereitstellen. Die Units starten Node
   über `/usr/bin/env node`: Node >= 22.22 muss im Dienst-PATH liegen. Bei einer
   separaten Node-Installation den absoluten PATH ohne Login-Shell in
   `/etc/pages/default/runtime.env` hinterlegen (nur die benötigten
   Runtime-Variablen, keine Coding-/Provider-Anmeldedaten übernehmen).
   Pfade und Konto in den
   Vorlagen auf die Installation abstimmen. Konfigurations- und Datenordner
   gehören dem Betriebskonto und sind privat (0700, Dateien 0600).
3. Die bestehende PostgreSQL-Installation **entweder** weiterverwenden und die
   Abhängigkeiten auf deren Unit ändern **oder** die neue Vorlage
   `deploy/postgres/pages-postgres@.service` für das vorbereitete Cluster
   verwenden. Niemals zwei Postmaster auf dasselbe PGDATA starten. Die Vorlage
   erwartet PostgreSQL 18 unter `/usr/lib/postgresql/18/bin`, PGDATA unter
   `/var/lib/pages/default/postgres`, einen privaten Socketordner
   `/var/lib/pages/default/postgres-socket` und Port 5432. Der lokale
   Betriebskonto-Login muss `SELECT 1` in `postgres` ausführen dürfen. Es wird
   kein Cluster automatisch erzeugt und keine Anmeldung abgeschwächt. WAL- und
   Sicherungseinstellungen aus [PostgresMigration.md](PostgresMigration.md)
   und den bestehenden Backup-Vorlagen bleiben erhalten.
4. `deploy/pages.target`, die API- und Beobachtervorlagen sowie die bestehenden
   Vorlagen aus `deploy/runs/`, `deploy/integrations/` und die gewählte
   PostgreSQL-Unit in den passenden systemd-Unitpfad übernehmen. Alle Units mit
   `systemd-analyze verify` prüfen, den Manager neu laden und erst im getrennt
   freigegebenen Betriebsschritt `pages.target` aktivieren. Das Target startet
   PostgreSQL vor API/Migrationen und API vor den beiden Workern. `PartOf`
   überträgt Stop/Restart des Targets auf die Dienste und den Beobachter.
5. Die bestehenden Voraussetzungen für native Agent-User-Units und ihren
   privaten User-Bus beibehalten. [AgentWorkerMemory.md](AgentWorkerMemory.md)
   bleibt maßgeblich: `pages-acp.slice` und Agent-Units werden nicht verändert.

Für andere Instanznamen die `Wants`-/`After`-Liste des Targets entsprechend
ersetzen. Für einen isolierten Versuch im User-Manager werden ausschließlich
eigene Unitnamen und private Pfade verwendet: `User`/`Group` entfernen, die
Root-Sandboxoptionen an die User-Manager-Fähigkeiten anpassen und
`OOMScoreAdjust=0` setzen. Negative OOM-Werte benötigen die Rechte einer
System-Unit. Der Beobachter unterstützt dazu `--user` und eine explizite
`--units unit.service,...`-Liste. Kein Beispiel erfordert Änderungen an einem
laufenden fremden Dienst.

## Budgets und wirkliche Bereitschaft

Die festen Startbudgets stammen aus Zielarchitektur Revision 12 (22-GB-Server):

| Dienst             | MemoryMax      | V8-Heap  | OOMScoreAdjust |
| ------------------ | -------------- | -------- | -------------- |
| pages-api          | 1536M (1,5 GB) | 1024 MB  | -250           |
| pages-runs         | 1G             | 768 MB   | -250           |
| pages-integrations | 256M           | 160 MB   | -250           |
| PostgreSQL         | 3G             | entfällt | -250           |

Die kurze unabhängige Beobachtung hat zusätzlich 256M und einen 160-MB-V8-Heap.
Sie lädt dasselbe Server-Bundle wie `pages-integrations` und bekommt dessen
Budget; mit 64 MB und 128M brach sie mit V8- und danach cgroup-OOM ab.
Agenten behalten ihre bestehende höhere OOM-Priorität (+500). Alle vier
dauerhaften Dienste haben `Restart=always`, fünf Sekunden Neustartabstand,
`WatchdogSec=60` und begrenzte Start-/Stopzeiten. Die Startbegrenzung ist
ausgeschaltet, damit nach einer Ausfallserie weitere automatische
Wiederherstellungsversuche möglich bleiben.

Die API meldet erst Bereitschaft, wenn HTTP lauscht, die Anwendungsdienste
initialisiert sind und die echte DB-Abfrage erfolgreich war. Runs braucht seine
DB-Eigentümerschaft und erfolgreiche Inbox-/Engine-Durchläufe. Integrationen
braucht die gemeinsame Eigentümerschaft und erfolgreiche GitHub- und
FCM-Verbraucherdurchläufe. Ein leerer Queue-Poll zählt als Arbeit; bloße
Timeraktivität nicht. Nach 120 Sekunden ohne erfolgreichen Fortschritt wird
kein Watchdog mehr bedient. Auch eine neue DB-Abfrage muss jeweils gelingen.
Ein hängender Probeaufruf erzeugt keine weiteren Meldungen. Shutdown beendet
die Watchdogmeldungen bereits vor dem Drain.

PostgreSQL wird durch `deploy/postgres/run-postgres.sh` gestartet und nur nach
einem erfolgreichen, zeitlich begrenzten `SELECT 1` über seinen privaten Socket
bereitgemeldet und überwacht. Seine Kindprozesse liegen in derselben Unit.
`NotifyAccess=all` erlaubt den kurzlebigen `systemd-notify`-Hilfsprozess.
Die Watchdogs prüfen die lokale Arbeitsfähigkeit. Provider-Ausfälle werden
weiterhin durch vorhandene Zustände und Retries bearbeitet; ein nicht
konfigurierter FCM-Sender ist kein Grund für eine Neustartschleife. Eine
Provideranfrage oder ein Modellaufruf ist keine Voraussetzung dieser Probes.

## Warnung bei häufigen Neustarts

`pages-service-monitor@default.timer` liest ungefähr alle fünf Sekunden die
managerseitigen `NRestarts` aller vier Dienste. Die erste Beobachtung wird vor
PostgreSQL angefordert und setzt einen Ausgangszähler. Mehr als drei seitdem
beobachtete Neustarts in zehn Minuten hinterlassen eine Warnung im privaten
Statusspeicher. Sinkende Zähler nach einem Reset werden berücksichtigt. Zeiten
werden konservativ dem Beginn des jeweiligen Beobachtungsintervalls
zugeordnet; die Überwachung behauptet keine sekundengenaue Journalhistorie.
Bei einer erstmaligen Installation oder einer Beobachtungslücke über zehn
Minuten werden alte kumulative Zähler nicht als neue Ausfallserie ausgegeben.
Ein vollständiger Zählerreset zwischen zwei Beobachtungen kann Neustarts
verbergen; der Detektor ist eine laufende Überwachung, kein Journalarchiv.

Den aktuellen Zustand der Dienste unter `pages.target` liest `pages-core`
(PAGE-238) direkt aus dem systemd-Manager, unabhängig von der API
([deploy/core/README.md](../deploy/core/README.md)). Jede Seite zeigt unten
mittig eine Ampel, sobald nicht alle Dienste laufen, auch die Anmelde- und
Fehlerseite und nach einem Neuladen bei gestoppter API. Name, Zustand, letzter
Start und Neustarts je Dienst stehen unter **Einstellungen → System → Dienste**
und nur für Administratoren im Adminmodus; kann die API die Anmeldung nicht
bestätigen, bleibt dort nur die Ampel.

Unter **Einstellungen → System → Dienstneustarts** erscheinen die gespeicherten
Warnungen automatisch; die Anzeige fragt alle 15 Sekunden die geschützte API
`GET /settings-api/services` ab. Sie verlangt eine aktive Administratorrolle
im Adminmodus und setzt `Cache-Control: private, no-store`. Fällt die API selbst
aus, sammelt der Beobachter weiter; die Warnung erscheint nach ihrer Rückkehr.
Bei einem DB-Ausfall bleibt die Statusdatei erhalten. Ein fehlender, defekter
oder mehr als 30 Sekunden alter Beobachterstatus wird sichtbar als nicht
verfügbar/veraltet ausgewiesen. Warnungen bleiben auch nach der Erholung
erhalten. Nach Untersuchung kann der Betrieb den Beobachter-Timer stoppen,
seinen gerade laufenden Hilfsprozess auslaufen lassen und die Statusdatei
archivieren/entfernen; nach erneutem Start entsteht ein frischer Ausgangszähler.
Dateien nicht während einer laufenden Beobachtung bearbeiten.

## Update-Reihenfolge und Migrations-Koexistenz

1. Zustand, Warnungen, Konfiguration, Daten/Payloads und einen verifizierten
   PostgreSQL-Sicherungspunkt aufbewahren. Alte Release-Artefakte behalten.
2. Den neuen zentral geprüften Release in einem neuen Verzeichnis bereitstellen.
   PostgreSQL bleibt auf seiner kompatiblen Version; dessen Major-Upgrade ist
   ein eigener geplanter Betriebsschritt.
3. Neue API starten lassen, damit ausschließlich sie nummerierte Migrationen
   anwendet. Alte Worker können dabei noch laufen. Migrationen **müssen alte
   und neue Dienstversionen vorübergehend gemeinsam tragen**: zuerst additive
   Spalten/Tabellen, kompatible Defaults und lesbare bestehende Daten; Entfernen
   oder Umdeuten erst in einem späteren Release nach vollständiger Ablösung.
   Das gilt ebenso für persistierte Queue-Nachrichten, Payloads und die
   versionierten Socket-Protokolle. Ist Koexistenz nicht möglich, alle
   betroffenen Schreiber kontrolliert stoppen und eine explizite
   Wartungsumschaltung planen; keine inkompatible Migration im laufenden Mix.
4. Nach API-Bereitschaft und erfolgreicher Migration Runs kontrolliert drainen,
   stoppen und mit dem neuen Release starten; anschließend Integrationen
   ebenso ersetzen. Eigentümerschaftsschlösser dürfen keinen zweiten aktiven
   Verbraucher erlauben. Zeitweilig fehlende API-Bridges lassen persistierte
   Befehle stehen, statt eine zweite Ausführung zu starten.
5. Beobachter und Timer auf das neue Release umstellen, Statusdatei erhalten.
   Gesundheitsstatus, ausstehende Arbeit und Warnungen prüfen. Alte Artefakte
   erst nach Ende aller alten Prozesse und der Rückwegfrist entfernen.

## Rückweg

Bei einem kompatiblen additiven Update die betroffenen Dienste geordnet stoppen,
die vorherigen Releasepfade/Konfigurationen wieder einsetzen und in der
Reihenfolge PostgreSQL (falls gestoppt), API, Runs, Integrationen starten.
Die neue Datenbank bleibt erhalten; alte Binaries müssen deren Migrationsstand
ausdrücklich akzeptieren. Insbesondere lehnt Pages unbekannte Migrationen ab:
Kompatibilität darf nicht vermutet und die Migrationshistorie nicht gelöscht
oder umgeschrieben werden. Eine Rückkehr auf einen Build ohne Kenntnis einer
neuen Migration erfordert einen dafür vorbereiteten kompatiblen Build oder
den unten beschriebenen Restore mit ausdrücklicher Bewertung der Datenfolgen.

Bei inkompatiblen Schema-/Datenänderungen alle Schreiber und Worker stoppen und
den gesicherten PostgreSQL-Stand zusammen mit den zugehörigen Payloads und
Schlüsseln in eine eigene Zielinstanz wiederherstellen. Seit dem Sicherungspunkt
bestätigte Änderungen müssen erhalten und gezielt abgeglichen werden; ein
Restore ist kein verlustfreier automatischer Rollback. Erst nach fachlicher
Freigabe umschalten. Kein Rückweg nach DuckDB und kein unkontrolliertes
Rückwärtsausführen von Migrationen. Warnungen und fehlgeschlagene Zustände für
die Diagnose behalten.

Die ursprünglichen Betriebsgrenzen und Queue-Recovery-Regeln stehen in
[IntegrationsService.md](IntegrationsService.md),
[../deploy/runs/README.md](../deploy/runs/README.md) und
[PostgresMigration.md](PostgresMigration.md).
