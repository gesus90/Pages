# Pages-Runner (PAGE-141)

Der lokale Teil stellt Protokoll v1, persistente Kopplung und Skriptübertragung bereit. Einstellungen → Agents zeigt API, Lokal und Remote direkt hintereinander vor den Pica-Einstellungen. Die CLI-Pfade sind aufklappbar; Remote verwendet dieselben Tabellenspalten mit tatsächlicher SSH-Prüfzeit und Abteilungsfreigabe. Remote enthält ausschließlich gespeicherte SSH-Anbindungen. Es werden keine Remote-Agenten aus einer Hostliste abgeleitet.

## Setup und Berechtigungen

Ein Administrator im aktiven Admin-Modus öffnet die registrierte Verbindung mit „Verbinden“. Nach mindestens fünf Sekunden verbundener SSH-Sitzung, erfolgreicher letzter Prüfung und bestätigtem Hostschlüssel erscheint bei fehlender Runner-Registrierung „Setup“. Der Server prüft dieselben Bedingungen erneut.

„Setup“ überträgt ausschließlich das aus `scripts/pages_setup.sh` und `scripts/runner/*.mjs` zusammengesetzte Setup-Artefakt über den vorhandenen OpenSSH-Control-Socket. Das Ziel ist standardmäßig `~/pages_setup.sh`, Modus 0600. Eine bestehende identische Datei wird wiederverwendet; eine andere Datei oder ein symbolischer Link wird abgelehnt. Temporäre Datei, SHA-256-Prüfung, `bash -n` und atomisches Verlinken verhindern eine unvollständige Zieldatei. Es erfolgt kein Start des Skripts. Der authentifizierte Download unter `/settings-api/runners` liefert dieselben Bytes.

Für eingeschränkte Übertragungen kann der Betreiber vor dem Start `PAGES_RUNNER_SETUP_DIRECTORY=pages-queue-test` setzen. Erlaubt ist ein einzelner Verzeichnisname relativ zum Home, kein absoluter Pfad. Die Abnahme verwendet das Home, wenn die Übertragung dorthin ausdrücklich freigegeben ist.

Das Skript wird erst später vom Betreiber nach Prüfung manuell mit Bash gestartet. Es unterstützt Ubuntu, apt und x86_64/aarch64, prüft vorhandene Pakete und Node.js >=22 und erklärt die Änderungen. Ein ungeeigneter apt-Kandidat führt zum Abbruch. Codex, Claude Code und OpenCode werden einzeln abgefragt; vorhandene Installationen und Anmeldungen bleiben erhalten. Anschließend wird der Runner ausgewählt. Eine gemeinsame Übersicht nennt die benötigten apt-Pakete, alle gewählten CLI-Pakete und die Runner-Dateien. Erst die abschließende Bestätigung mit Nein als Vorgabe erlaubt Schreibzugriffe. Ohne gewählte Änderung beendet sich das Skript ohne Installation. npm-Installationen liegen unter dem Benutzerverzeichnis. Vorhandene CLIs bleiben erhalten. Es gibt keine curl-pipe-sh-Aufrufe, automatischen Account-Anmeldungen, Änderungen an Shell-Profilen oder systemd-Installation. Provider-API-Keys werden nicht abgefragt oder gespeichert. Nach dem Schreiben des Runners zeigt das Skript die getrennt erforderlichen Kopplungs- und Workspace-Schritte an; es behauptet weder eine abgeschlossene Kopplung noch einen laufenden Dienst.

## Registrierung und WebSocket

`POST /settings-api/runners` akzeptiert ausschließlich authentifizierte Administratoren im Admin-Modus. `intent=authorize` mit `connectionId` liefert eine einmalige, zwei Minuten gültige Registrierungsfreigabe. Sie ist an Benutzer und SSH-Konfigurationsrevision gebunden. Im Speicher liegt nur ihr SHA-256-Digest. `intent=revoke` widerruft die gespeicherte Runner-Identität und offene Freigaben ausdrücklich. Der Widerruf verwirft auch das bisherige Jobjournal; er ist kein Wiederverbindungsschritt.

