# Runner-Setup über das Arbeitsverzeichnis (PAGE-144)

Im Kontextmenü einer Remote-Verbindung (Agents → Arbeitsverzeichnis → Remote-Verbindungen → …) steht direkt unter „Konsole öffnen“ die Gruppe **Setup** mit der Zeile **Runner einrichten**. Ein Klick überträgt `pages_setup.sh`, prüft die Übertragung, macht die Datei für den Eigentümer ausführbar, öffnet das Konsolen-Fokuspanel und startet das Skript dort. Beim bloßen Verbinden wird nichts installiert.

Ist die Installation bestätigt, steht dieselbe Zeile an derselben Stelle deaktiviert als **Bereits installiert**. Läuft ein Setup für die Verbindung, heißt sie **Setup läuft**. Die Deaktivierung ist nur ein Hinweis: Der Server verweigert den Start auch ohne Menü (`remote_setup_installed`, `remote_setup_running`).

## Rechte, serverseitig bei jedem Schritt

Ein Setup braucht gleichzeitig:

1. Administrator im aktiven Admin-Modus (`remote_management_denied` sonst),
2. Mitgliedschaft in der Abteilung der Verbindung, wie jede Konsole (`remote_access_denied`), weil das Skript `sudo` auf dem Host verwendet und die Administratorrolle allein keine Shell öffnet,
3. einen bestätigten Hostschlüssel (`remote_host_key_unconfirmed`),
4. eine aktuelle, fehlerfreie Prüfung der Verbindung und eine seit mindestens fünf Sekunden stabile SSH-Sitzung. Das Setup öffnet die Sitzung selbst und wartet bis zur Stabilität (`remote_setup_unstable` sonst),
5. keine bestätigte Installation und keine bestehende Runner-Registrierung (`remote_setup_installed`, `remote_setup_registered`).

Start, Vorbereitung, Eingaben und der Ausgabestream prüfen die Rechte jeweils neu; entfällt eine Voraussetzung, endet die Sitzung. Pro Verbindung läuft höchstens ein Setup: Die Sperre und der neue Eintrag folgen ohne Wartepunkt aufeinander (`remote_setup_running`) und endet mit dem Setup. Auf dem Host schützt zusätzlich eine `flock`-Sperre auf dem Home-Verzeichnis vor einem zweiten Lauf desselben Kontos. Ein verlorener Transport startet das Skript nie erneut; erneut gestartet wird nur ein Setup, dessen Skript noch nie lief.

## Ablauf im Panel

Die Sequenz erscheint im selben Fokuspanel wie die Konsole (PAGE-143), mit Begrüßung, einer Leiste für acht Phasen und den Vorbereitungsschritten von Pages. Es gibt keine zweite Terminalarchitektur: Das Panel ist die Konsole, nur startet der PTY das Skript statt einer Login-Shell.

**Vorbereitung durch Pages (Phase 1):** Rechte → SSH-Sitzung → Übertragung (temporäre Datei, SHA-256, `bash -n`, atomisch verlinken; nur eine frühere Lieferung dieses Artefakts wird ersetzt) → Prüfsumme und Syntax erneut am Ziel → `chmod u=rwx,go=` (Modus genau 0700) → Konsole → Start. Ein fehlgeschlagener Schritt stoppt alle folgenden; dann wurde das Skript nie gestartet.

**Phasen des Skripts:**

