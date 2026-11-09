# Pica Mobile: Benachrichtigungen für Plan-Läufe (PAGE-193)

Pages benachrichtigt die Android-App Pica Mobile, wenn in einem selbst gestarteten Lauf oder, auf Wunsch des Kontos, in einem Lauf eines Team-Plans (PAGE-263) ein Folgeschritt wirklich startet oder ein Lauf bestätigt abgebrochen wird, fehlschlägt oder erfolgreich endet. Der Nachrichtenvertrag (`notifications.v1`) steht in [PicaMobileWebSocket.md](./PicaMobileWebSocket.md#erweiterung-notificationsv1-android-fcm). Dieses Dokument beschreibt den Betrieb, die Datenhaltung, die Grenzen und die Übergabe an die echte Prüfung mit Firebase und einem Gerät.

**Stand.** Das Backend ist umgesetzt, mit den statischen Gates (`pnpm run check`, `pnpm run lint`) geprüft und statisch mit dem Mobile-Vertrag und den Parsern der App abgeglichen (siehe [Abgleich](./PicaMobileWebSocket.md#abgleich-mit-dem-mobile-vertrag-pm-14-1)). Eine Zustellung über das echte FCM, das Verhalten auf einem Gerät und die gemeinsame Prüfung mit der laufenden App sind **nicht** erfolgt; sie sind Aufgabe von Igor (siehe [Übergabe](#übergabe-an-die-echte-prüfung)). Bis dahin ist die Ende-zu-Ende-Funktion unbestätigt.

## Wie es zusammenhängt

```text
Lauf wird geschrieben ──(nach dem Commit)──> Beobachter ──> Recorder
                                                              │ ermittelt Empfänger (Starter, Team mit Schalter), prüft Rechte, Bündelung 1 s
                                                              ▼
                              Ereignis + Sequenznummer + Zustellungen  (eine Transaktion, DuckDB)
                                                              │
                                    Dispatcher (eigener Takt, nie im Weg des Laufs)
                                      prüft vor jedem Versuch Registrierung, Sitzung, Konto, Starter/Team, Schalter, Rechte, Rest-TTL
                                                              ▼
                                           FCM HTTP v1  ──>  Android-Gerät
```

- **Quelle** sind die bestätigten Schreibvorgänge eines Laufs. Der Beobachter wird erst nach dem Commit gerufen, liest nur die beiden Fassungen des Laufs und stellt Arbeit in eine Warteschlange. Er kann den Lauf weder ändern noch aufhalten, und ein Fehler darin wird protokolliert und verschluckt.
- **Registrierungen, Ereignisse, Sequenznummern, Zustellungen** liegen in den Tabellen `pica_mobile_push_registrations`, `pica_mobile_notification_events`, `pica_mobile_notification_sequences`, `pica_mobile_notification_occurrences` und `pica_mobile_notification_deliveries` (Migration `086`). Die Instanzkennung steht in `pica_mobile_notification_instance`. Der Team-Schalter je Konto steht in `pica_mobile_notification_preferences`; seit PostgreSQL-Migration `019` (PAGE-263) merkt sich `pica_mobile_notification_occurrences` je Empfängerkonto, was schon gemeldet wurde, sodass Starter und Teammitglieder dieselbe Tatsache je einmal bekommen.
- **Empfänger** (PAGE-263): der Starter des Laufs, auch wenn der Plan jemand anderem gehört, und die aktuellen Mitglieder und Leitungen der Plan-Abteilung, die den Team-Schalter über `notifications.team.v1` eingeschaltet haben und ein aktiv registriertes Gerät besitzen. Für jeden prüft Pages die eigenen Rechte an Plan und Lauf; die Teamzugehörigkeit erweitert keine Leserechte. Ein Konto mit mehreren Gründen bekommt je Tatsache ein Ereignis und je Gerät eine Zustellung.
- **Ohne registriertes Gerät** legt Pages kein Ereignis an. Das Einschalten der Benachrichtigungen spielt daher nie Vergangenes nach.
- **Reihenfolge der Dienste.** Der Dispatcher und der Recorder stoppen beim Beenden von Pages, bevor die Datenbank schließt; jeder wartet dabei höchstens fünf Sekunden.

## Pushes für Unterhaltungen (PAGE-278)

Neue Nachrichten der gespeicherten Unterhaltungen (`conversations.v1`) nutzen dieselben Registrierungen, denselben FCM-Absender und dieselbe Prüfung von Sitzung und Konto, aber nicht den Postausgang der Plan-Pushes: Pages übergibt den Push direkt nach dem Speichern der Nachricht und wiederholt ihn nicht, weil die Nachricht in der Unterhaltung wartet. Kein Push geht an den Absender, für stummgeschaltete Unterhaltungen oder solange eine Verbindung des Kontos die Unterhaltung offen hat. Vertrag, Kanal und Nutzlast stehen in [PicaMobileWebSocket.md](./PicaMobileWebSocket.md#push-bei-neuen-nachrichten). `PAGES_PUSH_SIMULATION=1` ersetzt FCM außerhalb von Produktion durch eine Ausgabe dessen, was übergeben würde; das gilt dann auch für die Plan-Pushes.

## Einrichtung durch den Betreiber

Pages sendet über FCM HTTP v1 mit dem Schlüssel eines Google-Dienstkontos. Pages legt kein Firebase-Projekt, kein Konto und keine Zugangsdaten an; das erledigt der Betreiber.

1. **Firebase-Projekt** mit aktivierter _Firebase Cloud Messaging API (V1)_ und die Android-App des Projekts (Paketname der App).
2. **Dienstkonto** mit dem Recht, FCM-Nachrichten zu senden (die Standardrolle „Firebase Admin SDK Administrator Service Agent“ genügt; enger geht die Rolle „Firebase Cloud Messaging API Admin“).
3. **Schlüssel erzeugen:** Firebase Console → Projekteinstellungen → Dienstkonten → „Neuen privaten Schlüssel generieren“. Das ist eine JSON-Datei mit `project_id`, `client_email` und `private_key`.
4. **Datei sicher ablegen**, nur für das Konto lesbar, das Pages betreibt, außerhalb des Repositorys und außerhalb des Datenordners, den ein Backup öffentlich macht:

   ```sh
   install -m 600 fcm-service-account.json ~/.pages/secrets/fcm-service-account.json
   ```

5. **In `~/.pages/config.toml`** den absoluten Pfad nennen (optional die Gültigkeit in Sekunden):

   ```toml
   picaMobileFcmServiceAccountFile = "/home/dev/.pages/secrets/fcm-service-account.json"
   picaMobileReplayTtlSeconds = 900
   ```

   Stattdessen oder zusätzlich gelten die Umgebungsvariablen `PAGES_FCM_SERVICE_ACCOUNT_FILE` und `PAGES_PICA_MOBILE_REPLAY_TTL_SECONDS`; sie haben Vorrang (siehe [`.env.example`](../.env.example)). `picaMobileReplayTtlSeconds` ist eine ganze Zahl von 60 bis 3600, Standard 900.

6. **Pages neu starten.** Die Einstellung wird beim Start gelesen.

Was Pages mit der Datei tut und nicht tut:

- Es liest nur `project_id`, `client_email` und `private_key`. Die Adresse für Token ist fest `https://oauth2.googleapis.com/token`; steht in der Datei eine andere `token_uri`, lehnt Pages die Datei ab, damit die signierte Anfrage nie woanders hinläuft.
- Fehlt die Datei, ist sie unlesbar, kein gültiger Dienstkonto-Schlüssel oder kein RSA-Schlüssel, startet Pages normal, schreibt **eine** Warnung mit einem kurzen Grund (`integration.fcm.service_account_problem`, Feld `reason`) und bietet **keinen** Push an: `notifications.push.fcm` fehlt in `connected`, `notification_register` wird mit `server_unavailable` abgelehnt. Eine Datei, die andere Benutzer lesen können, lädt Pages mit der Warnung `file_permissions_open`.
- Der Schlüssel, das signierte Token und das Zugriffstoken stehen nie in einem Protokoll, einer Antwort an die App oder der Datenbank. Der Schlüssel gehört weder ins Repository noch in ein Ticket noch in die App.
- Die `google-services.json` der App gehört **nicht** zu Pages; sie wird beim Bau des APK in die App gelegt.

## Daten und Datenschutz

- **Push-Token.** Der native FCM-Token wird mit dem Instanzschlüssel verschlüsselt (AES-256-GCM, an die Geräte-Kennung gebunden) gespeichert. Der Instanzschlüssel ist derselbe, den Pages für seine anderen Verbindungsgeheimnisse nutzt (`PAGES_GITHUB_TOKEN_KEY` oder `github-token.key` neben der Datenbank). **Er gehört zum Backup der Datenbank**; ohne ihn sind die gespeicherten Token unbrauchbar, die Geräte registrieren sich dann beim nächsten Verbindungsaufbau neu. Ein schlüsselbasierter Fingerabdruck des Tokens dient nur dazu, einen Token zu erkennen, der auf ein anderes Gerät oder Konto gewandert ist.
- **Keine Namen in der Datenbank.** Ereignisse speichern Kennungen, Nummern und Zeiten, keine Plan-, Schritt- oder Laufnamen. Ein Abruf und eine detaillierte Push-Nachricht lesen die Namen jedes Mal mit den aktuellen Rechten des Kontos.
- **Aufbewahrung.** Ereignisse: 7 Tage und höchstens 100 je Konto; die Einträge, an denen Pages erkennt, was es schon gemeldet hat: 7 Tage. Beendete Zustellungen: 1 Tag. Sequenznummern: solange der Lauf existiert, damit nach einem Fortsetzen oder Neustart keine Nummer wiederverwendet wird. Pages räumt etwa alle fünf Minuten auf.
- **In einer Push-Nachricht** stehen nie Prompts, Antworten, Rohprotokolle, Arbeitsverzeichnisse, Sitzungs- oder Providerzugänge (siehe Vertrag). Ohne ausdrückliche Wahl `preview: "details"` stehen auch keine Namen darin.
- **Besitz- und Sitzungswechsel.** Was Pages schon an den Push-Dienst übergeben hat, liegt außerhalb seiner Kontrolle: ein später entzogenes Recht, ein beendetes Konto oder eine entfernte Registrierung holen die Nachricht nicht zurück. Ein Gerät, das ein anderes Konto übernimmt, bekommt für das neue Konto eine neue Bindung ab diesem Moment; die alte endet sofort, und wartende Nachrichten an sie werden verworfen.

## Wann Pages sendet, wiederholt und aufhört

- **Rechte.** Beim Anlegen eines Ereignisses, unmittelbar vor jedem Zustellversuch und bei jedem Abruf prüft Pages, dass das Konto den Lauf gestartet hat oder als Mitglied des Plan-Teams mit eingeschaltetem Team-Schalter folgt (eingeschaltet schon zum Zeitpunkt des Ereignisses) und dass es Plan und Lauf lesen darf. Unmittelbar vor jedem Zustellversuch (und etwa alle fünf Minuten für alle Registrierungen) prüft es außerdem, dass die Registrierung noch besteht, ihre Sitzung gilt, das Konto aktiv ist und kein Passwortwechsel aussteht. Fällt eine Prüfung negativ aus, wird die wartende Nachricht verworfen; eine Registrierung, deren Sitzung oder Konto nicht mehr gilt, entfernt Pages dabei gleich mit. Die Zugangsdaten für FCM holt Pages vor diesen Prüfungen, damit zwischen Prüfung und Übergabe an FCM nur noch die Anfrage selbst liegt.
- **Rest-TTL.** Pages sendet nur, solange die Gültigkeit des Ereignisses (`picaMobileReplayTtlSeconds`, Standard 15 Minuten) nicht abgelaufen ist, und gibt FCM die verbleibende Zeit.
- **Wiederholung.** Bei vorübergehenden Fehlern (FCM nicht erreichbar, Zeitüberschreitung, Quota, `500`/`503`/`429`) versucht Pages höchstens sechsmal (der erste Versuch und fünf Wiederholungen) mit wachsendem Abstand (etwa 5 s, 15 s, 45 s, 2 min, 5 min; `Retry-After` wird beachtet) und nie über die Gültigkeit hinaus. Ist das Dienstkonto selbst nicht nutzbar (`401`/`403`), wartet Pages mindestens eine Minute zwischen den Versuchen. Kann Pages gar keine Zugangsdaten bei Google holen, fasst es keine Zustellung an und versucht es alle 30 Sekunden neu; wartende Nachrichten verfallen dann mit ihrer Gültigkeit, ohne dass ein Versuch verbraucht wird.
- **Ungültiger Token.** Nur wenn FCM den Token selbst für ungültig erklärt, entfernt Pages genau diese Registrierung. Alles, was die Nutzlast oder die Projektkonfiguration betrifft, lässt Registrierungen unberührt.
- **Drosselung.** Ein Lauf sendet an ein Gerät höchstens eine Schrittmeldung je 10 Sekunden; eine neuere ersetzt wartende ältere. Meldungen zum Laufende werden nicht gedrosselt, nicht ersetzt und nicht verworfen. Bei einem Laufende entfallen nur noch wartende Schrittmeldungen desselben Laufs.
- **Kein Einfluss auf Läufe.** Der Dispatcher läuft getrennt von der Ausführung. Fällt FCM aus, ist die Konfiguration falsch oder fehlt sie, bleibt jeder Lauf unverändert; es wird kein Job gestartet oder aufgehalten.

## Grenzen

- **Keine garantierte Anzeige.** „Von FCM angenommen“ ist nicht „auf dem Gerät gesehen“. Energiesparmodus, App-Einstellungen, deaktivierte Kanäle, fehlende Berechtigung (Android 13 und neuer) und Google-Dienste können eine Meldung verzögern oder unterdrücken.
- **Mögliche Doppelsendung, keine Doppelanzeige durch Pages.** Geht die Bestätigung von FCM verloren, kann Pages dieselbe Nachricht erneut senden. Sie trägt dieselbe `tag`, sodass Android die erste Anzeige ersetzt; das Betriebssystem garantiert aber kein genau einmaliges Erscheinen.
- **Verspätung.** Eine Meldung kann höchstens um die Bündelung (1 s), die Drosselung (10 s je Lauf und Gerät) und die Wiederholungen später kommen; nach Ablauf der Gültigkeit kommt sie gar nicht.
- **Absturz im Fenster nach dem Commit.** Zwischen dem Commit eines Laufübergangs und dem Speichern des Ereignisses liegen die Bündelung (bis 1 s) und die Verarbeitung. Stürzt Pages genau dann ab, geht dieses Ereignis verloren; ein Ereignis wird dadurch nie doppelt erzeugt, und gespeicherte Ereignisse samt Sequenznummern überstehen jeden Neustart.
- **Läufe, die Pages selbst unterbricht,** weil es endet oder neu startet, meldet Pages nicht (Fehlercode `plan_interrupted`); sie sind danach als unterbrochen fortsetzbar. Beim Beenden wartet Pages auf den Versand höchstens fünf Sekunden; eine dann noch laufende Zustellung wird nach dem nächsten Start erneut versucht, solange ihre Gültigkeit nicht abgelaufen ist.
- **Getrennte Übergänge.** Parallele Starts werden zu einem Ereignis gebündelt, wenn sie innerhalb einer Sekunde auftreten; liegen sie weiter auseinander, entstehen zwei Ereignisse.
- **Fortsetzen.** Ein Schritt, dessen erster Start lief, ohne dass ein Gerät registriert war, wurde nie gemeldet und wird nach einem Fortsetzen erstmals gemeldet.
- **Besitz von Gerätekennung und Token.** Wer als angemeldetes Konto die `deviceId` oder den Token eines anderen Geräts kennt, kann dessen Bindung durch seine eigene ersetzen; das entzieht dem anderen die Meldungen, gibt aber keinen Zugriff auf dessen Ereignisse. Beide Werte sind vertraulich zu behandeln, und Version 1 des Protokolls läuft ohne TLS.
- **Nicht gemeldet:** das interne Beenden eines älteren Laufs, wenn ihn der Neustart eines Plans ersetzt, die Aktion „Abbrechen“ in der Wiederherstellung eines bereits fehlgeschlagenen Laufs und alles, was nur die Oberfläche ändert.
- **Kein Link.** Die Weboberfläche hat keine Adresse, die einen einzelnen Lauf ohne Query-Teil öffnet; Pages sendet deshalb nie ein `detailUrl`.
- **Abmelden der App** ist im Protokoll Version 1 kein bestätigter Server-Logout (siehe Vertrag).

## Übergabe an die echte Prüfung

Diese Schritte erledigt Igor. Sie sind **kein** Done-Gate der Umsetzung und wurden von keinem Agenten ausgeführt.

### Vorbereitung

1. Firebase-Projekt, Dienstkonto und Schlüsseldatei wie oben einrichten, in `config.toml` eintragen, Pages neu starten.
   _Erwartet:_ im Protokoll `pica_mobile.notifications.started` mit `status = push_available`; kein `integration.fcm.service_account_problem`.
2. Android-APK mit der `google-services.json` desselben Projekts bauen und installieren; Benachrichtigungen für die App erlauben (Android 13 und neuer: `POST_NOTIFICATIONS`); die Kanäle `pica-plan-steps` und `pica-plan-results` müssen in der App angelegt sein.
3. Die App verbinden.
   _Erwartet:_ `connected.payload.server.capabilities` enthält `notifications.v1` und `notifications.push.fcm`, nie `notifications.push.apns`.
4. Die App registriert das Gerät.
   _Erwartet:_ `notification_registered` mit `instanceId` (gleich nach einem Neustart von Pages), `accountId` des Kontos, `registeredAt` und `replayTtlSeconds`; in der Datenbank eine Zeile in `pica_mobile_push_registrations` mit `activated_at`, ohne Klartext-Token.

### Szenarien auf dem Gerät

Jeweils mit einem Plan, den das Konto besitzt, und mit `preview: "hidden"`, danach mit `"details"`. Für Vordergrund, Hintergrund, regulär geschlossene App und Sperrbildschirm prüfen.

| Szenario                                    | Erwartung                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Lauf starten                                | keine Meldung für den ersten Schritt                                                                                              |
| Folgeschritt startet                        | eine Meldung „Agent-Plan: nächster Schritt“ (Kanal Schritte); bei `details` „Nächster Schritt“ mit `<Plan> · Schritt <n>: <Name>` |
| Zwei Schritte parallel                      | **eine** Meldung mit beiden Schritten                                                                                             |
| Schleife                                    | Meldung beim Start der Schleife, danach je Iteration ab der zweiten eine (beim ersten Schrittstart darin)                         |
| Wiederholter Versuch desselben Schritts     | keine Meldung                                                                                                                     |
| Pausieren, Fortsetzen                       | keine Meldung beim Pausieren; nach dem Fortsetzen nur bei neu startenden Folgeschritten                                           |
| Stoppanforderung                            | keine Meldung bei „stoppt“; „Agent-Plan abgebrochen“ erst, wenn der Lauf `cancelled` ist                                          |
| Fehlerhafter Schritt, der Lauf läuft weiter | keine Meldung; „Agent-Plan fehlgeschlagen“ erst, wenn der Lauf `failed` ist                                                       |
| Erfolgreicher Lauf                          | „Agent-Plan erfolgreich abgeschlossen“ (Kanal Ergebnisse), ersetzt keine Schrittmeldung und wird von keiner ersetzt               |
| Tippen auf die Meldung                      | die App ruft `notification_event_get`; `access: "ok"`, aktuelle Namen und Lauf-Zustand                                            |
| Sperrbildschirm                             | Inhalt privat (`visibility: PRIVATE`), bei `hidden` ohne Namen                                                                    |

### Rechte und Konto

- Das Konto verliert das Leserecht am Lauf, ein zweites Konto teilt sich einen Plan ohne Teamzugehörigkeit: _Erwartet:_ das zweite Konto bekommt nichts; `notification_event_get` liefert `forbidden` ohne Namen; wartende Nachrichten entfallen.
- Team-Benachrichtigungen (PAGE-263): Konto B ist Mitglied der Plan-Abteilung, Konto A (nicht Eigentümer) startet den Lauf. _Erwartet:_ A bekommt seine Meldungen; B nur nach `notification_settings_set` mit `teamRuns: true`, dann mit `scope: "team"` im Abruf; ohne Schalter, nach Austritt aus der Abteilung oder bei fehlendem Recht an einem benutzten Ticket nichts, wartende Team-Meldungen werden verworfen und der Abruf ist `forbidden`. Ist A selbst Teammitglied mit Schalter, bekommt A je Ereignis genau eine Meldung. Ohne FCM meldet `notification_settings` `isAvailable: false`, `isEnabled: false`.
- Sitzung in Einstellungen → Persönlich → Sicherheit beenden, Konto deaktivieren, Passwortwechsel erzwingen: _Erwartet:_ keine weiteren Meldungen, die Registrierung verschwindet spätestens nach etwa fünf Minuten oder beim nächsten Zustellversuch.
- Token-Rotation (App neu installieren oder Firebase-Token erneuern) und mehrere Geräte: _Erwartet:_ der alte Token wird ersetzt, jedes Gerät bleibt getrennt.
- `notification_unregister`: _Erwartet:_ kein neuer Versand an das Gerät.

### Fehlerpfade

- Schlüsseldatei ungültig oder FCM nicht erreichbar: _Erwartet:_ Läufe laufen unverändert weiter; im Protokoll nur Statuscode und FCM-Fehlercode (`integration.fcm.send_failed`, höchstens eine Zeile je Minute und Fehler), nie ein Token.
- Pages während einer laufenden Zustellung neu starten: _Erwartet:_ noch gültige Nachrichten gehen nach dem Start hinaus, abgelaufene nicht.

### Diagnose ohne Geheimnisse

Protokollereignisse (nur Kurzcodes, keine Token, Namen oder Nachrichtentexte): `pica_mobile.notifications.started`, `pica_mobile.notifications.event_lost`, `pica_mobile.notifications.delivery_ended` (Stufe `debug`, Felder `status`, `reason`, `eventType`), `integration.fcm.send_failed`, `integration.fcm.token_request_failed`, `integration.fcm.service_account_problem`.

Lesende Zählungen in der Datenbank, die sich ohne Schwärzen weitergeben lassen:

```sql
SELECT state, outcome, COUNT(*) AS deliveries
FROM pica_mobile_notification_deliveries
GROUP BY state, outcome
ORDER BY state, outcome;

SELECT event_type, COUNT(*) AS events
FROM pica_mobile_notification_events
GROUP BY event_type;

SELECT locale, preview, COUNT(*) AS devices
FROM pica_mobile_push_registrations
GROUP BY locale, preview;
```

### Offene Nachweise

Nicht erbracht und ausdrücklich Igor übergeben:

- echte Zustellung über FCM mit einem echten Firebase-Projekt und Dienstkonto;
- Verhalten auf einem Gerät (Vordergrund, Hintergrund, geschlossen, Sperrbildschirm, Tippen, Berechtigungen, Kanäle);
- gemeinsame Integration mit der laufenden App. Der feldweise Abgleich mit dem Mobile-Vertrag liegt statisch vor (Stand `d72631b`, siehe [Abgleich](./PicaMobileWebSocket.md#abgleich-mit-dem-mobile-vertrag-pm-14-1)); offen sind `protocol.ts` (Hülle und `connected`-Parser) und `notificationController.ts`, die nicht im Quellabzug lagen, sowie jeder Stand von `main` nach `d72631b`;
- Last- und Dauerverhalten.

iOS und APNs gehören nicht zum Umfang.

### Bestehende Tests

Pages hat keine neuen Tests für diese Umsetzung bekommen (Vorgabe des Tickets). Zwei bestehende Verdrahtungstests prüften die frühere Form und wurden nur an die neue Verdrahtung angepasst, ohne neue Fälle:

- `tests/backend/app/lib/agent-plan-services.unit.test.ts`: `createAgentPlanService` baut jetzt den Dienst für Benachrichtigungen; der Test ersetzt dessen Fabrik durch eine Aufzeichnung und erwartet `picaMobileNotifications` in der Rückgabe;
- `tests/backend/backend/runtime/pica-mobile-runtime.unit.test.ts`: das Gateway erhält zusätzlich `notifications`.

## Nachweisstand PAGE-263 (Team-Push)

Stand: 8. November 2026. Keine neuen automatisierten Tests (Vorgabe des Tickets); die postgres-check-Abläufe wurden um den Team-Schalter ergänzt, und der Einfügefall der Meldungsdatensätze nennt das Empfängerkonto. Ein einmaliges Prüfskript außerhalb des Repositorys (nicht eingecheckt) lief gegen eine eigene temporäre PostgreSQL-Instanz mit allen Migrationen, den echten Repositories, Recorder, Dispatcher, Ereignisleser, Handler und Parser; nur Planrechte und der FCM-Sender waren nachgebildet. Es belegte: Migration `019` übernimmt das Konto bestehender Meldungsdatensätze; Starter ohne Planbesitz und Teammitglied mit Schalter bekommen je Tatsache genau ein Ereignis, Eigentümer ohne Team, Teammitglied ohne Schalter, Konto außerhalb des Teams und Teammitglied ohne Ticketrecht keines; je Ereignis und Gerät höchstens eine Zustellung; nach Austritt aus dem Team wird die wartende Team-Meldung mit `rights_revoked` verworfen und der Abruf ist `forbidden`; Ausschalten macht den Abruf `forbidden`, erneutes Einschalten holt nichts nach; die Einstellung ist je Konto getrennt, übersteht eine erneute Registrierung, ignoriert ein fremdes `accountId` im Payload und erscheint ohne FCM nie als eingeschaltet. Echte Zustellung über FCM und das Verhalten auf einem Gerät sind nicht geprüft und bleiben der Abnahme vorbehalten.

## Nachweisstand dieser Umsetzung

Stand: 1. November 2026, am Endstand der Umsetzung (PAGE-193).

**Statische Gates.** `pnpm run check` (React-Router-Typgenerierung, `tsc --noEmit` im strikten Modus, `prettier --check .`) und `pnpm run lint` (ESLint mit `--max-warnings=0`) wurden am Endstand nach dem Abgleich mit dem Mobile-Vertrag wiederholt. Typgenerierung, `tsc` und ESLint liefen ohne Befund (Exit 0); der erste ESLint-Lauf fand eine verschachtelte Bedingung in der Push-Nachricht (`no-nested-ternary`), die behoben und neu geprüft wurde. Prettier meldete nur den vom Lauf im Arbeitsverzeichnis abgelegten Ticket-Anhang (kein Teil des Repositorys); für alle übrigen Dateien lief `prettier --check` ohne Befund. Alle Gates sagen nichts über funktionale Abdeckung.

**Bestehende Tests.** Gezielt ausgeführt (ohne Coverage, keine Vollsuite): die beiden angepassten Verdrahtungstests (19 Tests) sowie die bestehenden Tests zu Konfiguration, Anmeldung und Sitzungen, Dienstverdrahtung, Laufzeit, Pica-Mobile-Verbindung, -Nachrichten und -Gateway, Agent-Plänen und Plan-Läufen (drei Läufe vor dem Abgleich: 2 Dateien mit 19 Tests, 29 Dateien mit 429 Tests und 109 Dateien mit 1497 Tests, alle bestanden; der Laufzeittest kommt in zwei Läufen vor). Nach dem Abgleich wurde der Teil wiederholt, der die Verträge von Anmeldung, Dashboard, Avatar und Gateway sowie die Verdrahtung prüft (`tests/backend/backend/service/mobile`, die beiden Verdrahtungstests): 8 Dateien mit 170 Tests bestanden. Die geänderten Dateien (Push-Nachricht, Ereignisleser, Definition) werden von keinem bestehenden Test ausgeführt. Sie belegen, dass die vorhandenen Verträge (Anmeldung, Dashboard, Avatar) und die Planausführung unverändert bleiben; sie prüfen die neuen Benachrichtigungen nicht.

**Nicht ausgeführt.** Keine Vollsuite (`pnpm run test:backend`), keine Prüfung gegen ein echtes Firebase-Projekt, kein Gerät, keine Last- und Dauerprüfung, kein Lauf mit der echten App. Das Repository `/home/igor/Repo/Pica-Mobile` existierte auf dem Host nicht und wurde nicht gelesen; der Abgleich beruht auf dem Textabzug im Ticket-Anhang (Commit `d72631b`), dessen vier Dateien byte-genau zur Summenliste im Ticket passen.

**Gezielte manuelle Nachweise.** Einmalige Proben außerhalb des Repositorys (nicht eingecheckt, keine Testsuite) gegen eine leere In-Memory-DuckDB-Instanz, eine gefälschte `fetch`-Funktion und einen gefälschten Sender; keine Live-Daten, kein Netz. Sie belegten:

- _Migration und Repositories:_ die Migration `086` und alle SQL-Pfade laufen; Erneuerung behält `registeredAt` und Aktivierung, Übernahme durch ein anderes Konto beginnt neu, ein wandernder Token ersetzt die ältere Bindung, das Limit von 10 entfernt die älteste, fremde Entfernung ändert nichts; Ereignisse bekommen steigende Sequenznummern, wiederholte Fakten erzeugen kein zweites Ereignis, neuere Schrittmeldungen ersetzen ältere und ein Laufende ersetzt wartende Schrittmeldungen; Claim, Sperre, Wiederholung, Ablauf und Aufräumen verhalten sich wie beschrieben.
- _Übergangserkennung:_ Start eines Folgeschritts, Wiederholung desselben Schritts, Fortschrittsschreibung, Pausieren, Stoppanforderung, Abbruch, Fehler, Erfolg, erneutes Schreiben eines beendeten Laufs und neue Schleifeniteration liefern genau die erwarteten Ereignisse.
- _Recorder und Dispatcher:_ der erste Schritt und die Zusammenfassungszeile einer Gruppe erzeugen nichts; zwei parallele Starts werden ein Ereignis; eine Schleifeniteration mit zwei Mitgliedern wird ein Ereignis; ein Laufende wird nicht gedrosselt und trägt eine eigene `tag`; ein zweiter Schrittstart innerhalb von 10 Sekunden wird zurückgehalten; ein unterbrochener Lauf erzeugt nichts; ohne Recht entsteht kein Ereignis; ein Sender ohne Zugangsdaten bekommt keine Zustellung zugeteilt und verbraucht keinen Versuch.
- _Detailabruf:_ eigenes Ereignis `ok` mit aktuellen Namen und Zustand, fremdes oder unbekanntes `gone`, entzogenes Recht `forbidden` ohne Namen, gelöschter Lauf `gone`.
- _FCM-Sender:_ die JWT-Signatur (RS256) ließ sich mit dem öffentlichen Schlüssel prüfen; Anfrageform, fester Token-Endpunkt und `redirect: error` stimmen; `200` ist gesendet, `UNREGISTERED` und `INVALID_ARGUMENT` mit Feldverstoß auf dem Token sind ungültige Token, `INVALID_ARGUMENT` auf die Nutzlast und `SENDER_ID_MISMATCH` sind abgelehnt, `403` ist nicht verfügbar, `429` und `503` sind Wiederholungen (mit `Retry-After`), `401` erneuert einmal das Zugriffstoken, ein Netzfehler ist eine Wiederholung; zu große oder nicht textliche Nutzlasten gehen nie hinaus.
- _Abgleich mit den Parsern der App (Simulation)._ Die vier Parser des Clients aus dem Quellabzug (`parseRegistered`, `parseUnregistered`, `parseEventDetail`, `parsePushData`) wurden unverändert gegen die echten Ausgaben von Pages gehalten: die drei Encoder, den Ereignisleser (mit nachgebildeter Speicherung und Rechteprüfung) und den Aufbau der Push-Nachricht. Alle Fälle bestanden: Registrierung, Abmeldung, `step_started` mit einem und mit 20 Schritten, die drei Laufenden mit und ohne `reason`, alle sieben Laufzustände, `forbidden` und `gone`, Push-Daten für beide Sprachen und alle vier Typen (genau die zehn Schlüssel, `tag` und Kanal je Art, Titel und Text wie im Vertrag, Nutzlast unter 4096 Byte). Der Abgleich fand zuvor Fehler (400 Emoji als Namen, Leerraum in einer Schrittkennung, 20 Schritte mit Steuerzeichen über 16384 Einheiten), die der Client-Parser abgelehnt hätte; sie sind behoben und gegen den Parser erneut bestanden. Das war ein einmaliges Skript außerhalb des Repositorys, nicht eingecheckt, ohne Netz, Datenbank, FCM und Gerät.
- _Genau inspiziert_ wurden der Vertrags- und Parserpfad (`PicaMobileMessages`, `notifications/PicaMobileNotificationMessages`), der Berechtigungspfad (`AgentPlanOwnerRunReader`, `Recorder.authorize`, `Dispatcher.prepare`, `EventReader.read`), der Persistenzpfad (Migration `086`, `repositories/mobile`), der Senderpfad (`Fcm*`) und der Beobachterpfad (`AgentPlanProgressRepository.save` über `onCommit` zu `AgentPlanRunObservers`). Zwei unabhängige Durchsichten (Berechtigung/Datenschutz und Ereignissemantik/Lebenszyklus) fanden Mängel, die behoben wurden: Zusammenfassungszeilen von Gruppen als Schritt, Schleifenmeldungen je Mitglied, Verhalten beim Beenden, veraltete Schrittmeldungen nach einer Wiederholung, eine zu späte Zugangsdatenholung nach der Rechteprüfung, das Füllen der globalen Schwärzungsliste, ein `404` ohne `UNREGISTERED` als Tokenlöschung, ein zwischengespeicherter Fehler der Instanzkennung und eine bei einem Fehler übersprungene Aufräumrunde.

**Bekannte offene Punkte.**

- Nicht gegengeprüft sind `protocol.ts`, `dashboardProtocol.ts` und `notificationController.ts` der App sowie ein Stand von `main` nach `d72631b`.
- Der Vertrag sagt „bereinigter Klartext“ für `reason`; Pages sendet einen Fehlercode (siehe Abgleich). Ob die App den Code lesbar machen soll, entscheidet der Client.