Der Runner wird separat mit `node ~/.local/share/pages-runner/runner.mjs` gestartet. Beim ersten Start fragt er die WS/WSS-URL und Freigabe im lokalen Terminal ab. Es folgt ausschließlich eine ausgehende Verbindung:

`wss://PAGES/runner/v1/channel/CONNECTION-ID`

Auf ausdrückliche Betreiberentscheidung für die LAN-Inbetriebnahme ist auch `ws://PAGES/runner/v1/channel/CONNECTION-ID` zulässig. Dabei werden die Maschinen-Credentials unverschlüsselt übertragen; TLS wird später eingerichtet. `wss://` bleibt zulässig.

WebSocket-Subprotokolle: `pages-runner.v1` und `credential.FREIGABE` beziehungsweise `credential.RUNNER-TOKEN`. Der Server wählt ausschließlich `pages-runner.v1` als Antwort. Credentials stehen weder in URL noch Browser-Speicher. Browser-Origin wird abgelehnt. Bei TLS-Terminierung muss der Proxy WebSocket-Upgrades weiterleiten und Authentifizierungsheader aus Logs fernhalten.

Die einmalige `registered`-Nachricht liefert Runner-ID, Session-ID und bei neuer Registrierung das dauerhafte Runner-Token über den authentifizierten Kanal. Pages speichert nur dessen Digest. Der Runner speichert das Token als private Datei unter `~/.config/pages-runner/config.json`. Das ist eine Maschinenkopplung, kein Provider-API-Key. Geht diese einmalige Antwort verloren, ist eine ausdrückliche Widerruf-/Neuregistrierung erforderlich. Änderungen oder Löschung der SSH-Konfiguration entwerten bestehende Kopplungen; die Identität wird nicht still ersetzt.

Vor jeder weiteren Nachricht muss der Runner `reconcile` senden. Heartbeats laufen alle 15 Sekunden; nach spätestens 60 Sekunden ohne gültige Nachricht beendet Pages den Kanal. Die Oberfläche bewertet den Runner nach 45 Sekunden ohne Nachricht als offline. Der Runner begrenzt erfolglose Wiederverbindungen auf fünf Versuche. Nach einem Pages-Neustart bleiben Identität, Session und bestätigtes Journal in DuckDB erhalten, Live-Status und Registrierungsfreigaben verfallen.

## Protokoll und Arbeitsumfang

`definition/RunnerProtocol.ts` enthält validierte v1-Verträge für UUID-Job-, Session- und Ereignis-IDs, monotone Ereignisfolgen, Jobzustände, Heartbeat, kumulative Bestätigung und Wiederabgleich. Ereignisse werden erst nach dem DuckDB-Checkpoint bestätigt. Das zuletzt bestätigte Ereignis kann verlustfrei wiederholt werden. Lücken, falsche Sessions und ungültige Zustandsübergänge werden abgelehnt; bei älteren Ereignissen ist ein Wiederabgleich erforderlich. Beim Wiederabgleich bleibt Pages maßgeblich. Auf dem Runner fehlende aktive Jobs werden als `lost` gespeichert, niemals automatisch erneut gestartet.

`RunnerService.enqueue` speichert den einmaligen Start-Claim mit unveränderlicher Planbindung und Ausführungsbefehl, bevor `dispatch` ausgeliefert wird. Runner 1.2.0 bestätigt den gestarteten Worker mit Launch-ID und Linux-Prozessidentität. Er hält genau ein unbestätigtes Ereignis dauerhaft zurück und sendet es bis zum DuckDB-Ack erneut. Wiederabgleich startet bestätigte Claims niemals neu.