| Phase            | Inhalt                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Vorprüfung     | Begrüßung, Terminal, kein root, Home, keine Symlinks, Sperre                                                                                                                                                                                                            |
| 2 System         | nur Ubuntu mit apt; **der Dienstmanager wird erkannt und mit Befund und Plan angezeigt**, bevor etwas geplant wird; fehlende Pakete werden vor jeder Änderung angezeigt; `sudo` nur für diese eine Aktion                                                               |
| 3 Werkzeuge      | Codex, Claude Code und OpenCode einzeln wählen; npm-Installation unter dem Benutzerverzeichnis                                                                                                                                                                          |
| 4 Anmeldung      | Erklärt die offiziellen CLI-Login-Befehle; die Person führt die Anmeldung getrennt auf dem Remote-Host aus. Das Setup startet keinen Login.                                                                                                                             |
| 5 Git und GitHub | Git-Identität (Commit-Name und -Adresse) getrennt vom GitHub-Login; dediziertes SSH-Schlüsselpaar, Hostschlüssel-Fingerabdruck wird vor der Übernahme bestätigt, Verifikation über `ssh -T`                                                                             |
| 6 Prüfung        | Versionen, Runner-Code installieren, **Weiter** vor der Dienstregistrierung                                                                                                                                                                                             |
| 7 Dienst         | je erkanntem Dienstmanager: systemd-Unit `pages-runner.service` (Boot-Start, `Restart=on-failure`), supervisord-Programm `pages-runner` (`autostart`, `autorestart`) oder ohne Dienstmanager nur ein Dauerbetrieb-Prozess; die Definition wird vor dem `sudo` angezeigt |
| 8 Kopplung       | Pages liefert Adresse und Freigabe verdeckt; Dienst über den erkannten Dienstmanager starten; Registrierung abwarten; Zustand aus der Abfrage des Dienstmanagers                                                                                                        |

### Dienstmanager

Das Skript setzt keinen Dienstmanager voraus. Phase 2 erkennt ihn in dieser Reihenfolge, zeigt das Ergebnis samt entscheidendem Merkmal an und leitet daraus den Plan ab:

1. **systemd:** PID 1 ist systemd oder `/run/systemd/system` existiert, und `systemctl is-system-running` antwortet mit einem Betriebszustand. Dann wie bisher die Unit `pages-runner.service` mit Boot-Start und Neustart bei Fehlern.
2. **supervisord:** PID 1 ist supervisord, oder `supervisorctl` ist vorhanden, antwortet auf `status` mit Statuszeilen (oder verweigert dem Benutzer nur die Abfrage, während ein supervisord-Prozess läuft). Dann das Programm `pages-runner` in einer Datei, die der laufende supervisord tatsächlich einliest: Pages ermittelt dessen Hauptkonfiguration (`-c` des Prozesses, sonst `/etc/supervisor/supervisord.conf` und `/etc/supervisord.conf`) und nimmt den ersten Eintrag aus `[include] files` mit einem vorhandenen Verzeichnis. Das Programm hat `autostart=true`, `autorestart=unexpected` und `exitcodes=0,78` (kein Neustart bei Exitstatus 78, wie `RestartPreventExitStatus=78` bei systemd) und läuft unter dem Konto des Benutzers, wenn supervisord als root läuft. Nach der Installation prüft `supervisorctl reread` und `avail`, ob supervisord das Programm übernimmt; sonst wird die Datei wieder entfernt. Die Hauptkonfiguration ändert das Setup nie.
3. **Kein unterstützter Dienstmanager** (auch ein supervisord, dessen Konfiguration oder Include-Verzeichnis nicht ermittelbar ist): Es wird keine Registrierung behauptet. Phase 7 meldet „kein Dienstmanager“ und bietet nur den **Dauerbetrieb-Prozess** an (`setsid`, Ausgabe nach `~/.config/pages-runner/runner.log`) ohne Start beim Systemstart. Neustarts sind ausdrücklich nicht abgedeckt: Nach einem Neustart des Rechners oder Containers und nach einem Absturz startet nichts den Runner wieder. Pages beendet dieses Setup als „teilweise“ (`noServiceManager`), nie als „bestätigt“.

Jeder Zweig lässt sich mit einem Befehl prüfen, der nichts ändert und kein Terminal braucht: `bash ~/pages_setup.sh --service-manager` auf dem Host zeigt Dienstmanager, entscheidendes Merkmal, Zustand laut Dienstmanager, Plan und die Schlüsselzeilen, die auch die Sonde liest. Die Erkennung steht einmal in `scripts/runner/service-manager.sh`; Setup-Artefakt und Sonde betten dieselbe Datei ein.

Registrierung, Autostart und Aktivität stammen aus der Abfrage des erkannten Dienstmanagers (`systemctl show`, `supervisorctl status`, die Prozessliste), nie aus dem Vorhandensein einer Datei. supervisord kennt keine Abfrage der Option `autostart`; sie wird aus dem Abschnitt `[program:pages-runner]` der eingelesenen Konfiguration gelesen, zählt aber nur, wenn supervisord das Programm selbst als registriert meldet.