Der Worker läuft in einer getrennten Prozessgruppe weiter, wenn der Transport endet. Fehlen Worker und Exit-Datei, wird der Job nach einer Prüfung eigener Prozessreste als `lost` beendet. Abbruch und Timeout erzeugen einen terminalen Status mit bestätigter oder fehlgeschlagener Bereinigung. CLI-Anmeldungen und Dienste bleiben separate Einrichtungsschritte; der Installer legt keinen systemd-Dienst an. Der Endpunkt gehört zum Produktionsserver, nicht zum Vite-Entwicklungsserver.

## OpenRouter auf dem Runner

Runner-Version `1.2.0` unterstützt OpenRouter einschließlich der Modell-IDs mit `~`-Präfix; `node ~/.local/share/pages-runner/runner.mjs --version` zeigt die Version ohne Kopplung. Aktualisierungen erfolgen weiterhin über das geprüfte Setup-Artefakt. Ein bereits laufender Runner muss anschließend neu gestartet werden.

`POST /settings-api/runners` mit `intent=store-provider-key`, `connectionId`, `provider=openrouter` und `apiKey` verlangt eine aktive Administrator-Sitzung, Admin-Modus, denselben Origin sowie einen online gekoppelten Runner mit aktueller SSH-Revision. Pages übergibt den Schlüssel ausschließlich im authentifizierten Runner-Kanal, ohne ihn in DuckDB oder dem Jobjournal zu speichern. Pro Verbindung ist eine Provider-Anfrage gleichzeitig zulässig, mit 90 Sekunden Antwortfrist. Bei fehlendem Kanal erfolgt keine ersatzweise SSH-Übertragung.

Der Runner prüft den Schlüssel authentifiziert über `GET https://openrouter.ai/api/v1/key` und liest danach `/models`. Erst nach beiden erfolgreichen Schritten ersetzt er `~/.config/pages-runner/openrouter.json` atomar mit Modus 0600 im Verzeichnis 0700. Dieser Runner-Speicher enthält den Schlüssel, Katalogmetadaten und den Synchronisationszeitpunkt. Eine abgelehnte Authentifizierung überschreibt den bisherigen Speicher nicht. Als kostenlos gelten Modelle, deren explizite Prompt- und Completion-Preise jeweils numerisch null sind. Die Route liefert Gesamtzahl, kostenlose Modell-IDs und Namen sowie Zeitpunkt und HTTP-Status; Schlüssel und rohe Provider-Antworten werden niemals zurückgegeben oder protokolliert.

`intent=check-provider` mit `connectionId`, `provider=openrouter` und optional `model` (Standard `openrouter/free`) prüft den gespeicherten Schlüssel erneut und sendet einen auf 64 Ausgabetokens begrenzten Chat-Aufruf. Zugelassen sind ausschließlich synchronisierte kostenlose Modelle. Die Antwort enthält HTTP-Status, Modell-ID und die booleschen Angaben `hasReply` und `isOkReply`; Chat-Inhalte bleiben auf dem Runner. Fehler liefern nur einen optionalen Upstream-HTTP-Status, ohne Fehlertext des Providers. Jeder Provider-Aufruf hat ein Timeout von 30 Sekunden und folgt keinen Weiterleitungen. Heartbeats laufen währenddessen weiter.

Grundlage sind die offiziellen OpenRouter-Verträge für [Schlüsselprüfung](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), [Modellkatalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) und [Chat](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion). Bei freigegebenem `ws://` werden auch Provider-Schlüssel im LAN unverschlüsselt transportiert; für den dauerhaften Betrieb kann derselbe Kanal mit `wss://` verwendet werden.

## GitHub-Deploy-Keys

`RunnerGitHubClient` hat genau die Operationen Schlüssel anlegen, Schlüssel prüfen und Zugriff prüfen. `RunnerDeployKeyService` prüft vorher die bestehenden Projektverwaltungsrechte und validiert öffentliche SSH-Schlüssel. Die authentifizierte Admin-Route bietet `intent=deploy-key` mit `projectId`, `publicKey`, `title` und `intent=repository-access` mit `projectId`.