Der Skriptabbruch durch die Person vor der Dienstregistrierung endet mit Exitstatus 10 (Ergebnis „teilweise“). Jeder andere Fehler stoppt mit der fehlgeschlagenen Phase.

Phasenmeldungen sind private Terminalsequenzen (`ESC ] 777 ; pages-setup ; …`), die nur gesendet werden, wenn Pages das Skript startet (`PAGES_SETUP_PROGRESS=1`). Sie sind reine Anzeige: Eine Phase beginnt erst, wenn alle früheren erledigt sind, eine beendete wird nie wieder geöffnet, nach einer fehlgeschlagenen wird nichts mehr angenommen. Ein gefälschtes Signal kann die Anzeige weder weiterschieben noch einen Fehler verbergen.

**„Fertig“ entscheidet nur Pages.** Nach Exitstatus 0 prüft der Server bis zu 60 Sekunden lang selbst: Runner auf dem Host und beim Dienstmanager registriert, Dienst aktiv, Autostart gesetzt, gespeicherte Kopplung und ein Runner, der sich innerhalb von 45 Sekunden gemeldet und seinen Executor angebunden hat. Fehlt eines davon, endet das Setup als „teilweise“ mit dem Grund; Phase 8 gilt dann als fehlgeschlagen. Ein grüner SSH-Status oder ein kopiertes Skript genügt nie.

### Kopplung

Phase 8 schaltet zuerst die Terminalausgabe der Eingabe ab (`stty -echo`) und meldet dann, dass sie wartet. Pages prüft die Rechte erneut, erzeugt die einmalige, zwei Minuten gültige Freigabe (`RunnerService.authorize`) und schreibt Adresse und Freigabe in den PTY. Sie erscheinen weder im Terminal noch im Wiederholungsverlauf, nicht in der Prozessliste und nicht in einem Protokoll. Die Freigabe gilt nur einmal und ist an Benutzer und SSH-Revision gebunden; es gibt keine feste, geteilte Passwortkonstante.

Die Adresse ist `PAGES_RUNNER_PUBLIC_URL` (nur Ursprung, optional) oder der Ursprung, unter dem die Person Pages geöffnet hat; `http` wird zu `ws`, `https` zu `wss`. Eine Loopback-Adresse (`localhost`, `127.*`) wird für einen anderen Host abgelehnt, weil dieser sie nicht erreicht; Pages liefert dann keine Freigabe.

## Installationsbefund

Nach jeder erfolgreichen SSH-Verbindung führt Pages eine nur lesende Sonde aus. Sie liest Dateien und fragt den erkannten Dienstmanager nur lesend ab (`systemctl show`, `supervisorctl status` oder die Prozessliste); Werkzeuge der Einrichtung startet sie nicht. Erfasst werden Betriebssystem, Architektur, der **Dienstmanager** (`systemd`, `supervisord`, `none`), ob er die Abfrage beantwortet hat, Runner-Code und seine Version, Registrierung, Autostart und Aktivität des Dienstes laut Dienstmanager sowie die Werkzeuge im Werkzeugpräfix. Werkzeugversionen stammen aus deren Paketdateien. Beantwortet der Dienstmanager die Abfrage des Benutzers nicht (zum Beispiel ein supervisord-Socket nur für root), gelten Registrierung, Autostart und Aktivität als nicht bestätigt, nicht als „nicht installiert“. Ein Befund aus der Zeit vor der Erkennung hat keinen Dienstmanager und wird mit der nächsten Prüfung ersetzt. Das Ergebnis wird als strukturierter Befund (`remote_install_findings`) gespeichert, gebunden an **Host, Port, Benutzer und Fingerabdruck des Hostschlüssels**. Ändert sich eines davon, gilt der Befund nicht mehr (Zustand „unbekannt“, nicht „nicht installiert“); das Löschen der Verbindung löscht ihn.

Zustände: `unknown`, `not_installed`, `running` (ein Setup hält die Verbindung), `partial`, `confirmed`. Installiert, aktiv, Autostart, gekoppelt und bereit sind getrennte Angaben; gekoppelt und bereit kommen aus Pages selbst. `confirmed` verlangt den Runner mit Registrierung beim Dienstmanager, aktiven und aktivierten Dienst und die Kopplung; ohne Dienstmanager ist das nie erfüllt; „bereit“ gehört nicht dazu, damit ein kurz offline Runner das Menü nicht wieder freigibt.

## Dauerhafte ausgehende Verbindung

Der Runner ab Version 1.4.0 verwendet das bestehende Protokoll v1 und hält die ausgehende WS/WSS-Verbindung dauerhaft:

- Heartbeat alle 15 Sekunden, Abbruch nach 45 Sekunden ohne Nachricht von Pages.
- Wiederverbindung mit exponentiellem Backoff bis höchstens 60 Sekunden plus Jitter, ohne Obergrenze der Versuche. Ein erfolgreicher Zustandsabgleich setzt den Backoff zurück; vor jeder weiteren Nachricht steht der Abgleich (`reconcile`), Pages bleibt maßgeblich.
- Authentifizierung mit dem dauerhaften Maschinen-Token; ein abgelehnter Handshake ist für den Client nicht von einem Netzausfall zu unterscheiden und wird mit Backoff weiter versucht.
- Pages verweigert Runner ohne gültige Freigabe oder Token mit 401 und meldet das höchstens alle 30 Sekunden als `runner.channel.rejected`.
- Der Runner erkennt eine **unberechtigte Gegenstelle**: Nennt Pages eine andere Verbindung, Runner-Identität oder Sitzung, oder ein anderes Protokoll, endet er mit Status 78. `RestartPreventExitStatus=78` (systemd) beziehungsweise `exitcodes=0,78` (supervisord) verhindert den Neustart, ebenso bei ungültiger Konfiguration. Ohne Kopplungsdaten und ohne Terminal startet er nicht.
- Es gibt keinen neuen öffentlichen Steuerport.

## Inventar, Modell-Fähigkeiten und Nutzung

Angezeigt wird nur, was Werkzeug oder Adapter tatsächlich liefern. **Unbekannt bleibt unbekannt, nie 0.**