- `PAGES_RUNNER_GITHUB_MODE=offline` ist Standard. Der produktive Offline-Client registriert Schlüssel ausschließlich in `runner_deploy_keys`, liest die Projekt-Repository-Konfiguration und liefert `mode: "offline"`. `accessible: null` bedeutet: echter Zugriff unbekannt. Er entschlüsselt keine Tokens und verwendet keinen Netzwerkclient.
- `PAGES_RUNNER_GITHUB_MODE=http` aktiviert ausdrücklich den echten Client. Dieser liest vor jedem Aufruf den verschlüsselt gespeicherten Projekt-Token, entschlüsselt ihn ausschließlich serverseitig und verwendet die feste GitHub-API mit Timeout, ohne Weiterleitungen. Er legt ausschließlich lesende Deploy-Keys an, findet vorhandene Schlüssel mit Seitennavigation, prüft Schlüssel-ID und Lesepolicy und prüft authentifizierten Zugriff auf Repository-Metadaten. Das beweist keinen SSH-Clone mit dem privaten Deploy-Key. Andere Konfigurationswerte werden abgelehnt.

Die echte GitHub-Anbindung wurde in diesem Lauf nicht aufgerufen oder geprüft und wird vom Auftraggeber getestet. Grundlage des HTTP-Vertrags ist die [GitHub-Dokumentation zu Deploy-Keys](https://docs.github.com/en/rest/deploy-keys/deploy-keys). Die CLI-Pakete entsprechen den offiziellen Installationsangaben für [Codex](https://developers.openai.com/codex/cli/), [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) und [OpenCode 1](https://opencode.ai/docs/). Die tatsächliche Installation und Anmeldung bleibt separat zu prüfen.

## Remote-Pläne (Scope-Erweiterung PAGE-142)

Der Planeditor liest die freigegebenen Modellmetadaten aus demselben OpenRouter-Speicher und Runner-Kanal wie die PAGE-141-Verwaltungsroute. Auswahl und Start verlangen Admin-Modus, aktuelle Projekt-/Workspace-Rechte, tatsächliche Verbindungsabteilungsmitgliedschaft, eine aktuelle Runner-Registrierung und einen ausführenden Runner. Modellrouten binden Verbindung, Workspace und Katalogrevision; erneute Synchronisation entwertet ältere Auswahlen. Es gibt keinen lokalen Ersatz.

Standalone-Remote-Agenten verwenden den gewählten OpenRouter-Chatweg, Remote-Scripts die Runner-Identitäten Bash, Python 3 oder Node.js mit geprüftem Binärdigest. Gruppen und Schleifen mit Remote-Ziel, ACP/CLI-Remote-Sitzungen, Ticket-Abnahmen und andere Parametertypen als Text sind gesperrt. Resultatbindungen werden erst beim Dispatch aus erfolgreichen Vorgängern ergänzt. Ein Pages-Prozessneustart stellt keine DAG-Fortsetzung her; der dauerhafte Jobstand bleibt erhalten und wird weiterhin abgeglichen.

Die Script-Prozessgruppe erhält ausschließlich eine erlaubte Umgebung, private Quell-/HOME-Dateien, JSON-stdin, endliche Laufzeit, maximal 64 KiB Gesamtausgabe, CPU-, Dateigrößen-, Deskriptor-, Prozess- und Adressraumgrenzen. Node läuft ohne JIT/Wasm mit 128-MiB-Heap und 1-GiB-Adressraum; Bash/Python erhalten 512 MiB Adressraum. Dies ist keine Sandbox gegen bösartigen Code desselben Betriebssystemkontos und keine aggregierte Cgroup-Speicherquote. Vor Ressourcensignalen werden PID-Startzeit und eigene Prozessmarker geprüft. Bestätigtes Cleanup entfernt die privaten Laufzeitdateien. Terminale Claim-/Ergebnisjournale bleiben zur Verhinderung einer Wiederholung bestehen; pro Kopplung sind höchstens 1000 Jobs zulässig.