- Der Runner meldet beim Abgleich die gefundenen Werkzeuge (`--version`). Fehlt die Versionsangabe, zeigt Einstellungen → Agents „Version unbekannt“. Meldet ein Runner (vor 1.3.0) kein Inventar, steht nichts da.
- Ab Runner 1.7.0 meldet er für OpenCode zusätzlich die auf dem Host eingerichteten Provider, die nutzbaren Modelle mit OpenCodes eigenen Angaben und das Ergebnis des ACP-Vertragschecks (PAGE-154, siehe [PagesRunner.md](./PagesRunner.md#opencode-über-acp-page-154-runner-170)).
- Kontext- und Ausgabelimit eines Remote-OpenRouter-Modells stammen aus dessen Katalog (`context_length`, `top_provider.max_completion_tokens`) und erscheinen in der Modellauswahl des Plan-Editors nur, wenn sie genannt wurden. Der Katalog nennt nichts zu Fast Mode, Thinking oder Reasoning-Stufen; Remote-Modelle haben dafür den Wert `unknown` (bisher fälschlich `none`).
- Die Antworten von `store-provider-key` und `check-provider` tragen `usage` aus `GET /api/v1/key` (`used`, `limit`, `remaining`, `resets` als vom Anbieter genannte Kadenz). Fehlende Angaben sind `null`. Kontingent-Reset, Laufdauer eines Jobs, Sitzungsablauf und Wiederaufnahme sind getrennte Angaben; für die beiden letzten liefert kein Remote-Pfad belastbare Daten, sie werden nicht angezeigt.

## Grenzen und offene Punkte

- Die geführte Erstinstallation und Dienstregistrierung sowie eine echte GitHub-Verifikation mit Push und Pull bleiben getrennt von der Runner-Kopplung und den nativen CLI-Aufträgen zu prüfen. Die manuellen Nachweise eines isolierten Runners ersetzen keine Prüfung der Installation unter systemd oder supervisord.
- supervisord: Ein `supervisorctl`-Socket, den nur root öffnen darf, macht Registrierung und Zustand für Pages nicht abfragbar; das Setup endet dann als „teilweise“ (`serviceNotQueryable`). Startet supervisord ohne `-c` aus einer Datei im Arbeitsverzeichnis, ist seine Konfiguration für einen anderen Benutzer nicht sichtbar; dann bleibt nur der Dauerbetrieb-Prozess. Dass supervisord selbst beim Start der Umgebung startet, liegt außerhalb dieses Setups.
- Ohne Dienstmanager zeigt die Phasenleiste die Phase 8 als fehlgeschlagen, obwohl der Runner läuft; der Grund („kein Dienstmanager“) steht in der Kopfzeile.
- Das Setup-Artefakt wird als eine Befehlszeile übertragen (Base64). Es muss unter 128 KiB bleiben (`MAX_ARG_STRLEN`); derzeit gilt das mit deutlichem Abstand.
- Schließt die Person das Panel, endet das Skript; ein laufender Paketvorgang des Hosts wird dabei unterbrochen. Die Anzeige warnt davor.
- Das Skript legt kein Programm mit `curl | sh` an, ändert keine Shell-Profile und speichert keine Provider-Schlüssel. Neue GitHub-Schlüssel und bestätigte Hostdaten liegen unter `~/.config/pages-runner/github_ed25519` und `github_known_hosts`; nach Bestätigung kann ein Eintrag für `github.com` in `~/.ssh/config` darauf verweisen. Bestehende Schlüssel werden nicht automatisch migriert.

## PAGE-151: Anmeldung, Identität und Katalog

Runner 1.5.0 installiert `cli.mjs` und `github.mjs` neben Transport und Executor. Codex und Claude Code können anschließend als native Remote-CLI-Knoten eines Agent Plans laufen; siehe [PagesRunner.md](./PagesRunner.md#remote-cli-agenten-page-151-runner-140). Die CLI-Anmeldung führt die Person selbst auf dem Remote-Host aus. Phase 4 erklärt die Befehle, startet keine Anmeldung und überträgt keine vorhandenen lokalen Credentials oder Sitzungen. Einstellungen → Agents zeigt bestätigte Anmeldung getrennt von Installation und bietet „Inventar aktualisieren“.

Eine zusätzliche erlaubte Wurzel, ein anderer Anzeigename oder erneuerte SSH-Secrets bei unveränderter Authentifizierungsart erhalten eine vorher gültige Runner-Kopplung. Host, Port, Benutzer, Hostschlüssel, Authentifizierungsart und Abteilung bleiben sicherheitsrelevant. Der Verbindungsdialog erklärt vor dem Speichern, dass diese Änderungen die Kopplung ungültig machen. Danach zeigt die Runner-Zeile den Zustand ausdrücklich und bietet Widerruf sowie nach stabiler Verbindung eine neue einmalige Freigabe. Eine fremde oder bereits ungültige Identität wird nicht übernommen.

Nach Neu-Kopplung liest Pages den vorhandenen Remote-OpenRouter-Katalog erneut. Fehlt er, erklärt die Modellauswahl den Zustand und führt zur Synchronisation in Einstellungen → Agents. Ein vorhandener Runner-Schlüssel wird dabei ohne erneute Übertragung benutzt; ein fehlender Schlüssel muss ausdrücklich hinterlegt werden. Die CLI-Modellpicker sind davon unabhängig.

Die Remote-Workspace-Zeile prüft den eigenen GitHub-Schlüssel des Runners über `git ls-remote` und einen ausschließlich mit `git push --dry-run` ausgeführten Schreibprobeaufruf. Lesen und Schreiben werden getrennt ausgewiesen: nur lesend, kein Zugriff oder nicht prüfbar. Ein zufälliger, vorher als nicht vorhanden geprüfter Referenzname und ein privates temporäres Bare-Repository vermeiden Änderungen am Projekt; keine Remote-Referenz wird angelegt. Es werden keine Schlüsselrechte verändert. Fehlende Schlüssel, nicht bestätigte Hostdaten und Netzwerkfehler bleiben unbekannt. Die bisherigen Offline-Metadatenoperationen bleiben netzwerkfrei. Details einschließlich Betreiberpfaden und Protokoll stehen in [PagesRunner.md](./PagesRunner.md#katalog-und-github-rechte).
