# Pica Mobile: WebSocket-Anbindung (PAGE-148, PAGE-164, PAGE-193, PAGE-200, PAGE-201, PAGE-263, PAGE-278, PAGE-281)

Pages stellt für die App Pica Mobile einen WebSocket-Endpunkt bereit. Dieses Dokument ist der Vertrag zwischen Pages und der App: Es beschreibt, wie ein Administrator den Endpunkt einrichtet, wie eine Verbindung aufgebaut wird und welche Nachrichten in Version 1 des Formats gelten.

Version 1 spricht `ws://` ohne TLS. Anmeldedaten und Sitzungstoken sind im Netzwerk lesbar, solange kein `wss://` zur Verfügung steht; der Endpunkt gehört deshalb nur in ein vertrauenswürdiges Netz (siehe [Sicherheit](#sicherheit)). Version 1 enthält Authentifizierung, Verbindungsbestätigung, Heartbeat und strukturierte Fehler sowie die Erweiterungen `dashboard.v1` (Profil, eigene aktive Läufe, zugewiesene Projekte, Avatar; siehe [Erweiterung dashboard.v1](#erweiterung-dashboardv1)) `notifications.v1` (Android-Push über FCM zu eigenen Plan-Läufen; siehe [Erweiterung notifications.v1](#erweiterung-notificationsv1-android-fcm)), `plans.v1` (kompakte Liste der Agent-Pläne des Kontos mit Änderungen, die Pages von sich aus sendet; siehe [Erweiterung plans.v1](#erweiterung-plansv1)), `plans.flow.v1` (vollständige, eingefrorene Ablaufstruktur eines Laufs mit Start, Ende, Entscheidungen, Schleifen, Iterationen und Zuständen auf Anfrage; siehe [Erweiterung plans.flow.v1](#erweiterung-plansflowv1)) `chat.v1` (Chat mit Pica in denselben Unterhaltungen wie im Web, samt Dateianhängen über HTTP am selben Port; siehe [Erweiterung chat.v1](#erweiterung-chatv1)) `chat.delete` (Löschen einer Unterhaltung; siehe [Erweiterung chat.delete](#erweiterung-chatdelete)) und `conversations.v1` (gespeicherte Unterhaltungen mit Personen, Agents und Gruppen samt Sprachnachrichten und Push; siehe [Erweiterung conversations.v1](#erweiterung-conversationsv1)).

## Einrichtung durch einen Administrator

Einstellungen → Verbindungen zeigt Administratoren im Admin-Modus oben die Karte „Pica Mobile“:

- **WebSocket-Port**: eine ganze Zahl von 1 bis 65535. Eingaben außerhalb davon lassen sich nicht speichern.
- **Verbindungsadresse**: `ws://<Host>:<Port>/pica-mobile`, die Adresse für die App. Sie ändert sich mit der Eingabe und gilt nach dem Speichern.
- **Speichern** bindet den Port, schreibt ihn in die Konfiguration und lässt den Endpunkt dort lauschen.

Der Host der Adresse ist nie `localhost`, denn der zeigt auf das Smartphone selbst. Pages nimmt (1) eine in der Konfiguration gesetzte `listenAddress`, sonst (2) den Host, mit dem der Administrator Pages im Browser geöffnet hat, und fällt bei einem Loopback-Namen auf (3) die erste externe IPv4-Adresse des Servers zurück. Findet sich keine, zeigt die Karte stattdessen einen Hinweis, Pages über die Netzwerkadresse des Servers zu öffnen.

Andere Benutzer sehen die Karte nicht. Der Server prüft die Berechtigung bei jedem Speichern erneut (aktiver Administrator im Admin-Modus), unabhängig davon, was die Oberfläche anzeigt.

### Speicherung und Neustart

Der Port steht in `~/.pages/config.toml` als `picaMobilePort`. Ohne den Schlüssel ist der Endpunkt aus und es wird kein zusätzlicher Port geöffnet. Beim Start lauscht Pages auf dem gespeicherten Port; ein Neustart behält die Einstellung. Der Schlüssel darf auch von Hand gesetzt werden; ein Wert außerhalb von 1 bis 65535 verhindert den Start mit einer Fehlermeldung zur Konfiguration, wie bei `port`. Der Endpunkt lauscht auf derselben Schnittstelle wie Pages (`listenAddress`, sonst auf allen).

### Betrieb über pages-core (PAGE-239)

Mit `picaMobileRelayPort` in der Konfiguration hält der Dienst `pages-core` den Port statt des API-Prozesses: Er lauscht auf `picaMobilePort` (gleiche Schnittstelle, gleicher Pfad, gleiche Datei-Endpunkte) und reicht jede Verbindung und jede Dateianfrage unverändert an den Endpunkt der API auf `127.0.0.1:<picaMobileRelayPort>` weiter. Anmeldung, Sitzungsprüfung und alle Nachrichten entscheidet weiter die API; die App merkt keinen Unterschied und braucht kein Update. Ein Neustart der API beendet die Verbindung mit Code 1001 wie ein Pages-Neustart, und die App verbindet sich wie unten beschrieben neu; solange die API nicht erreichbar ist, beantwortet `pages-core` den Handshake mit HTTP 502. Ein Portwechsel in den Einstellungen gilt erst, wenn `pages-core` den neuen Port bedient; sonst bleibt die bisherige Einstellung gespeichert, auch „kein Port“. Antwortet die API auf eine Dateianfrage nicht binnen 10 Sekunden nach der vollständigen Anfrage, antwortet `pages-core` mit HTTP 504. Einrichtung und Rückweg: [deploy/core/README.md](../deploy/core/README.md#websocket-relay-page-239).

### Portwechsel

Ein Portwechsel läuft in dieser Reihenfolge: neuen Port binden, Konfiguration schreiben, erst dann den alten Listener samt seiner Verbindungen schließen (Close-Code 1001). Scheitert ein Schritt, bleibt der bisherige Listener mit seinen Verbindungen und der gespeicherten Konfiguration unverändert. Die Karte meldet den Grund:

| Ursache                                | Meldung der Karte                                         |
| -------------------------------------- | --------------------------------------------------------- |
| Port belegt (`EADDRINUSE`)             | Port N ist bereits belegt. Wähle einen anderen Port.      |
| Port des Pages-Webservers              | Port N nutzt Pages selbst. Wähle einen anderen Port.      |
| Port unter 1024 ohne Rechte (`EACCES`) | Port N erfordert höhere Rechte. Wähle einen Port ab 1024. |
| anderer Bindefehler                    | Auf Port N kann Pages nicht lauschen. …                   |
| Konfiguration nicht schreibbar         | Der Port konnte nicht gespeichert werden. …               |

Konnte der gespeicherte Port beim Start nicht gebunden werden (zum Beispiel weil ihn inzwischen ein anderes Programm belegt), läuft Pages normal weiter, schreibt eine Warnung ins Protokoll und die Karte zeigt „Der Endpunkt ist derzeit nicht aktiv“ mit dem Grund. Speichern versucht es erneut.

Der Endpunkt gehört zum Produktionsserver (`pnpm start`); der Vite-Entwicklungsserver bindet ihn beim Start nicht.

## Verbindungsaufbau

```text
App                                           Pages
 |  WebSocket-Handshake  ws://HOST:PORT/pica-mobile
 |--------------------------------------------->|   Pfad ungleich /pica-mobile: HTTP 404
 |                                              |   mehr als 100 Verbindungen:  HTTP 503
 |  {"version":1,"type":"auth", ...}   (binnen 10 s)
 |--------------------------------------------->|
 |  {"version":1,"type":"connected", ...}       |
 |<---------------------------------------------|
 |  {"version":1,"type":"ping", ...}            |
 |--------------------------------------------->|
 |  {"version":1,"type":"pong", ...}            |
 |<---------------------------------------------|
```

Der Handshake verlangt weder Cookies noch Header oder Subprotokoll. Eine Browser- oder App-Herkunft (`Origin`) wird nicht ausgewertet, denn der Endpunkt liest keine Cookies; berechtigt ist allein, wer sich mit einer `auth`-Nachricht ausweist. Ein einfacher HTTP-Aufruf des Ports ohne Upgrade wird mit `426 Upgrade Required` beantwortet. Einzige Ausnahme sind die drei Datei-Endpunkte der Erweiterung `chat.v1` unter `/pica-mobile/chat/attachments` (siehe [Dateien](#dateien)); ohne `chat.v1` antworten auch sie mit 426.

Bis `auth` gelingt, lehnt Pages jede andere Nachricht mit `authentication_required` ab. Wer nicht binnen 10 Sekunden erfolgreich authentifiziert, wird mit Code 1008 getrennt.

## Nachrichtenformat

Jede Nachricht ist ein WebSocket-**Textframe** mit einem JSON-Objekt. Nachrichten des Clients sind höchstens 16 KiB (`16384` Bytes) groß; einzig `chat_send` der Erweiterung `chat.v1` darf nach der Anmeldung bis 128 KiB (`131072` Bytes) groß sein (siehe [Grenzen von chat.v1](#grenzen-von-chatv1)). Die Antworten von Pages unterliegen dieser Grenze nicht (ein `avatar` trägt bis zu 128 KiB Bilddaten). Ausgenommen davon sind die Antworten der Erweiterung `notifications.v1`: der Client beendet die Verbindung bei einem Frame über 16384 UTF-16-Codeeinheiten, deshalb hält Pages sie darunter (siehe [notification_event](#notification_event_get-und-notification_event)). Die Nachrichten `plans` und `plan` der Erweiterung `plans.v1` sind höchstens 262144 UTF-16-Codeeinheiten lang, die Antworten `chat_*` der Erweiterung `chat.v1` höchstens 524288. Binärframes lehnt Pages ab. In beide Richtungen gilt dieselbe Hülle:

```json
{
  "version": 1,
  "type": "auth",
  "requestId": "6f1c2a",
  "payload": {}
}
```

| Feld        | Typ              | Bedeutung                                                                                                                                                        |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | ganze Zahl       | Version des Formats. Pages unterstützt `1`. Eine andere Version wird mit `unsupported_version` abgelehnt.                                                        |
| `type`      | Text             | Nachrichtenart, siehe unten.                                                                                                                                     |
| `requestId` | Text oder `null` | Vom Client gewählte Kennung, 1 bis 64 Zeichen aus Buchstaben, Ziffern, `.`, `_`, `:`, `-`. Die Antwort wiederholt sie. In Fehlerantworten auf Unlesbares `null`. |
| `payload`   | Objekt           | Inhalt der Nachricht; immer ein Objekt, ohne Inhalt `{}`. Unbekannte Felder im Payload werden ignoriert.                                                         |

Pages prüft in dieser Reihenfolge: gültiges JSON-Objekt, `version` ganzzahlig und unterstützt, `requestId` und `type` vorhanden und gültig, `payload` ein Objekt, bekannter `type`, gültiger Payload.

### Client → Pages

**`auth`** weist die Verbindung als Pages-Benutzer aus. Der Payload hat zwei Formen:

```json
{ "version": 1, "type": "auth", "requestId": "a1",
  "payload": { "method": "password", "username": "anna", "password": "…" } }

{ "version": 1, "type": "auth", "requestId": "a2",
  "payload": { "method": "session", "token": "…" } }
```

`username` höchstens 200, `password` höchstens 1000, `token` höchstens 256 Zeichen.

**`ping`** hält die Verbindung wach und misst die Laufzeit. Nur nach erfolgreichem `auth` zulässig.

```json
{ "version": 1, "type": "ping", "requestId": "p1", "payload": {} }
```

### Pages → Client

**`connected`** antwortet auf ein erfolgreiches `auth`:

```json
{
  "version": 1,
  "type": "connected",
  "requestId": "a1",
  "payload": {
    "connectionId": "0d8b7c1e-6f3a-4a52-9c27-2b6a5d6c9e10",
    "user": { "id": "…", "username": "anna", "displayName": "Anna Beispiel" },
    "sessionToken": "…",
    "heartbeat": {
      "intervalMilliseconds": 20000,
      "timeoutMilliseconds": 45000
    },
    "server": {
      "version": "0.1.0",
      "protocolVersions": [1],
      "capabilities": ["dashboard.v1"]
    }
  }
}
```

`sessionToken` ist bei `method: "password"` das neu ausgestellte Sitzungstoken und sonst `null`. Die App speichert das Token im sicheren Speicher des Geräts und meldet sich danach mit `method: "session"` an; das Passwort behält sie nicht.

`server.capabilities` nennt die Erweiterungen von Version 1, die diese Verbindung beantwortet. Pages nennt `dashboard.v1` nur, wenn es den gesamten Vertrag der Erweiterung beantwortet; `notifications.v1`, `notifications.push.fcm` und `notifications.team.v1` folgen eigenen Regeln (siehe [Capabilities](#capabilities)), `plans.v1` nennt Pages nur, wenn es `plans_sync` und `plan_get` beantwortet (siehe [Erweiterung plans.v1](#erweiterung-plansv1)), `plans.flow.v1` nur zusammen mit `plans.v1` (siehe [Erweiterung plans.flow.v1](#erweiterung-plansflowv1)), `chat.v1` nur, wenn es die acht Chat-Anfragen und die Datei-Endpunkte beantwortet (siehe [Erweiterung chat.v1](#erweiterung-chatv1)), `chat.delete` nur zusammen mit `chat.v1` und nur, wenn es `chat_delete` beantwortet (siehe [Erweiterung chat.delete](#erweiterung-chatdelete)). Ein Pages ohne das Feld kennt die Erweiterungen nicht; ein Client behandelt ein fehlendes Feld wie eine leere Liste und fragt dann weder ein Dashboard ab noch registriert er sich für Push.

**`pong`** antwortet auf `ping`:

```json
{
  "version": 1,
  "type": "pong",
  "requestId": "p1",
  "payload": { "serverTime": "2026-10-23T10:00:00.000Z" }
}
```

**`error`** lehnt eine Nachricht oder die Verbindung ab. Fehler sind strukturiert, der Inhalt der abgelehnten Nachricht wird nie zurückgegeben:

```json
{
  "version": 1,
  "type": "error",
  "requestId": "a1",
  "payload": {
    "code": "authentication_failed",
    "message": "The credentials are not valid."
  }
}
```

`message` ist englischer Entwicklertext; die App zeigt eigene Texte zum `code`. Zusatzfelder: `supportedVersions` (bei `unsupported_version`) und `retryAfterSeconds` (bei `too_many_attempts`).

### Fehlercodes

| `code`                     | Wann                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Folge                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `invalid_message`          | kein JSON-Objekt, Pflichtfeld fehlt oder ungültig, Payload ungültig, Binärframe; `avatar_get` mit einer Version, die nicht (mehr) die aktuelle des Kontos ist; `notification_register` mit einer anderen Plattform als `android`, einem anderen Provider als `fcm` oder ungültigem Token, `preview` oder `deviceId`                                                                                                                                            | Verbindung bleibt                                                                    |
| `unsupported_version`      | `version` nicht unterstützt (`supportedVersions` nennt die erlaubten)                                                                                                                                                                                                                                                                                                                                                                                          | Verbindung bleibt                                                                    |
| `unknown_type`             | `type` unbekannt, auch `dashboard_get` und `avatar_get` bei einem Pages ohne `dashboard.v1`, die drei `notification_*`-Anfragen bei einem Pages ohne `notifications.v1`, `notification_settings_get` und `notification_settings_set` bei einem Pages ohne `notifications.team.v1` und `plans_sync` und `plan_get` bei einem Pages ohne `plans.v1`, die acht `chat_*`-Anfragen bei einem Pages ohne `chat.v1`, `chat_delete` bei einem Pages ohne `chat.delete` | Verbindung bleibt                                                                    |
| `authentication_required`  | andere Nachricht als `auth` vor erfolgreicher Authentifizierung                                                                                                                                                                                                                                                                                                                                                                                                | Verbindung bleibt                                                                    |
| `authentication_failed`    | Zugangsdaten oder Sitzungstoken ungültig, Konto deaktiviert; auch bei später beendeter Sitzung, auch als Antwort auf ein `dashboard_get` oder `avatar_get`                                                                                                                                                                                                                                                                                                     | nach 3 Fehlversuchen getrennt; ist die Sitzung beendet, wird die Verbindung getrennt |
| `password_change_required` | das Konto muss in Pages zuerst sein Passwort ändern                                                                                                                                                                                                                                                                                                                                                                                                            | wie `authentication_failed`                                                          |
| `too_many_attempts`        | die Anmeldesperre von Pages greift (`retryAfterSeconds`)                                                                                                                                                                                                                                                                                                                                                                                                       | wie `authentication_failed`                                                          |
| `already_authenticated`    | zweites `auth` auf einer authentifizierten Verbindung                                                                                                                                                                                                                                                                                                                                                                                                          | Verbindung bleibt                                                                    |
| `rate_limited`             | mehr als 30 Nachrichten in 10 Sekunden                                                                                                                                                                                                                                                                                                                                                                                                                         | Verbindung wird getrennt                                                             |
| `server_unavailable`       | Pages kann die Nachricht gerade nicht entscheiden (zum Beispiel vor Abschluss des Setups); `notification_register`, solange Pages keinen verwendbaren FCM-Sender hat                                                                                                                                                                                                                                                                                           | Verbindung bleibt                                                                    |

Fünf abgelehnte Nachrichten in Folge trennen die Verbindung (Code 1008, „Too many rejected messages“); eine gültige Nachricht setzt den Zähler zurück.

## Erweiterung dashboard.v1

Die Erweiterung liefert der angemeldeten App echte Daten des Kontos: Profil, die eigenen aktiven Plan-Läufe und die zugewiesenen Projekte, dazu das Profilbild. Sie folgt dem Vertrag `PM-13-1` des Clients (Pica Mobile, `docs/wire-contract.md`, Revision vom 30.10.2026) in der Fassung des Tickets PAGE-164; offene Abstimmungspunkte stehen am Ende des Abschnitts. Hülle, Authentifizierung, Heartbeat, Rate-Limit und Fehlerregeln von Version 1 gelten unverändert; die Erweiterung führt weder eine zweite Anmeldung noch einen Push- oder Livekanal, Chat oder Plansteuerung ein und liest nur: sie verändert keine fachlichen Daten (die Sitzungsprüfung vermerkt wie bei jeder Nachricht die letzte Nutzung der Sitzung). Die App fragt nach der Anmeldung, beim Wechsel in den Vordergrund, nach einer Wiederverbindung und beim Herunterziehen zum Aktualisieren; ein `dashboard` sendet Pages nie von sich aus. Von sich aus sendet Pages nur die Änderungen der Planliste der Erweiterung [plans.v1](#erweiterung-plansv1).

Pages nennt `dashboard.v1` in `connected.payload.server.capabilities` nur, wenn es den ganzen Vertrag dieses Abschnitts beantwortet; ein Profilbild, das Pages nicht liefern kann, ist dabei kein Ausfall, sondern `avatar: null`. Ein Pages ohne die Erweiterung beantwortet `dashboard_get` und `avatar_get` mit `unknown_type`.

### dashboard_get und dashboard

**`dashboard_get`** (Client → Pages) ist nur nach erfolgreichem `auth` zulässig, sonst gilt `authentication_required`. Der Payload ist `{}`; unbekannte Felder werden ignoriert.

```json
{ "version": 1, "type": "dashboard_get", "requestId": "d1", "payload": {} }
```

**`dashboard`** (Pages → Client) antwortet mit derselben `requestId`, bei einem Fehler antwortet ein `error`:

```json
{
  "version": 1,
  "type": "dashboard",
  "requestId": "d1",
  "payload": {
    "profile": {
      "accountId": "…",
      "displayName": "Anna Beispiel",
      "avatar": {
        "version": "f52bc69469b7abc50445154f71210b98",
        "mimeType": "image/png"
      }
    },
    "runs": {
      "status": "ready",
      "items": [
        {
          "id": "…",
          "planId": "…",
          "name": "Release-Ablauf",
          "ticket": "PAGE-164",
          "startedByAccountId": "…",
          "status": "running",
          "canResume": false,
          "stages": [
            {
              "id": "stage-…",
              "kind": "step",
              "steps": [
                {
                  "id": "…",
                  "number": 2,
                  "name": "Planer",
                  "status": "completed"
                }
              ]
            },
            {
              "id": "stage-…",
              "kind": "parallel",
              "steps": [
                {
                  "id": "…",
                  "number": 3,
                  "name": "Prüfer A",
                  "status": "running"
                },
                {
                  "id": "…",
                  "number": 4,
                  "name": "Prüfer B",
                  "status": "failed"
                }
              ]
            },
            {
              "id": "stage-…",
              "kind": "loop",
              "steps": [
                {
                  "id": "…",
                  "number": 5,
                  "name": "Review-Schleife",
                  "status": "blocked"
                }
              ]
            }
          ]
        }
      ]
    },
    "projects": {
      "status": "ready",
      "items": [
        {
          "id": "…",
          "name": "Alpha",
          "icon": null,
          "assigned": true,
          "progress": { "percent": 40, "completed": 1, "total": 2 }
        },
        {
          "id": "…",
          "name": "Beta",
          "icon": null,
          "assigned": true,
          "progress": null
        }
      ]
    }
  }
}
```

**Abschnitte.** `runs` und `projects` haben je einen `status`: `ready` mit `items` (eine leere Liste heißt: erfolgreich keine Datensätze), `forbidden` (das Konto darf den Abschnitt nicht lesen) oder `error` (Pages kann ihn gerade nicht liefern); die beiden letzten tragen keine `items`. Ein Abschnitt, der nicht lieferbar ist, hindert die übrigen nicht. `profile.accountId` ist immer die Konto-ID der authentifizierten Verbindung.

**Profil.** `avatar` ist `null` oder `{ version, mimeType }`. `null` bedeutet: das Konto hat kein Bild als Avatar gewählt, oder sein Bild ist beschädigt, von einem nicht unterstützten Typ, zu groß zum Dekodieren (mehr als 25 Millionen Pixel) oder lässt sich nicht verkleinern. Das hindert den übrigen Abruf nie.

**Läufe.** Geliefert werden nur laufende, noch nicht beendete Läufe, die das angemeldete Konto selbst gestartet hat (`startedByAccountId` ist immer dieses Konto). Läufe anderer, auch in einem mit dem Konto geteilten Plan oder unter gleichem Plannamen, kommen nie vor; ebenso keine beendeten Läufe (erfolgreich, fehlgeschlagen, abgebrochen) und keine Läufe, deren Plan oder Ressourcen das Konto nicht mehr lesen darf. Jeder Lauf wird mit denselben Prüfungen gelesen wie beim Öffnen auf der Planseite.

- `id` ist die Lauf-ID, `planId` der Plan, `name` der Planname beim Start, `ticket` der Schlüssel des einen Tickets, an dem der Lauf arbeitet; fehlt, wenn der Lauf kein Ticket oder mehrere hat.
- `status` ist `running`, `pausing`, `paused` oder `stopping`. Pages kennt keinen Laufzustand `blocked`, meldet ihn also nie; `completed`, `cancelled` und `failed` kommen nur vor, wenn ein Lauf nicht mehr aktiv ist, und werden dann nicht geliefert.
- `canResume` ist `true` nur bei einem pausierten Lauf, den das Konto jetzt nachweislich fortsetzen darf (eigener Lauf, bearbeitbarer Plan, gültige Fortsetzungsgrenze, Plan und Arbeitsumgebung unverändert benutzbar); sonst `false`.
- `stages` stammt aus dem Schnappschuss des Laufs, also aus der Planversion, die der Lauf ausführt, nicht aus der gespeicherten Plan-Zeichenfläche und nicht aus Array-Positionen. Eine Stufe fasst die Schritte zusammen, die auf derselben Stufe des Ablaufs stehen (längster Weg ab Start): `step` für einen Schritt, `parallel` für mehrere nebeneinander, `loop` für eine Schleife; die Schleife ist dann der eine Schritt der Stufe. Start und Ende sind keine Schritte. `id` einer Stufe ist `stage-` und die ID ihres ersten Schritts.
- `steps[].number` ist die Nummer, die Pages dem Knoten im Ablauf gibt (Start ist Nummer 1, der erste Schritt also 2); sie stimmt mit der Nummerierung auf der Planseite überein. `name` ist der Name des Schritts im Lauf.
- `steps[].status` ist `waiting`, `running`, `paused`, `blocked` (wartet hinter einem fehlgeschlagenen oder abgebrochenen Vorgänger), `completed`, `failed` oder `cancelled`.
- Ergebnisse, Ausgaben, Sitzungen, Prompts, Agent-Parameter und Dateipfade eines Laufs gehören nie zur Antwort.

**Projekte.** Geliefert werden nur Projekte, in denen das Konto Mitglied ist und die es nach seinen aktuellen Rechten lesen darf; ein Projekt, das nur gelesen werden darf, oder eines, dessen Rechte entzogen wurden, kommt nicht vor. Archivierte Projekte kommen nicht vor. `assigned` ist deshalb immer `true`.

- `icon` ist immer `null`: Pages speichert Projektsymbole als Bild, nicht als Namen.
- `progress` ist `{ percent, completed, total }` oder `null`. `percent` ist der in Pages gespeicherte Fortschritt des Projekts in Prozent (ganze Zahl von 0 bis 100), `completed` und `total` zählen die erreichten und alle Ziele des Projekts. Hat das Projekt kein Ziel, gibt es nichts zu zählen und `progress` ist `null`; Pages erfindet weder Nullen noch rechnet es einen Wert aus Ticketzahlen. Der Prozentwert ist der von Hand gepflegte Wert des Projekts und wird nicht aus den Zielen errechnet; er kann deshalb von `completed` und `total` abweichen und weicht von der Projektübersicht des Pages-Dashboards ab, die Ticketzahlen zählt.

### avatar_get und avatar

**`avatar_get`** holt das Bild, das das Dashboard angekündigt hat. Der Payload ist `{ "version": "…" }` (1 bis 64 Zeichen aus Buchstaben, Ziffern, `.`, `_`, `:`, `-`).

**`avatar`** antwortet mit derselben `requestId`:

```json
{
  "version": 1,
  "type": "avatar",
  "requestId": "v1",
  "payload": {
    "version": "f52bc6…",
    "mimeType": "image/png",
    "data": "<Base64>"
  }
}
```

- Es gibt nur das aktuelle Bild des angemeldeten Kontos; eine Konto-ID nimmt die Nachricht nicht entgegen. Die `version` ist ein Digest der gespeicherten Bildbytes: sie ändert sich mit jedem neuen Bild. Nennt `avatar_get` eine andere als die aktuelle Version (auch die eines anderen Kontos), antwortet `invalid_message`; die App holt dann das Dashboard neu.
- `mimeType` ist `image/jpeg`, `image/png` oder `image/webp`, der Typ des gespeicherten Bildes. `data` ist das auf höchstens 256 Pixel Kantenlänge verkleinerte, neu kodierte Bild in Base64, dekodiert höchstens 131072 Bytes; Metadaten wie Aufnahmeorte entfallen. Pages vergrößert nie.
- Es gibt keine öffentliche Bild-Adresse, kein Token in einer Adresse und keine Cookie-Abhängigkeit: das Bild kommt nur über die authentifizierte Verbindung.

### Rechte, Sitzung und Fehler

- Jede Antwort geht von dem Konto aus, zu dem die Sitzung jetzt gehört, und liest Projekte, Läufe und Bild über die Dienste, die die aktuellen Rechte anwenden. Frühere Antworten oder ein Zwischenspeicher der App gelten nichts.
- Ist die Sitzung beendet oder das Konto deaktiviert, antwortet Pages auf das `dashboard_get` oder `avatar_get` mit `authentication_failed` (mit der `requestId` der Anfrage) und trennt mit Code 1008 („Session ended“), wie bei der regelmäßigen Prüfung.
- Kann Pages eine Anfrage gar nicht beantworten (zum Beispiel wegen einer Störung der Datenbank), antwortet es mit `server_unavailable` und derselben `requestId`; die Verbindung bleibt.
- Anfragen laufen in der Reihenfolge ihres Eintreffens; die Antworten tragen die `requestId` ihrer Anfrage. Wie bei jeder Nachricht zählen sie zum Rate-Limit (30 in 10 Sekunden), zu den höchstens 8 unerledigten Nachrichten und, wenn sie abgelehnt werden, zu den fünf abgelehnten Nachrichten in Folge; eine erfolgreiche Antwort setzt diesen Zähler zurück.

### Abstimmung mit PM-13-1

Das Vertragsdokument des Clients lag bei der Umsetzung in Pages nicht vor; die Erweiterung folgt der Beschreibung im Ticket PAGE-164. Wo der Vertrag Spielraum lässt, hat Pages die kleinste mögliche Abbildung gewählt. Diese Entscheidungen muss der Client bestätigen:

| Punkt                                                 | Entscheidung von Pages                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Fehler bei unbekannter oder veralteter Avatar-Version | `invalid_message`; kein neuer Fehlercode                                      |
| Laufzustand `blocked`                                 | wird nie gesendet, Pages hat keinen solchen Laufzustand                       |
| `completed`, `cancelled`, `failed` bei Läufen         | werden nie gesendet, nur aktive Läufe kommen vor                              |
| Schrittzustand                                        | `waiting`, `running`, `paused`, `blocked`, `completed`, `failed`, `cancelled` |
| Start und Ende des Ablaufs                            | sind keine Schritte; die Nummern behalten die Zählung der Planseite           |
| Schleife (Dashboard)                                  | eine Stufe `loop` mit der Schleife als einem Schritt, ohne ihre Mitglieder    |
| `icon` eines Projekts                                 | immer `null`                                                                  |
| `progress` eines Projekts                             | gespeicherte Prozent plus Ziele; `null` ohne Ziele                            |
| `ticket` eines Laufs                                  | nur bei genau einem Ticket                                                    |

## Erweiterung plans.v1

Die Erweiterung liefert der angemeldeten App eine kompakte Liste der Agent-Pläne, die das Konto betreffen, jeweils mit dem neuesten eigenen Lauf: laufende, pausierte und fehlgeschlagene Läufe ebenso wie beendete. Nach dem ersten vollständigen Stand überträgt Pages nur noch Änderungen und sendet sie bei einer Laufänderung auch von sich aus. Sie folgt dem Ticket PAGE-200; der Vertrag gilt für Pages und Pica Mobile wortgleich. Hülle, Authentifizierung, Heartbeat, Rate-Limit und Fehlerregeln von Version 1 gelten unverändert; `dashboard_get` bleibt unverändert, ältere App-Versionen funktionieren also weiter. Die Erweiterung liest nur und kennt weder Aktionen an Plänen noch Chat.

Pages nennt `plans.v1` in `connected.payload.server.capabilities` nur, wenn die Verbindung `plans_sync` und `plan_get` beantwortet. Ohne die Fähigkeit beantwortet Pages beide Nachrichten mit `unknown_type`. Beide sind nur nach erfolgreichem `auth` zulässig, sonst gilt `authentication_required`.

Die App fragt im Vordergrund weiterhin alle 10 Sekunden mit `plans_sync` ab. Das bleibt als Sicherheitsnetz nötig: Pages meldet von sich aus nur Änderungen eines Laufs, nicht aber Umbenennen oder Löschen eines Plans und keine entzogenen Rechte.

### Welche Pläne und welcher Lauf

- Zur Liste gehören die Pläne, die das Konto jetzt lesen darf und die zusätzlich eine dieser Bedingungen erfüllen: eigener Plan oder Plan des eigenen Teams (beides zusammen ist das Bearbeitungsrecht, `canEdit`), oder es gibt einen eigenen Lauf des Kontos. Global oder anderweitig geteilte Pläne ohne eigenen Lauf gehören nicht dazu.
- Je Plan zählt nur der neueste **eigene** Lauf. Führt nur ein Kollege einen Team-Plan aus, steht der Plan auf `idle`. Läufe anderer Personen liest Pages für diese Erweiterung nie und überträgt sie nie; ein Lauf ist weiterhin nur für die Person lesbar, die ihn gestartet hat.

### plans_sync und plans

**`plans_sync`** (App → Pages) nennt die `seq` der letzten `plans`-Nachricht, die die App übernommen hat:

```json
{
  "version": 1,
  "type": "plans_sync",
  "requestId": "s1",
  "payload": { "since": null }
}
```

`since` ist `null` oder eine ganze Zahl ab 1; ein anderer Wert ergibt `invalid_message`.

**`plans`** (Pages → App) antwortet mit der `requestId` der Anfrage oder kommt von Pages aus mit `requestId: null`:

```json
{
  "version": 1,
  "type": "plans",
  "requestId": null,
  "payload": {
    "seq": 412,
    "plans": [
      {
        "id": "p7",
        "status": "running",
        "step": "Review",
        "done": 3,
        "total": 7
      }
    ],
    "removed": ["p2"]
  }
}
```

| Fall                                                                | Nutzlast                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `since` ist `null` oder ungleich der aktuellen `seq` der Verbindung | `{ "seq": n, "full": true, "plans": [vollständige Zeilen] }`; die App ersetzt ihre Liste                                                                   |
| `since` gleich der aktuellen `seq`, keine Änderung                  | nur `{ "seq": n }` mit derselben `seq`                                                                                                                     |
| `since` gleich der aktuellen `seq`, Änderungen vorhanden            | `{ "seq": n+1, "plans"?: [...], "removed"?: [...] }`                                                                                                       |
| Von Pages ausgelöst                                                 | wie die Änderungszeile, nur wenn sich etwas geändert hat, frühestens nach dem ersten beantworteten `plans_sync` der Verbindung, höchstens einmal je 300 ms |

- `seq` gilt je Verbindung und steigt mit jeder nicht leeren `plans`-Nachricht um 1; jeder volle Stand ist eine solche Nachricht. Eine neue Verbindung beginnt mit `since: null`, ihr erster voller Stand hat `seq` 1.
- Empfängt die App von Pages ausgelöst eine `seq` ungleich ihrer letzten plus 1, sendet sie `plans_sync` mit `since: null`.
- Antwort und von Pages ausgelöste Nachricht entstehen aus demselben Vergleich mit den zuletzt gesendeten Zeilen der Verbindung und laufen in derselben Reihenfolge wie die übrigen Nachrichten; nichts wird doppelt gesendet.
- Pages überträgt keine Reihenfolge, die App sortiert selbst (siehe unten).

**Zeile.** Eine neue oder vollständige Zeile enthält alle Felder mit Wert. Eine Änderung enthält `id` und nur die geänderten Felder; der Wert `null` bedeutet, dass das Feld weggefallen ist.

| Feld            | Inhalt                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Plan-ID, höchstens 200 Zeichen                                                                                                                       |
| `name`          | Planname, höchstens 200 Zeichen, sonst gekürzt                                                                                                       |
| `status`        | `idle`, `running`, `pausing`, `paused`, `stopping`, `completed`, `failed` oder `cancelled`; `idle` heißt: kein lesbarer eigener Lauf                 |
| `runId`         | ID des eigenen Laufs; fehlt bei `idle`                                                                                                               |
| `step`          | Namen der gerade laufenden Schritte, mit `, ` verbunden, höchstens 200 Zeichen; fehlt, wenn keiner läuft                                             |
| `done`, `total` | erfolgreich erledigte und alle Schritte des Laufs (ganze Zahlen ≥ 0), ohne Start, Ende, Entscheidungen und übersprungene Schritte; fehlen bei `idle` |
| `error`         | `{ "code": <Text oder null>, "step": <Text oder null> }`; nur vorhanden, wenn ein Schritt oder der Lauf fehlgeschlagen ist                           |
| `at`            | ISO-8601-Zeit: Ende des Laufs, sonst sein Start; fehlt bei `idle`                                                                                    |

`error.code` ist nur ein maschineller Code nach `^[a-z][a-z0-9_.:-]{0,99}$` (derselbe Code wie `reason` der Benachrichtigungen). Jeder andere Fehlerinhalt ergibt `null`, damit Pfade oder Provider-Ausgaben nie übertragen werden. `error.step` ist der höchstens 200 Zeichen lange Name des ersten fehlgeschlagenen Schritts, `null`, wenn nur der Lauf fehlschlug. Zeichenangaben sind UTF-16-Codeeinheiten; ein gekürzter Text endet nie mit einem halben Zeichen.

**Reihenfolge.** Die App sortiert in diese Klassen:

1. `running`, `pausing` oder `stopping` mit `error`
2. `running`, `pausing` oder `stopping`
3. `paused`
4. `failed`
5. alle übrigen

Innerhalb jeder Klasse gilt `at` absteigend und danach `name`; Zeilen ohne `at` stehen zuletzt.

**Obergrenzen.** Eine Verbindung hält höchstens 200 Zeilen, ausgewählt in der obigen Reihenfolge. Fällt eine Zeile dadurch heraus, steht sie in `removed`. `plans` und `plan` sind Text-Frames von höchstens 262144 UTF-16-Codeeinheiten; würde ein `plans` länger, lässt Pages weitere Zeilen vom Ende der Reihenfolge weg, bis es passt, und behandelt sie wie Zeilen über der Zeilengrenze.

### plan_get und plan

**`plan_get`** (App → Pages) fragt nach dem neuesten eigenen Lauf eines Plans, mit dessen Stufen:

```json
{
  "version": 1,
  "type": "plan_get",
  "requestId": "g1",
  "payload": { "planId": "p7" }
}
```

`planId` ist 1 bis 200 Zeichen lang.

**`plan`** (Pages → App) antwortet mit derselben `requestId`:

```json
{ "version": 1, "type": "plan", "requestId": "g1", "payload": { "planId": "p7", "access": "ok", "run": { "id": "…", "planId": "p7", "name": "Release-Ablauf", "startedByAccountId": "…", "status": "failed", "canResume": false, "stages": [] } } }

{ "version": 1, "type": "plan", "requestId": "g2", "payload": { "planId": "p2", "access": "gone" } }
```

- `run` hat dieselbe Form wie ein Eintrag aus `dashboard.runs.items` (`id`, `planId`, `name`, optional `ticket`, `startedByAccountId`, `status`, `canResume`, `stages`) und gilt auch für beendete Läufe; `status` kann deshalb auch `completed`, `failed` oder `cancelled` sein.
- `run: null` heißt: Der Plan gehört zur Liste, aber es gibt keinen lesbaren eigenen Lauf.
- `gone` heißt: Der Plan gehört nicht oder nicht mehr zur Liste des Kontos, nach derselben Regel wie `plans`.
- Wäre ein `plan` länger als 262144 Codeeinheiten, kürzt Pages Lauf- und Schrittnamen auf 200 Zeichen; passt es dann immer noch nicht, antwortet Pages mit `server_unavailable`.

### Rechte, Sitzung, Aktualität und Fehler

- Jede Anfrage und jeder von Pages ausgelöste Lesevorgang prüft zuerst die Sitzung. Ist sie beendet oder das Konto deaktiviert, antwortet Pages mit `authentication_failed` (bei einer Anfrage mit deren `requestId`, sonst `null`) und trennt mit Code 1008 („Session ended“).
- Die Planrechte gelten bei **jedem** Lesevorgang: Ein gelöschter Plan oder ein entzogenes Planrecht fällt mit der nächsten Abfrage heraus.
- Den Lauf selbst liest Pages mit denselben Prüfungen wie beim Öffnen auf der Planseite (Ticket, Wiki-Seite, Modell, Arbeitsumgebung). Damit nicht jede Abfrage alle Läufe neu prüft, merkt sich Pages je Verbindung das Ergebnis dieser Prüfung und wiederholt sie nur, wenn der Lauf seit der letzten Prüfung geschrieben wurde oder die Prüfung mehr als 60 Sekunden zurückliegt; abgelaufene Prüfungen holt ein Lesevorgang für höchstens 20 Läufe nach, die ältesten zuerst. Die 60 Sekunden entsprechen der regelmäßigen Sitzungsprüfung der Verbindung. **Der Entzug eines einzelnen Rechts an einem Ticket, einer Wiki-Seite oder einem Modell wird also spätestens nach rund 60 Sekunden wirksam.**
- Scheitert die Prüfung eines Laufs an fehlenden Rechten, steht der Plan auf `idle`, oder er fällt heraus, wenn er nur über diesen Lauf zur Liste gehörte. Kann Pages dagegen nicht lesen (zum Beispiel wegen einer Störung der Datenbank), ist das kein Rechteverlust: Die Anfrage erhält `server_unavailable` mit ihrer `requestId`, und der bisherige Stand der Verbindung (`seq` und zuletzt gesendete Zeilen) bleibt.
- Pages liest von sich aus neu, sobald ein bestätigter Schreibvorgang eines eigenen Laufs etwas ändert, das eine Zeile oder die Ablaufstruktur von [plans.flow.v1](#erweiterung-plansflowv1) zeigt: den Laufstatus, das Ende, den Status eines Schritts (samt Wiederholung und gewähltem Zweig einer Entscheidung), den Zustand einer Schleife, ihrer Iterationen und der Knoten darin, den Steuerungsfehler oder den Fehlercode. Seit PAGE-281 zählt also auch eine Änderung nur innerhalb einer laufenden Schleife; reine Fortschrittsmeldungen lösen nichts aus. Gesendet wird nur, was sich an den Zeilen der Verbindung ändert: Eine Verbindung ohne `flow` erhält für eine Änderung, die nur in der Schleife liegt, deshalb weiterhin nichts. Ein Laufstart wird mit dem ersten Schreibvorgang des Laufs gemeldet, spätestens findet ihn die nächste Abfrage. Pages wartet nach einer Änderung 300 ms auf weitere und liest dann einmal; ändert sich an den Zeilen nichts, sendet es nichts. Scheitert dieser Lesevorgang, protokolliert Pages das und sendet nichts; die nächste Abfrage holt es nach. Diese Lesevorgänge zählen weder zum Rate-Limit noch zu den unerledigten Nachrichten der App.
- Anfragen zählen wie jede Nachricht zum Rate-Limit (30 in 10 Sekunden), zu den höchstens 8 unerledigten Nachrichten und, wenn sie abgelehnt werden, zu den fünf abgelehnten Nachrichten in Folge.
- Dauert ein Lesevorgang der Planliste 500 ms oder länger, schreibt Pages `pica_mobile.plans.slow` mit Dauer und Zeilenzahl ins Protokoll.
- **Klartext.** Plannamen, Schrittnamen und Fehlercodes laufen wie alle Nachrichten von Version 1 über `ws://` im Klartext durch das Netz (siehe [Sicherheit](#sicherheit)). Fehlertexte, Prompts, Ausgaben, Pfade und Sitzungsdaten enthält der Vertrag nicht.

## Erweiterung plans.flow.v1

Die Erweiterung (PAGE-281) ergänzt [plans.v1](#erweiterung-plansv1) um die vollständige Ablaufstruktur eines Laufs, so wie Pages sie für genau diesen Lauf ausführt, und um einen Zustandsschlüssel, an dem die App erkennt, dass sich daran etwas geändert hat. Sie ist **opt-in**: Nur wer in einer Anfrage `flow: true` mitschickt, bekommt die neuen Felder. Eine App, die die Erweiterung nicht kennt, erhält jede Nachricht von `plans.v1` und `dashboard.v1` Byte für Byte wie bisher, also weder ein neues Pflichtfeld noch einen neuen Enum-Wert in `stages`, `steps[].status` oder den Zeilen. Pages nennt `plans.flow.v1` in `connected.payload.server.capabilities` nur zusammen mit `plans.v1`. Ein Pages ohne die Erweiterung ignoriert das unbekannte Feld `flow` (siehe [Nachrichtenformat](#nachrichtenformat)) und antwortet wie bisher; die App erkennt das am Fehlen von `run.flow` und von `state` in den Zeilen.

### Anfragen

- **`plans_sync`** mit `{ "since": …, "flow": true }`: Ab dieser Antwort trägt jede Zeile mit Lauf zusätzlich `state`. Es gilt der Wert der jeweils letzten `plans_sync` der Verbindung; auch die Änderungen, die Pages von sich aus sendet, folgen ihm. Wechselt der Wert, kommen die Schlüssel als geänderte Felder (bzw. `state: null`) wie jede andere Änderung, weil Pages immer gegen die zuletzt gesendeten Zeilen vergleicht.
- **`plan_get`** mit `{ "planId": "…", "flow": true }`: `run` trägt zusätzlich `flow`. Ohne `flow` hat `run` genau die Form von `plans.v1`.
- `flow` ist optional und muss, wenn vorhanden, ein Boolean sein; ein anderer Wert ergibt `invalid_message`.

### Zustandsschlüssel `state` in der Zeile

| Feld    | Inhalt                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state` | 16 Hexadezimalzeichen; nur mit `flow`, fehlt bei `idle`. Gleicher Wert heißt gleicher sichtbarer Zustand des Laufs, ein anderer Wert heißt: Die Ablaufstruktur dieses Laufs hat sich geändert. |

Der Schlüssel ändert sich genau dann, wenn sich etwas ändert, das `flow` zeigt: Laufstatus, Ende, Status, Wiederholung oder gewählter Zweig eines Knotens, Zustand, aufgelöste Anzahl oder Ende einer Schleife, eine neue Iteration oder der Status einer Iteration oder eines Knotens darin, Steuerungsfehler oder Fehlercode. Reine Fortschrittsmeldungen ändern ihn nicht. Er ist kein Zähler und trägt keine Reihenfolge, nur Gleichheit.

### `run.flow` in `plan`

```json
{
  "revision": 57,
  "state": "32a56c667e920286",
  "startedAt": "2026-11-09T10:00:00.000Z",
  "progress": { "done": 1, "total": 4 },
  "stages": [
    {
      "id": "stage-start",
      "nodes": [
        {
          "id": "start",
          "kind": "start",
          "number": 1,
          "status": "completed",
          "counted": false
        }
      ]
    },
    {
      "id": "stage-A",
      "nodes": [
        {
          "id": "A",
          "kind": "agent",
          "number": 2,
          "name": "Planer",
          "status": "completed",
          "counted": true
        }
      ]
    },
    {
      "id": "stage-D",
      "nodes": [
        {
          "id": "D",
          "kind": "decision",
          "number": 3,
          "status": "completed",
          "branch": "true",
          "counted": false
        }
      ]
    },
    {
      "id": "stage-C",
      "nodes": [
        {
          "id": "C",
          "kind": "agent",
          "number": 4,
          "name": "Fixer",
          "status": "skipped",
          "counted": false
        },
        {
          "id": "L",
          "kind": "loop",
          "number": 5,
          "name": "Review-Schleife",
          "status": "running",
          "counted": true,
          "loop": {
            "count": { "limit": 3, "mode": "max" },
            "stages": [
              {
                "id": "stage-M1",
                "nodes": [
                  {
                    "id": "M1",
                    "kind": "agent",
                    "name": "Reviewer",
                    "counted": false
                  }
                ]
              },
              {
                "id": "stage-M2",
                "nodes": [
                  {
                    "id": "M2",
                    "kind": "script",
                    "name": "Tests",
                    "counted": false
                  }
                ]
              }
            ],
            "iterationCount": 2,
            "iterations": [
              {
                "id": "L#1",
                "number": 1,
                "status": "completed",
                "nodes": [
                  { "id": "M1", "status": "completed" },
                  { "id": "M2", "status": "completed" }
                ]
              },
              {
                "id": "L#2",
                "number": 2,
                "status": "running",
                "nodes": [
                  { "id": "M1", "status": "completed" },
                  { "id": "M2", "status": "running" }
                ]
              }
            ]
          }
        }
      ]
    },
    {
      "id": "stage-P1",
      "nodes": [
        {
          "id": "P1",
          "kind": "script",
          "number": 6,
          "name": "Lint",
          "status": "waiting",
          "counted": true
        },
        {
          "id": "P2",
          "kind": "script",
          "number": 7,
          "name": "Build",
          "status": "waiting",
          "counted": true
        }
      ]
    },
    {
      "id": "stage-end",
      "nodes": [
        {
          "id": "end",
          "kind": "end",
          "number": 8,
          "status": "waiting",
          "counted": false
        }
      ]
    }
  ]
}
```

**Struktur.** `stages` stammt aus dem privaten Schnappschuss des Laufs, also aus der Planversion, die dieser Lauf ausführt; eine spätere Änderung des Plans im Editor ändert die Darstellung eines älteren Laufs nie. Eine Stufe fasst die Knoten auf derselben Stufe des Ablaufs zusammen (längster Weg ab Start über die Flusskanten, wie die Nummerierung der Planseite); mehrere Knoten in einer Stufe laufen nebeneinander. Die erste Stufe ist Start, die letzte Ende. Innerhalb einer Stufe sind die Knoten nach ID sortiert, wie auf der Planseite. `id` einer Stufe ist `stage-` und die ID ihres ersten Knotens. Knoten, die die Planseite nicht nummeriert (nicht von Start erreichbar), fehlen auch hier. Gruppen erscheinen wie im Lauf als ihre einzelnen Agenten.

**Knoten.**

| Feld      | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | Knoten-ID der ausgeführten Planversion; stabil über alle Antworten zu diesem Lauf                                                                                                                                                                                                                                                                                                                                                     |
| `kind`    | `start`, `end`, `agent`, `script`, `closeout` (Git-Abschluss), `decision`, `stack` oder `loop`. Die App zeigt eine unbekannte Art als einfachen Knoten, denn spätere Versionen der Erweiterung dürfen Arten ergänzen                                                                                                                                                                                                                  |
| `number`  | Nummer im Ablauf wie auf der Planseite (Start ist 1, Ende die letzte); fehlt bei Knoten innerhalb einer Schleife                                                                                                                                                                                                                                                                                                                      |
| `name`    | Name im Lauf; fehlt bei Start, Ende und einer Entscheidung ohne eigenen Namen (die App beschriftet sie selbst)                                                                                                                                                                                                                                                                                                                        |
| `status`  | `waiting`, `running`, `paused`, `blocked` (wartet hinter einem fehlgeschlagenen oder abgebrochenen Vorgänger), `completed`, `failed`, `cancelled` oder `skipped` (liegt auf einem Zweig, den eine Entscheidung nicht genommen hat; lief nie). Fehlt in den `stages` einer Schleife und, wenn der Lauf für den Knoten nichts aufgezeichnet hat; Pages erfindet dann keinen Zustand. Die App zeigt einen unbekannten Wert wie `waiting` |
| `counted` | ob `progress` den Knoten zählt                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pass`    | welcher Start des Knotens `status` beschreibt; nur vorhanden, wenn der Knoten mehr als einmal gestartet wurde (Wiederholung über ein Ereignis)                                                                                                                                                                                                                                                                                        |
| `branch`  | bei einer Entscheidung der Ausgang ihres aktuellen Starts, `"true"` oder `"false"`                                                                                                                                                                                                                                                                                                                                                    |
| `loop`    | nur bei `kind: "loop"`, siehe unten                                                                                                                                                                                                                                                                                                                                                                                                   |

**Schleifen.** `loop.stages` sind die Knoten einer Iteration (Mitglieder und die Stacks, die die Schleife je Iteration auslöst), nach ihrer Stufe innerhalb der Iteration gruppiert, ohne eigenen Zustand. `loop.iterations` sind die Iterationen, die die Schleife **tatsächlich gestartet** hat, älteste zuerst, je mit `id` (`<Schleifen-ID>#<Nummer>`, wie in Pages), `number` (ab 1), `status` und den Knoten mit ihrem Zustand in dieser Iteration in der Reihenfolge von `loop.stages`. Den Zustand der laufenden Iteration zeigt die letzte. Pages listet keine geschätzte oder künftige Iteration. `loop.count` ist die einmal beim Start der Schleife aufgelöste Anzahl (`limit`) mit `mode` `max` (höchstens, kann früher enden), `expected` (genau) oder `while` (`limit` ist dann nur die Obergrenze); es fehlt, bevor die Schleife gestartet ist. `loop.completion` nennt den regulären Abschluss (`count_reached`, `condition_met`, `while_false`) und fehlt sonst. `loop.iterationCount` zählt alle gestarteten Iterationen; `iterations` enthält höchstens die neuesten 100 (siehe Grenzen).

**Fortschritt.** `progress.done` und `progress.total` sind genau die Zahlen `done` und `total` der Zeile: erfolgreich erledigte und alle Knoten mit `counted: true`. Gezählt werden Agenten, Scripts, Git-Abschluss und Schleifen der äußeren Ebene; eine Schleife zählt einmal, egal wie viele Iterationen und Mitglieder sie hat. Start, Ende, Entscheidungen, Stacks, Knoten innerhalb einer Schleife und übersprungene Knoten zählen nie. Darstellung (`stages`) und Zählung (`counted`, `progress`) sind damit getrennt, und nichts wird doppelt gezählt.

**Weitere Felder.** `startedAt` und, nach dem Ende, `endedAt` sind ISO-8601-Zeiten des Laufs. `error` hat die Form von `error` der Zeile (`code` nur als maschineller Code, `step` als Name des ersten fehlgeschlagenen Schritts) und ist nur vorhanden, wenn ein Schritt oder der Lauf fehlschlug.

### Aktualität, Reihenfolge und Wiederverbindung

- `revision` steigt mit jedem bestätigten Schreibvorgang des Laufs. Pages liest sie vor dem Lauf, der gelieferte Zustand ist also mindestens so neu wie die Zahl. Die App ersetzt einen gehaltenen `flow` desselben Laufs nur durch einen mit gleicher oder höherer `revision`; eine niedrigere ist veraltet und wird verworfen. Die Zahl gilt je Lauf; ein neuer Lauf (andere `run.id`) ersetzt den alten immer.
- **Laufende Anzeige.** Solange die App einen Lauf zeigt, vergleicht sie `state` der Zeile mit `flow.state`. Weicht er ab, fragt sie `plan_get` mit `flow: true` neu. Die Zeilenänderung kommt von Pages aus (höchstens alle 300 ms, siehe [Rechte, Sitzung, Aktualität und Fehler](#rechte-sitzung-aktualität-und-fehler)) und deckt auch Änderungen nur innerhalb einer Schleife, neue Iterationen und Endzustände ab. Pages sendet `plan` nie von sich aus.
- **Verpasste Ereignisse und Wiederverbindung.** Eine neue Verbindung beginnt mit `plans_sync` `{ "since": null, "flow": true }` und erhält den vollen Stand mit dem aktuellen `state` jeder Zeile; eine Lücke in `seq` behandelt die App wie bisher mit `since: null`. Danach fragt sie für einen angezeigten Lauf `plan_get` mit `flow: true` und ersetzt ihren Stand vollständig. Da jede Antwort den ganzen Lauf beschreibt und keine Teiländerung, führt jede Antwort wieder zu einem vollständigen, aktuellen Stand; die 10-Sekunden-Abfrage bleibt das Sicherheitsnetz.

### Rechte und Datenschutz

Es gelten unverändert die Regeln von `plans.v1`: nur eigene Läufe des Kontos, jede Anfrage prüft Sitzung und Planrechte, der Lauf wird mit denselben Prüfungen wie auf der Planseite gelesen, Läufe anderer Personen und fremde Pläne kommen nie vor (`gone`). `flow` enthält nur IDs, Arten, Nummern, Namen, Zustände, Zeiten und maschinelle Codes. Prompts und Anweisungen, Agent- und Script-Parameter, Script-Inhalte, Ausgaben und Ergebnisse, Fehlertexte, Sitzungen, Modelle, Arbeitsumgebungen und Dateipfade gehören nie dazu.

### Grenzen

- `plan` bleibt höchstens 262144 UTF-16-Codeeinheiten lang. Wäre es länger, kürzt Pages zuerst alle Namen auf 200 Zeichen, behält dann je Schleife nur die neuesten 20, 5, 1 und schließlich keine Iteration; `iterationCount` nennt weiter alle, die App erkennt die Kürzung also an `iterations.length < iterationCount`. Passt es dann immer noch nicht, antwortet Pages mit `server_unavailable`.
- Je Schleife listet `flow` höchstens die neuesten 100 Iterationen.
- `dashboard` trägt kein `flow`; seine `stages` bleiben die kompakte Form von `dashboard.v1`.
- Eine Schleife in einer Schleife gibt es in Pages nicht; `loop.stages` enthält deshalb nie eine weitere Schleife.
- Gruppen werden nicht als eigener Rahmen übertragen, nur ihre Agenten.

### Abnahme

Pages ist über ein isoliertes Pages mit eigener Datenbank auf einem freien Loopback-Port geprüft (Capability, Anfragen mit und ohne `flow`, Ablehnung eines falschen `flow`) und über einen gezielten Einzeltest der Abbildung mit einem Lauf aus Start, Entscheidung mit übersprungenem Zweig, Schleife mit Iterationen, parallelen Scripts und Ende (Änderungen nur in der Schleife, neue Iteration, Endzustand, Wiederverbindung, Framegrenze). Eine Abnahme mit der App Pica Mobile gegen einen echten Lauf steht aus, bis die App die Erweiterung umsetzt, und wird gesondert dokumentiert.

## Erweiterung chat.v1

Die Erweiterung lässt die App mit Pica chatten, und zwar in **denselben Unterhaltungen** wie den Web-Chat. Sie folgt dem Ticket PAGE-201; der Vertrag gilt für Pages und Pica Mobile wortgleich. Hülle, Authentifizierung, Heartbeat, Rate-Limit und Fehlerregeln von Version 1 gelten unverändert; `dashboard_get`, `avatar_get` und die übrigen Erweiterungen bleiben unverändert. Antworten laufen wie im Web über den ACP-Pfad von Pica und laufen ohne die App auf dem Server weiter; Kompaktieren und Chat-Befehle bleiben dem Web vorbehalten; das Löschen einer Unterhaltung ergänzt die Erweiterung [chat.delete](#erweiterung-chatdelete). Pages sendet für den Chat nichts von sich aus, jede Antwort trägt die `requestId` ihrer Anfrage.

**Synchron mit dem Web.** Die App fragt im offenen Chat alle 3 Sekunden `chat_state` ab und lädt die Unterhaltung nur bei einer Abweichung neu. Der Web-Chat tut dasselbe mit dem Intent `sessionState` der Route `/chat-api`, solange das Panel offen, die Seite sichtbar und keine eigene Sendung unterwegs ist; Eingabetext und noch nicht gesendete Anhänge bleiben dabei stehen, und eine nicht mehr vorhandene Unterhaltung weicht der zuletzt benutzten.

### Anfragen und Antworten

| App → Pages        | Nutzlast                                              | Antwort                                                                          |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `chat_open`        | `{}`                                                  | `chat_view` mit `attachmentLimitBytes`; zuletzt benutzte Unterhaltung            |
| `chat_new`         | `{}`                                                  | `chat_view` einer neuen, leeren Unterhaltung                                     |
| `chat_sessions`    | `{}`                                                  | `chat_sessions`                                                                  |
| `chat_session_get` | `{ sessionId, before? }`                              | `chat_view`; `before` ist eine Nachrichten-ID und liefert die ältere Seite davor |
| `chat_state`       | `{ sessionId }`                                       | `chat_state`                                                                     |
| `chat_send`        | `{ sessionId, clientMessageId, text, attachmentIds }` | `chat_sent`                                                                      |
| `chat_job_get`     | `{ sessionId, jobId, after }`                         | `chat_job`                                                                       |
| `chat_stop`        | `{ sessionId }`                                       | `chat_stopped`                                                                   |

**`chat_view`:** `{ session, messages, hasOlder, pending, job, steers }`

- `session`: `{ id, createdAt, lastMessageAt, preview }`
- `messages`: älteste zuerst, je Seite die neuesten 30, höchstens 400000 Zeichen Inhalt. Eine einzelne Nachricht wird immer geliefert. `hasOlder` sagt, ob es ältere Nachrichten gibt; `chat_session_get` mit `before` (ID der ältesten gelieferten Nachricht) liest die Seite davor. Eine unbekannte `before`-ID ergibt `chat_failed` `invalidInput`.
- Nachricht: `{ id, role, content, createdAt, attachments, isStopped? }`. Passt `content` nicht in den Frame, wird der Text gekürzt und `isCut: true` gesetzt.
- Anhang: `{ id, fileName, contentType, size, origin? }`; `origin: "assistant"` kennzeichnet eine Datei von Pica.
- `pending`: hochgeladene, noch nicht gesendete Anhänge
- `job`: `{ id, state, errorCode }` oder `null`, der neueste Job; `state` ist `running`, `completed`, `failed`, `stopped` oder `interrupted`
- `steers`: `[{ messageId, status }]`; `status` ist `pending`, `delivered`, `accepted`, `followUp` oder `failed`

**`chat_sessions`:** `{ sessions: [{ id, lastMessageAt, preview }] }`, neueste zuerst, höchstens 200, `preview` höchstens 120 Zeichen.

**`chat_state`:** `{ sessionId, lastMessageAt, jobId, jobState }`; ohne Job sind die letzten beiden `null`. Pages liest dafür nur die Unterhaltung und ihren neuesten Job, weder Nachrichten noch Journal.

**`chat_send`:** `clientMessageId` ist eine UUID, die eine Wiederholung derselben Nachricht unverändert behält; Pages speichert eine wiederholte Nachricht nicht doppelt, sondern meldet den Job oder Steer, den sie beim ersten Mal ergab. `text` hat höchstens 20000 Zeichen (sonst `chat_failed` `messageTooLong`), `attachmentIds` höchstens 10 Einträge. Vor dem Senden schützt Pages den Host aus dem Handshake (`http://<Host>`) wie die Web-Route ihren Origin: Picas Browser erreicht diese Adresse nicht. Ein ungültiger `Host` wird übersprungen.

**`chat_sent`:** `{ kind: "job", messageId, jobId }` oder `{ kind: "steer", messageId, jobId, status }`. Eine direkte Antwort ohne Job kann im Produktionspfad nicht vorkommen und ergibt `server_unavailable`; einmalige Quittungen wie temporäre Passwörter erreichen die App nie.

**`chat_job`:** `{ jobId, state, errorCode, cursor, hasMore, events }` oder `{ jobId: null }`, wenn es keinen Job gibt. `after` ist der letzte `cursor`, beim ersten Lesen `0`. `events` enthält nur diese Arten, je `{ sequence, event }`:

| `kind`   | Felder                                                             |
| -------- | ------------------------------------------------------------------ |
| `turn`   | `turn`, `origin` (`message` oder `followUp`), optional `startedAt` |
| `text`   | `turn`, `isReset`, `delta`                                         |
| `steer`  | `messageId`, `status`                                              |
| `answer` | `turn`, `messageId`                                                |
| `end`    | `state`, `errorCode`                                               |

Andere Journal-Einträge überträgt Pages nicht, `cursor` zählt sie trotzdem mit. Eine Seite hat höchstens 200 Einträge und höchstens 200000 Zeichen, sonst ist `hasMore` `true`.

**`chat_stopped`:** `{ sessionId }`. Der Job der eigenen Unterhaltung wird gestoppt; das Schließen der App stoppt nichts.

**`chat_failed`:** Antwort auf eine fachlich abgelehnte Chat-Anfrage: `{ code }`. `code` ist ein Wert von `ChatErrorCode`, zum Beispiel `sessionMissing`, `disabled`, `credentialsInText`, `messageTooLong`, `messageAlreadySent` oder `acpProviderUnsupported`. Texte kommen nicht von Pages. Die vorhandenen Codes der Hülle (`invalid_message`, `authentication_required`, `unknown_type`, `rate_limited`, `server_unavailable`) gelten weiter; andere Fehler als `ChatError`, etwa eine noch laufende andere Antwort des Kontos, ergeben `server_unavailable`.

### Dateien

Gleicher Host und Port wie der WebSocket, `http` zu `ws` und `https` zu `wss`, mit `Authorization: Bearer <Sitzungstoken>`. Das Token steht nie in der Adresse und nie im Protokoll.

| Anfrage                                                                                  | Antwort                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `PUT /pica-mobile/chat/attachments?session=<id>&name=<Dateiname, URL-kodiert>`, Rohdaten | 200 `{ ok: true, attachment }`                      |
| `GET /pica-mobile/chat/attachments/<id>`                                                 | 200 mit der Datei                                   |
| `DELETE /pica-mobile/chat/attachments/<id>`                                              | 200 `{ ok: true }`, nur für nicht gesendete Anhänge |

Fehler sind `{ ok: false, error: <ChatErrorCode> }`: Status 404 für `sessionMissing` und `attachmentMissing` (ein fremder und ein fehlender Anhang antworten gleich), 413 für `fileTooLarge`, 400 für andere Fachfehler, 401 mit `accessDenied` für ein fehlendes oder ungültiges Token und eine beendete Sitzung, 429 mit `tooManyTransfers` bei mehr als 4 gleichzeitigen Übertragungen eines Kontos. Ein abgebrochener Transfer gibt seinen Platz frei. Das Token wird wie bei `auth` mit `method: "session"` geprüft und danach wie bei jeder Chat-Anfrage gegen das aktuelle Konto. Beim Hochladen gilt die Grenze des Administrators wie im Web; beim Herunterladen sendet Pages dieselben Kopfzeilen wie der Web-Download (`Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-cache`). Alle anderen HTTP-Anfragen am Port antworten weiter mit 426.

### Grenzen von chat.v1

- Text-Frames von Pages an die App haben bei `chat_*` höchstens 524288 UTF-16-Codeeinheiten.
- Frames an Pages haben bis zur Anmeldung höchstens 16 KiB; ein größerer Frame beendet die Verbindung mit 1009. Nach der Anmeldung lehnt Pages einen Frame über 16 KiB mit `invalid_message` ab, außer `chat_send`, das bis 128 KiB groß sein darf. Größere Frames beendet der WebSocket mit 1009.
- Chat-Anfragen zählen wie jede Nachricht zum Rate-Limit (30 in 10 Sekunden) und zu den höchstens 8 unerledigten Nachrichten.

### Rechte, Sitzung und Klartext

- Jede Anfrage prüft zuerst die Sitzung. Ist sie beendet oder das Konto deaktiviert, antwortet Pages mit `authentication_failed` und trennt mit Code 1008 („Session ended“), wie bei `dashboard_get`.
- Die App sieht nur die eigenen Unterhaltungen des angemeldeten Kontos; eine neue Berechtigung, eine Push-Nachricht für Chat-Antworten oder eine neue Datenbankspalte führt die Erweiterung nicht ein.
- **Klartext.** Chat-Inhalte, Dateien und das Sitzungstoken laufen über `ws://` und `http://` im Klartext durch das Netz (siehe [Sicherheit](#sicherheit)). Betreibe den Endpunkt nur in einem vertrauenswürdigen Netz.

## Erweiterung chat.delete

Erweiterung `chat.delete` von Version 1 des Pica-Mobile-Protokolls. Sie ergänzt `chat.v1` um das Löschen einer Unterhaltung. Hülle, Größengrenzen und `requestId` gelten wie bei den übrigen `chat_*`-Nachrichten.

### Capability

- Pages nennt `chat.delete` in `connected.server.capabilities` nur zusammen mit `chat.v1` und nur, wenn es `chat_delete` beantwortet.
- Ein Pages ohne `chat.delete` antwortet auf `chat_delete` mit `error` und dem Code `unknown_type`. Die Verbindung bleibt bestehen.

### Anfrage `chat_delete`

```json
{
  "version": 1,
  "type": "chat_delete",
  "requestId": "<ID>",
  "payload": { "sessionId": "<ID>" }
}
```

`sessionId` hat dieselbe Form wie in `chat_session_get`. Weitere Felder im `payload` sind ungültig (`invalid_message`).

### Antwort `chat_deleted`

```json
{
  "version": 1,
  "type": "chat_deleted",
  "requestId": "<ID>",
  "payload": { "sessionId": "<ID>" }
}
```

- Die Unterhaltung des angemeldeten Kontos ist gelöscht, mit allen Nachrichten und Anhängen. Läuft gerade eine Antwort von Pica, stoppt Pages sie vorher. Das ist dieselbe Löschung wie in der Weboberfläche.
- Scheitert danach nur das Aufräumen von Dateien, antwortet Pages trotzdem mit `chat_deleted`, weil die Unterhaltung nicht mehr existiert.
- Pages legt keine neue Unterhaltung an und sendet nichts von sich aus. Andere Geräte sehen die Löschung beim nächsten `chat_sessions`.

### Fehler

- `chat_failed` mit `{ "code": "sessionMissing" }`: Die Unterhaltung existiert nicht oder gehört einem anderen Konto.
- `chat_failed` mit einem anderen Code des Chats: Die Löschung ist gescheitert, und die Unterhaltung besteht weiter.
- Ein Bestätigungswort gibt es nicht. Pica Mobile fragt vor dem Senden selbst nach.

## Erweiterung conversations.v1

Die Erweiterung (PAGE-278) gibt der App die gespeicherten Unterhaltungen der Chat-Seite `/chat`: Direktunterhaltungen zwischen zwei Teilnehmern (Mensch oder Agent, je Paar genau eine) und Gruppen mit Namen und Mitgliedern. Pica selbst ist keine dieser Unterhaltungen; dafür bleibt `chat.v1`. Sie läuft über die bestehende, angemeldete Verbindung, ohne neuen Port. Hülle, Authentifizierung, Heartbeat und Fehlerregeln von Version 1 gelten unverändert; eine ungültige Nutzlast ergibt wie überall `error` `invalid_message`. Es gelten dieselben Rechte wie im Web: Nur Mitglieder lesen und schreiben, nur aktive Konten und Agents lassen sich aufnehmen, und jede Anfrage prüft zuerst die Sitzung.

Pages nennt `conversations.v1` in `connected.server.capabilities`, wenn die Verbindung die Erweiterung beantwortet. Ein Pages ohne sie antwortet auf die Anfragen mit `unknown_type`.

### Anfragen und Antworten

| App → Pages                 | Nutzlast                                                        | Antwort                                                         |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `conversations_list`        | `{ cursor? }`                                                   | `conversations` `{ items, nextCursor, totalUnread }`            |
| `conversation_history`      | `{ conversationId, beforeId? }`                                 | `conversation_messages` `{ conversationId, messages, hasMore }` |
| `conversation_participants` | `{}`                                                            | `conversation_participant_list` `{ people, agents }`            |
| `conversation_create`       | `{ kind: "direct" \| "group", participantIds, name? }`          | `conversation_event` `conversation`                             |
| `conversation_send`         | `{ conversationId, clientMessageId, text }`                     | `conversation_event` `message`                                  |
| `conversation_read`         | `{ conversationId, upToMessageId }`                             | `conversation_event` `read`                                     |
| `conversation_mute`         | `{ conversationId, isMuted }`                                   | `conversation_event` `conversation`                             |
| `voice_start`               | `{ id, conversationId, clientMessageId, mimeType, durationMs }` | keine; nur eine Ablehnung als `conversation_error`              |
| `voice_chunk`               | `{ id, index, data }`                                           | keine; nur eine Ablehnung als `conversation_error`              |
| `voice_finish`              | `{ id, chunkCount }`                                            | `conversation_event` `message` mit `voice`                      |
| `voice_cancel`              | `{ id }`                                                        | keine                                                           |

- **Unterhaltung** (`items`, `conversation`): `{ id, kind, name, members, lastMessage, lastActivityAt, unreadCount, isMuted }`. `name` ist der Gruppenname oder bei einer Direktunterhaltung der Name des anderen Teilnehmers; `members` sind `{ id, kind, name, color }`. Die Liste ist nach letzter Aktivität sortiert, höchstens 50 je Seite; `nextCursor` setzt sie fort und ist auf der letzten Seite `null`.
- **`totalUnread`** zählt alle ungelesenen Nachrichten anderer, auch aus stummgeschalteten Unterhaltungen; `unreadCount` gilt je Unterhaltung und Mitglied.
- **Nachricht:** `{ id, conversationId, clientMessageId, sender: { id, kind, name, color }, text, createdAt, mentions, voice? }`. `kind` ist `human` oder `agent`, `color` die Personenfarbe oder `null`. `mentions` sind die IDs der Mitglieder, die der Text mit `@Name` nennt: `@username`, oder der Anzeigename ohne Leerzeichen bzw. sein erstes Wort, solange kein anderes Mitglied denselben trägt. Ein Hinweis, warum ein Agent nicht geantwortet hat, trägt `notice` (`agent_inactive`, `agent_cost_limit`, `agent_unavailable` oder `agent_failed`); `text` sagt ihn dann auf Deutsch, und der Client darf ihn über den Code in seiner Sprache zeigen. Eine Sprachnachricht trägt `voice: { durationMs, transcriptionState, mimeType, sizeBytes }`; `transcriptionState` ist `pending`, `done` oder `failed`, `text` ist bis zur Erkennung leer.
- **Verlauf:** älteste zuerst, je Seite die neuesten 50 Nachrichten und höchstens 400000 Zeichen, aber immer mindestens eine. `beforeId` ist die älteste gelieferte Nachricht und liest die Seite davor. Eine Anfrage ohne `beforeId` öffnet die Unterhaltung auf der Verbindung (siehe [Push](#push-bei-neuen-nachrichten)).
- **`conversation_send`:** `clientMessageId` ist eine UUID; eine Wiederholung liefert die gespeicherte Nachricht und erzeugt keine zweite. `text` hat höchstens 16000 Zeichen, sonst `too_long`; ein leerer Text ist `invalid`.
- **`conversation_create`:** `direct` braucht genau einen anderen Teilnehmer und liefert die vorhandene Unterhaltung des Paares, wenn es sie schon gibt. `group` braucht einen Namen (1 bis 80 Zeichen) und 1 bis 49 andere Teilnehmer. Die eigene ID, unbekannte und deaktivierte Konten ergeben `invalid`.
- **`conversation_participants`:** aktive Personen (`people`) und Agents (`agents`) außer dem eigenen Konto, je `{ id, kind, name, color, username, role }`.

### Antworten von Agents

Agents nehmen an Unterhaltungen teil (PAGE-276). In einer Direktunterhaltung antwortet der Agent auf jede Nachricht der Person, in einer Gruppe ein Agent nur, wenn die Nachricht ihn mit `@Name` erwähnt; mehrere Erwähnte antworten je einmal. Eine Sprachnachricht wird beantwortet, sobald ihr Text erkannt ist. Ein Agent antwortet nie auf eigene Nachrichten und nicht auf Nachrichten anderer Agents, so entstehen keine Schleifen. Von sich aus schreiben Agents nicht.

- Die Antwort ist eine normale Nachricht mit dem Agent als Absender (`message`). Sie entsteht mit dem Modell, den Anweisungen und den Rechten des Agents, in einer eigenen Sitzung des Agents je Unterhaltung; ein Kostenlimit des Agents gilt auch hier.
- Als Kontext liest der Agent die neuesten Nachrichten der Unterhaltung bis zur beantworteten, höchstens 20 Nachrichten und 12000 Zeichen (`CONVERSATION_AGENT_CONTEXT_MESSAGES`, `CONVERSATION_AGENT_CONTEXT_CHARACTERS`); ältere fallen zuerst weg, die beantwortete bleibt immer. Hinweise bleiben draußen, Zugangsdaten werden geschwärzt.
- Während der Agent arbeitet, erhalten alle Mitglieder `typing`; im Web zeigt die Gruppe „… antwortet“.
- Ist der Agent deaktiviert, sein Kostenlimit erreicht, kein Modell nutzbar oder schlägt die Antwort fehl, erscheint statt der Antwort ein Hinweis mit `notice` im Namen des Agents. Der Agent wird nicht erneut gestartet; je beantworteter Nachricht und Agent gibt es höchstens eine Antwort oder einen Hinweis.
- Für Entwicklung und Prüfung ohne Modell schaltet `PAGES_AGENT_SIMULATION=1` die Agent-Simulation ein; dann geht keine Anfrage an einen Modellanbieter, und der Agent antwortet mit einem festen Text, der die letzte Nachricht nennt. `PAGES_AGENT_SIMULATION_SCENARIO` wählt `ok` (Standard), `failed` (die Antwort schlägt fehl) oder `slow` (Antwort nach fünf Sekunden). Bei `NODE_ENV=production` wird der Schalter ignoriert und das geloggt.

### Ereignisse

`conversation_event` hat die Nutzlast `{ type, data }`. Als Antwort trägt es die `requestId` der Anfrage; was Pages von sich aus sendet, trägt `requestId: null`.

| `type`            | `data`                                                            | Wer es erhält                                                                       |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `message`         | neue Nachricht, auch aus dem Web                                  | alle Mitglieder                                                                     |
| `message_updated` | geänderte Nachricht, etwa der erkannte Text einer Sprachnachricht | alle Mitglieder                                                                     |
| `conversation`    | neue oder geänderte Unterhaltung, wie das Mitglied sie sieht      | alle Mitglieder; nach `conversation_mute` nur das Konto                             |
| `read`            | `{ conversationId, upToMessageId, unreadCount, totalUnread }`     | nur das Konto selbst                                                                |
| `typing`          | `{ conversationId, participantId, isTyping }`                     | alle Mitglieder, wenn ein Agent eine Antwort beginnt (`true`) und beendet (`false`) |

Die Verbindung, die eine Änderung ausgelöst hat, erhält sie als Antwort und nicht noch einmal als Ereignis; andere Verbindungen desselben Kontos erhalten das Ereignis.

### Fehler

`conversation_error` hat die Nutzlast `{ id, code }`. `id` ist bei `voice_*` die Upload-ID, sonst die genannte Unterhaltung oder `null`. `code` ist `forbidden` (Direktunterhaltung mit einem deaktivierten Konto), `not_found` (fehlende Unterhaltung, Nichtmitglied oder unbekannter Upload; ein Nichtmitglied und eine fehlende Unterhaltung antworten gleich), `invalid`, `too_large`, `too_long` oder `unsupported_format`.

### Sprachnachrichten

Audio geht in Stücken, weil der Frame begrenzt bleibt. `voice_start` kündigt die Nachricht an; Pages prüft Mitgliedschaft, Format (`audio/wav` oder `audio/mpeg`, sonst `unsupported_format`) und Dauer (höchstens die längste Aufnahme von Pages, `speechRecognition.maximumRecordingSeconds`, Standard 5 Minuten, sonst `too_long`). Danach folgen die `voice_chunk` in der Reihenfolge `index` 0, 1, 2 …, `data` Base64 mit höchstens 64 KB Rohdaten je Stück, zusammen höchstens 25 MB (`too_large`). `voice_finish` mit der Zahl der Stücke speichert die Nachricht. Pages prüft dann den Inhalt: Er muss zum angekündigten Format passen (`unsupported_format`), und die Länge aus dem WAV-Kopf darf die Höchstdauer nicht überschreiten (`too_long`); bei MP3 gilt die angekündigte Dauer. Das Audio liegt im Dateispeicher von Pages, nicht in der Datenbank.

Eine Ablehnung kommt einmal je Upload; weitere Stücke dieses Uploads verwirft Pages still, und `voice_finish` wiederholt die Ablehnung. Ein Upload, der eine Minute still bleibt, und jeder Upload einer geschlossenen Verbindung verfällt ohne Rest; `voice_cancel` verwirft ihn sofort. Eine Verbindung hat höchstens 2 Uploads gleichzeitig.

Der Text kommt nach dem Senden als `message_updated`. Ohne Spracherkennungsmodell endet die Erkennung mit `failed`, das Audio bleibt abspielbar. Für Entwicklung und Prüfung schaltet `PAGES_STT_SIMULATION=1` eine Simulation ein (`PAGES_STT_SIMULATION_SCENARIO` `ok`, `provider_failed` oder `slow`); bei `NODE_ENV=production` wird der Schalter ignoriert und das geloggt.

Laden: `GET /pica-mobile/conversations/voice/<messageId>` am selben Host und Port, mit `Authorization: Bearer <Sitzungstoken>` wie bei den Chat-Anhängen. Die Mitgliedschaft wird bei jedem Abruf geprüft: 200 mit dem Audio (`Content-Type` `audio/wav` oder `audio/mpeg`), 404 `{ ok: false, error: "not_found" }` für Nichtmitglieder und fehlende Nachrichten, 401 `accessDenied` ohne gültiges Token, 429 bei mehr als 4 gleichzeitigen Abrufen eines Kontos. Im Web spielt die Chat-Seite dieselbe Datei über `/chat/voice/<messageId>` mit derselben Prüfung ab.

### Grenzen

- `conversation_send` und `voice_chunk` dürfen wie `chat_send` bis 128 KiB groß sein (`PICA_MOBILE_MAXIMUM_CHAT_SEND_BYTES`), jeder andere Frame bleibt bei 16 KiB.
- `voice_chunk` zählt nicht zum allgemeinen Rate-Limit (30 Nachrichten in 10 Sekunden, 8 unerledigte), sondern zu einem eigenen: 160 Stücke in 10 Sekunden und 64 unerledigte. Ein Frame, der sich als `voice_chunk` ausgibt, aber keiner ist, wird abgelehnt.
- Frames von Pages an die App haben höchstens 524288 UTF-16-Codeeinheiten.

### Push bei neuen Nachrichten

Eine neue Nachricht löst über die vorhandene FCM-Anbindung (siehe [notifications.v1](#erweiterung-notificationsv1-android-fcm)) einen Push an die registrierten Geräte der anderen Mitglieder aus. Kein Push geht an den Absender, für eine stummgeschaltete Unterhaltung, oder solange eine Verbindung des Kontos die Unterhaltung offen hat. Offen ist sie nach `conversation_history` ohne `beforeId`, `conversation_send` oder `conversation_read`; `conversations_list` und das Schließen der Verbindung schließen sie. Vor jedem Push prüft Pages Sitzung und Konto der Registrierung wie bei den Plan-Pushes; ein gescheiterter Push wird nicht wiederholt, die Nachricht wartet in der Unterhaltung.

- Kanal `pica-conversation-messages`, Tag `conversation:<id>`, sodass ein neuerer Push derselben Unterhaltung den älteren ersetzt.
- Mit `preview: "details"` nennt der Titel die Unterhaltung (Gruppenname oder Absender einer Direktunterhaltung) und der Text den Absender („Nachricht von …“, „Sprachnachricht von …“); mit `hidden` bleiben beide allgemein. Der Nachrichtentext geht nie in einen Push.
- `data`: `pica_v`, `pica_type: "conversation_message"`, `pica_instance`, `pica_account`, `pica_conversation`, `pica_message`, `pica_at`, `tag`. Damit öffnet die App die Unterhaltung.
- Für Entwicklung und Prüfung ohne FCM schaltet `PAGES_PUSH_SIMULATION=1` außerhalb von Produktion einen Push-Dienst ein, der nur ausgibt, was er an FCM übergeben würde (ohne Token); jede Übergabe steht als `pica_mobile.conversation_push.handed_over` im Log.

## Erweiterung notifications.v1 (Android, FCM)

Die Erweiterung benachrichtigt eine angemeldete Android-App über die eigenen Läufe des Kontos und, wenn das Konto es mit [`notifications.team.v1`](#erweiterung-notificationsteamv1) einschaltet, über Läufe in Plänen seiner Teams: wenn ein Folgeschritt wirklich startet, ein Lauf bestätigt abgebrochen wird, fehlschlägt oder erfolgreich endet. Zugestellt wird direkt über Firebase Cloud Messaging (FCM HTTP v1). iOS und APNs gehören nicht dazu, es gibt kein Expo-Push-Relay und keine Hintergrundabfrage oder dauerhaft offene Verbindung als Ersatz für Push. Hülle, Authentifizierung, Heartbeat, Rate-Limit und Fehlerregeln von Version 1 gelten unverändert; Pages sendet über die WebSocket-Verbindung nie von sich aus `notification_*`-Nachrichten, die App fragt nur. Betrieb, Konfiguration, Grenzen der Zustellung und die Übergabe an die Geräteprüfung stehen in [PicaMobileNotifications.md](./PicaMobileNotifications.md).

Die Erweiterung ist mit dem Mobile-Vertrag `notifications.v1`, Revision PM-14-1 (31.10.2026, Android-Teil), und den ausführbaren Parsern der App abgeglichen. Grundlage ist der unveränderte Quellenstand aus dem Ticket-Anhang von PAGE-193 (Pica-Mobile `main`, Commit `d72631b4cf3fb1a76a0389e7fbf301e61d5ac551`); das Repository selbst lag auf dem Host der Umsetzung nicht vor. Der Abgleich, die behobenen Abweichungen und die Widersprüche im Mobile-Vertrag stehen in [Abgleich mit dem Mobile-Vertrag](#abgleich-mit-dem-mobile-vertrag-pm-14-1). Dieser Abgleich ist eine statische Gegenprüfung; eine Prüfung mit der laufenden App ist nicht erfolgt.

### Capabilities

| Capability                | Bedeutung                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifications.v1`        | Pages beantwortet `notification_register`, `notification_unregister` und `notification_event_get`. Pages nennt sie, sobald der Vertrag umgesetzt ist, auch ohne FCM.                                                     |
| `notifications.push.fcm`  | Pages hat einen verwendbaren FCM-Sender: eine gültige Schlüsseldatei des Dienstkontos ist konfiguriert und lesbar. Ohne sie nimmt Pages keine Registrierung an.                                                          |
| `notifications.push.apns` | wird nie genannt.                                                                                                                                                                                                        |
| `notifications.team.v1`   | Pages beantwortet `notification_settings_get` und `notification_settings_set` und kennt Team-Benachrichtigungen; siehe [notifications.team.v1](#erweiterung-notificationsteamv1). Immer zusammen mit `notifications.v1`. |

Ein Pages ohne `notifications.v1` beantwortet die drei Nachrichten mit `unknown_type`. Ein Pages mit `notifications.v1`, aber ohne `notifications.push.fcm`, beantwortet `notification_register` mit `server_unavailable` und speichert nichts; die App behandelt das nicht als erfolgreiche Registrierung.

### notification_register und notification_registered

**`notification_register`** (Client → Pages) ist nur nach erfolgreichem `auth` zulässig. Der Empfänger ist ausschließlich das Konto der authentifizierten Sitzung; die Nachricht nimmt weder Konto-, Plan- noch Lauf-Empfänger entgegen.

```json
{
  "version": 1,
  "type": "notification_register",
  "requestId": "n1",
  "payload": {
    "deviceId": "pica-9f2c41b7e0d84c11",
    "platform": "android",
    "provider": "fcm",
    "token": "<nativer FCM-Token>",
    "locale": "de",
    "preview": "hidden"
  }
}
```

| Feld       | Regel                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deviceId` | 16 bis 64 Zeichen aus `A–Z`, `a–z`, `0–9`, `_`, `-`.                                                                                                            |
| `platform` | nur `"android"`; jeder andere Wert ist `invalid_message`.                                                                                                       |
| `provider` | nur `"fcm"`; jeder andere Wert ist `invalid_message`.                                                                                                           |
| `token`    | vertraulicher nativer FCM-Token, 1 bis 4096 Zeichen ohne Leerraum.                                                                                              |
| `locale`   | `"de"` oder `"en"`; fehlt es oder ist es etwas anderes, gilt `"de"`.                                                                                            |
| `preview`  | `"hidden"` (Standard, auch wenn das Feld fehlt) oder `"details"`; jeder andere Wert ist `invalid_message`. Siehe [Datenschutz](#push-nutzlast-und-datenschutz). |

**`notification_registered`** (Pages → Client) antwortet mit derselben `requestId`:

```json
{
  "version": 1,
  "type": "notification_registered",
  "requestId": "n1",
  "payload": {
    "deviceId": "pica-9f2c41b7e0d84c11",
    "instanceId": "k3Qm0x5JrT8w2LzVb9aYcA",
    "accountId": "…",
    "registeredAt": "2026-11-01T10:00:00.000Z",
    "replayTtlSeconds": 900
  }
}
```

`instanceId` kennzeichnet diese Pages-Instanz (`^[\w.:-]{1,128}$`); er steht in der Datenbank und bleibt über Neustarts und den Umzug der Instanz gleich. `accountId` ist immer `connected.payload.user.id`. `registeredAt` ist ein ISO-8601-Zeitpunkt in UTC. `replayTtlSeconds` (60 bis 3600, Standard 900) sagt, wie lange nach einem Ereignis Pages es noch zustellt.

Regeln der Registrierung:

- **Idempotent.** Dieselbe Bindung erneut zu registrieren erneuert sie und behält `registeredAt`. Das gilt für dasselbe Konto auf demselben `deviceId`, auch bei neuem Token (Rotation, der alte Token wird ersetzt) oder neuer Sitzung.
- **Ein Konto, eine Sitzung, ein Gerät.** Registriert ein anderes Konto dasselbe `deviceId`, beginnt dessen Bindung jetzt und die alte endet sofort. Taucht derselbe Token unter einem anderen `deviceId` auf, ersetzt die neue Bindung die alte. Mehrere Geräte eines Kontos bleiben getrennt.
- **Höchstens 10 Registrierungen je Konto.** Bei Überschreitung entfällt die Registrierung, die am längsten nicht erneuert wurde.
- **Keine Ereignisse vor der Registrierung.** Die erste Registrierung beginnt mit der Antwort; nichts, was davor geschah, wird nachgereicht. Bis Pages die Antwort aus der Hand gegeben hat, stellt es nichts zu, und was zwischen dem Speichern der Registrierung und dieser Antwort geschieht, holt es nicht nach. Geht die Antwort verloren, bleibt die Registrierung inaktiv, bis die App sie erneuert; die App registriert nach jedem Verbindungsaufbau erneut.
- **Der Token wird verschlüsselt gespeichert**, mit dem Instanzschlüssel, den Pages auch für seine anderen Verbindungsgeheimnisse nutzt, und an das Gerät gebunden. Er steht weder im Klartext in der Datenbank noch im Protokoll noch in einer Adresse.
- **Die Registrierung hängt an der Sitzung.** Wird die Sitzung widerrufen oder läuft sie ab, wird das Konto deaktiviert oder muss es sein Passwort ändern, stellt Pages nichts mehr zu und entfernt die Registrierung. Pages prüft das unmittelbar vor jedem Zustellversuch und räumt außerdem etwa alle fünf Minuten auf.

### notification_unregister und notification_unregistered

```json
{
  "version": 1,
  "type": "notification_unregister",
  "requestId": "n2",
  "payload": { "deviceId": "pica-9f2c41b7e0d84c11" }
}
```

**`notification_unregistered`** antwortet mit `{ "deviceId": "…" }` und derselben `requestId`. Die Antwort ist für ein bekanntes, ein unbekanntes und ein fremdes `deviceId` gleich; nur eine Registrierung des eigenen Kontos wird entfernt, fremde Daten werden nie berührt. Nach der Entfernung erzeugt Pages keinen neuen Versand mehr. Eine Nachricht, die Pages schon an Google übergeben hat, lässt sich nicht zurückrufen.

Das lokale Abmelden der App ist im Protokoll Version 1 kein bestätigter Server-Logout: Schlägt `notification_unregister` fehl, bleibt die Registrierung bestehen, bis die Sitzung endet oder das Gerät sie erneuert. Die App darf das nicht als sofortige Abmeldung auf dem Server darstellen.

### notification_event_get und notification_event

Eine Push-Nachricht trägt nur die Kennung des Ereignisses. Die App holt die Fakten mit `notification_event_get`:

```json
{
  "version": 1,
  "type": "notification_event_get",
  "requestId": "n3",
  "payload": { "eventId": "Zk3x8Qm0w5JrT2LzVb9aYc" }
}
```

**`notification_event`** antwortet mit derselben `requestId` und wiederholt `eventId`. `access` ist `ok`, `forbidden` oder `gone`; bei den beiden letzten steht nichts weiter im Payload, weder Namen noch Details:

```json
{
  "version": 1,
  "type": "notification_event",
  "requestId": "n3",
  "payload": {
    "eventId": "Zk3x8Qm0w5JrT2LzVb9aYc",
    "access": "ok",
    "event": {
      "type": "step_started",
      "occurredAt": "2026-11-01T10:15:30.123Z",
      "seq": 3,
      "plan": { "id": "…", "name": "Release-Ablauf" },
      "run": { "id": "…", "status": "running" },
      "steps": [
        {
          "instanceId": "…",
          "number": 4,
          "name": "Prüfer A",
          "attempt": 1,
          "iteration": null
        }
      ],
      "stepCount": 1
    }
  }
}
```

| Feld                | Bedeutung                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`              | `step_started`, `run_cancelled`, `run_failed` oder `run_succeeded`.                                                                                                                                                                                                                                                                                    |
| `occurredAt`, `seq` | Zeitpunkt des Übergangs und eine je Lauf streng steigende Nummer ab 1. Pages vergibt sie dauerhaft, auch nach dem Fortsetzen eines Laufs und nach einem Neustart von Pages wird keine Nummer wiederverwendet.                                                                                                                                          |
| `plan`              | `id` und der **aktuelle** Name des Plans (nicht leer, höchstens 500 UTF-16-Codeeinheiten).                                                                                                                                                                                                                                                             |
| `run`               | `id` und der **aktuelle** Zustand im Wortlaut des Runners: `running`, `pausing`, `paused`, `stopping`, `succeeded`, `failed` oder `cancelled`. Pages kennt keinen Zustand `blocked` und nennt nie `completed`.                                                                                                                                         |
| `steps`             | nur bei `step_started`, 1 bis 20 Einträge: `instanceId` (kennzeichnet die Schrittinstanz im Lauf, ohne Leerraum, höchstens 200 Zeichen), `number` (Nummer des Knotens im Ablauf, Start ist 1; `null` ohne Nummer), `name` (höchstens 500 UTF-16-Codeeinheiten oder `null`), `attempt` (ab 1), `iteration` (ab 1 oder `null` außerhalb einer Schleife). |
| `stepCount`         | nur bei `step_started`: alle Schritte des Übergangs, mindestens die Länge von `steps`, höchstens 1000.                                                                                                                                                                                                                                                 |
| `scope`             | nur bei einem Ereignis, das das Konto als Mitglied des Plan-Teams bekommt: `"team"`. Bei eigenen Läufen fehlt das Feld, die Antwort bleibt also für ältere Apps unverändert.                                                                                                                                                                           |
| `reason`            | nur bei `run_failed`: ein Fehlercode von Pages (zum Beispiel `plan_step_failed`) oder `null`. Kein Freitext.                                                                                                                                                                                                                                           |
| `detailUrl`         | Feld des Payloads neben `event` (nicht darin); fehlt immer, siehe [Abgleich](#abgleich-mit-dem-mobile-vertrag-pm-14-1).                                                                                                                                                                                                                                |

`forbidden` bedeutet: das Ereignis ist das des Kontos, aber das Konto darf den Plan oder den Lauf nicht mehr lesen, gehört bei einem Team-Ereignis nicht mehr zum Team des Plans oder hat Team-Benachrichtigungen ausgeschaltet. `gone` bedeutet: es gibt dieses Ereignis nicht (mehr) für das Konto, weil es nie existierte, abgelaufen ist, dem Konto nicht gehört oder der Lauf nicht mehr existiert. Beides fragt Pages beim Eintreffen der Anfrage frisch ab; ein früherer Zugriff gilt nichts. Der Abruf liest nur.

### Wann ein Ereignis entsteht

Quelle sind bestätigte Übergänge des gespeicherten Laufs, nicht die Oberfläche, nicht Modelltext und keine Abfragen:

- **`step_started`**: ein Schritt wechselt tatsächlich von wartend auf laufend. Das gilt nicht für den ersten Schritt eines Laufs (jeden Schritt, in den nur Start führt), nicht für Start und Ende, nicht für einen erneuten Versuch desselben Schritts, nicht für übersprungene Knoten und nicht für den Abschluss eines einzelnen Schritts. Schritte, die in einem Übergang parallel starten, bilden ein Ereignis mit allen Schrittinstanzen; Pages sammelt dafür Starts desselben Laufs bis zu 1 Sekunde, Starts, die weiter auseinanderliegen, gelten als getrennte Übergänge. Eine Schleife meldet ihren Start als Schritt und jede weitere Iteration (ab der zweiten) einmal als neues Ereignis mit `iteration`, beim ersten Schrittstart darin, nicht für jedes Mitglied. Die Mitglieder einer Gruppe sind Schritte; die Zusammenfassungszeile der Gruppe meldet Pages nicht. Jede Schrittinstanz meldet Pages höchstens einmal, auch wenn ein Lauf pausiert und fortgesetzt wird oder Pages neu startet; ein Start, der lief, ohne dass ein Gerät registriert war, wurde nie gemeldet und wird nach einem Fortsetzen erstmals gemeldet.
- **`run_cancelled`**: erst wenn der Lauf bestätigt `cancelled` ist, nicht bei der Stoppanforderung und nicht bei `stopping`.
- **`run_failed`**: wenn der Lauf tatsächlich in `failed` übergeht, nicht bei einem technischen Zwischenversuch, einem Fehler eines Schritts, den der Lauf übersteht, oder einer Pause. Läufe, die Pages selbst unterbricht, weil es endet oder neu startet (Fehlercode `plan_interrupted`), meldet Pages nicht; sie sind danach als unterbrochen fortsetzbar.
- **`run_succeeded`**: erst bei tatsächlichem `succeeded`.

Eine Fortsetzung kann danach neue echte Übergänge erzeugen. Pausieren und Fortsetzen selbst erzeugen nichts.

### Empfänger und Rechte

Empfänger sind (PAGE-263):

- **das Konto, das den Lauf gestartet hat**, unabhängig davon, wem der Plan gehört, sofern es den Plan und den Lauf jetzt lesen darf (dieselben Prüfungen wie beim Öffnen des Laufs auf der Planseite);
- **jedes Mitglied und jede Leitung der Abteilung, der der Plan zugeordnet ist** (das Team des Plans), wenn das Konto Team-Benachrichtigungen eingeschaltet hat, ein aktiv registriertes Gerät besitzt, den Plan jetzt lesen darf und selbst jedes Modell, jeden Arbeitsbereich, jedes Ticket, jede Seite und jede Datei lesen darf, die der Lauf benutzt hat. Die Teamzugehörigkeit ersetzt keines dieser Rechte. Ein Plan ohne Team-Abteilung hat keine Team-Empfänger; der Planeigentümer bekommt fremde Läufe nur als Teammitglied.

Läufe in Plänen, zu denen das Konto weder als Starter noch als Teammitglied gehört, kommen nie vor. Hat ein Konto mehrere Gründe (zum Beispiel Starter und Teammitglied), bekommt es je Ereignis genau ein Ereignis und je Gerät höchstens eine Zustellung. Team-Ereignisse entstehen nur für Übergänge nach dem Einschalten; Einschalten spielt nichts nach. Pages prüft Starter- oder Teambeziehung, Einstellung und Rechte beim Anlegen des Ereignisses, unmittelbar vor jedem Zustellversuch und bei jedem `notification_event_get`. Vor jedem Zustellversuch prüft es außerdem, dass die Registrierung, ihre Sitzung und das Konto noch gelten. Wird ein Recht entzogen, verwirft Pages die noch nicht gesendeten Nachrichten und liefert keine Namen mehr. Solange kein Gerät registriert ist, legt Pages gar keine Ereignisse an.

### Push-Nutzlast und Datenschutz

Pages sendet an FCM HTTP v1 eine Nachricht mit `notification.title`, `notification.body` und `data`. Die Nutzlast bleibt unter 4096 Bytes.

`data` enthält nur Textwerte:

| Schlüssel       | Inhalt                                                             |
| --------------- | ------------------------------------------------------------------ |
| `pica_v`        | `"1"`                                                              |
| `pica_event`    | `eventId`                                                          |
| `pica_instance` | `instanceId` der Pages-Instanz                                     |
| `pica_account`  | Konto-ID                                                           |
| `pica_type`     | `step_started`, `run_cancelled`, `run_failed` oder `run_succeeded` |
| `pica_plan`     | Plan-ID                                                            |
| `pica_run`      | Lauf-ID                                                            |
| `pica_seq`      | `seq` als Dezimalzahl ohne führende Null, höchstens 15 Stellen     |
| `pica_at`       | `occurredAt`, ISO-8601 mit Zeitzone                                |
| `tag`           | gleich `android.notification.tag`                                  |

`android` setzt `priority` auf `HIGH`, `ttl` auf die **Restlaufzeit** (nicht mehr als `replayTtlSeconds` nach dem Ereignis), `notification.visibility` auf `PRIVATE`, `notification.channel_id` auf `pica-plan-steps` (Schrittstart) oder `pica-plan-results` (Laufende) und `notification.tag` auf `run:<runId>:step` für Fortschritt oder die `eventId` für ein Laufende. Daher ersetzt eine neuere Fortschrittsmeldung eine ältere desselben Laufs, aber nie eine Meldung zum Laufende; zwei Laufenden ersetzen sich nie. Pages setzt weder `collapse_key` noch Symbol, Farbe, `click_action`, Bild oder Ton; die App bringt Manifest und Kanäle mit.

- **`preview: "hidden"`** (Standard): ein lokalisierter, allgemeiner Titel und der Hinweis, zum Anzeigen der Details zu entsperren. Keine Namen. Der Wortlaut ist der des Mobile-Vertrags: „Agent-Plan: nächster Schritt“, „Agent-Plan abgebrochen“, „Agent-Plan fehlgeschlagen“, „Agent-Plan erfolgreich abgeschlossen“ (`en`: „Agent plan: next step“, „Agent plan cancelled“, „Agent plan failed“, „Agent plan completed successfully“) mit dem Text „Zum Anzeigen der Details entsperren.“ (`en`: „Unlock to view details.“).
- **`preview: "details"`**: nur wenn die App es ausdrücklich so registriert hat **und** Pages Besitz und Lauf-Rechte unmittelbar vorher erneut bestätigt hat, nennt die Meldung Namen. Der Titel bleibt allgemein („Nächster Schritt“, „Plan abgebrochen“, „Plan fehlgeschlagen“, „Plan erfolgreich abgeschlossen“; `en`: „Next step“, „Plan cancelled“, „Plan failed“, „Plan completed successfully“), der Text lautet `<Planname> · Schritt <n>: <Schrittname>`, bei mehreren Schritten `<Planname> · <k> Schritte gestartet` (`en`: `<k> steps started`), bei `run_failed` `<Planname> · <Fehlercode>`, sonst `<Planname>`. Jeder Name ist auf 80 Zeichen gekürzt. Wäre die Nachricht dadurch zu groß, sendet Pages die allgemeine Form.
- **Nie** in einer Push-Nachricht: Prompts, Antworten, Rohprotokolle, Arbeitsverzeichnisse, Sitzungs- oder Providerzugänge.

Was Pages einmal an den Push-Dienst übergeben hat, liegt dort und auf dem Gerät außerhalb seiner Kontrolle: ein anschließender Besitz- oder Sitzungswechsel, ein entzogenes Recht oder eine Entfernung der Registrierung nehmen die schon übergebene Meldung nicht zurück. Die App sollte beim Antippen `notification_event_get` abrufen und nur zeigen, was `access: "ok"` liefert.

### Zustellung

- **Rest-TTL.** Pages stellt nur zu, solange die Gültigkeit des Ereignisses (`replayTtlSeconds`) nicht abgelaufen ist, und übergibt FCM die verbleibende Zeit. Ereignisse, die vor `registeredAt` entstanden, oder verfallene werden nicht gesendet.
- **Wiederholung.** Vorübergehende Fehler von FCM (Quota, Nichterreichbarkeit, Zeitüberschreitung) versucht Pages höchstens sechsmal (der erste Versuch und fünf Wiederholungen) mit wachsendem Abstand (etwa 5 s, 15 s, 45 s, 2 min, 5 min) und bricht bei Ablauf der Gültigkeit ab. Es gibt keine Endlosschleife.
- **Ungültiger Token.** Nur wenn FCM den Token selbst als ungültig meldet (`UNREGISTERED` oder `INVALID_ARGUMENT` mit Feldverstoß auf dem Token), entfernt Pages genau diese Registrierung. Ein `INVALID_ARGUMENT`, der die Nutzlast meint, und eine falsche Projektkonfiguration lassen Registrierungen unberührt.
- **Drosselung.** Ein Lauf sendet an ein Gerät höchstens eine Schrittmeldung je 10 Sekunden; mehrere wartende werden durch die neueste ersetzt. Eine Meldung zum Laufende wird nie gedrosselt, ersetzt oder verworfen; sie verwirft nur noch wartende Schrittmeldungen desselben Laufs.
- **Kein Einfluss auf Läufe.** Ein Ausfall, eine Zeitüberschreitung oder eine fehlende Konfiguration von FCM ändert nie einen Lauf, startet keinen Job und hält keine Ausführung auf.
- **Keine Garantie der Anzeige.** „An FCM übergeben“ heißt nicht „auf dem Gerät angezeigt“. Eine unklare Versandbestätigung kann zu einer zweiten Versendung führen; weil Wiederholungen dieselbe `tag` tragen, ersetzt Android die erste Anzeige durch die zweite, garantiert aber kein genau einmaliges Erscheinen. Die Anzeige kann sich verspäten oder ausbleiben (Energiesparmodus, App-Einstellungen, Google-Dienste).
- **Aufbewahrung.** Pages hält Ereignisse 7 Tage und höchstens 100 je Konto; danach antwortet `notification_event_get` mit `gone`. Es entsteht keine Ereignisflut beim Einschalten.

### Abgleich mit dem Mobile-Vertrag (PM-14-1)

**Quellen.** Verglichen wurden `docs/notifications-contract.md`, `src/services/notificationProtocol.ts`, `src/services/notifications.ts` und `src/services/pagesClient.ts` aus dem unveränderten Textabzug im Ticket-Anhang von PAGE-193 (Pica-Mobile `main`, Commit `d72631b4cf3fb1a76a0389e7fbf301e61d5ac551`, Arbeitsbaum sauber, Stand 1.11.2026). Die SHA-256-Summen der aus dem Anhang gelösten Dateien stimmen mit der Liste im Ticket überein: `docs/notifications-contract.md` `939daea4f702585978ecc113e017f3c624b05d5b5666b3241a3317f119eb68b4`, `src/services/notificationProtocol.ts` `f746f041c45885c70818ea76cf6f13c0e6049e6449f5be2def9fe279d81d0803`, `src/services/notifications.ts` `7b40bcce5c1b055f53af1f2d3029be7815408a80870bfddb9d633b42aa76e72e`, `src/services/pagesClient.ts` `81ce7abaf49d347eb9136028e4875dc1e3961c9287d969a2095a583d7cb7aba9`. Das Repository `/home/igor/Repo/Pica-Mobile` selbst war auf dem Host nicht vorhanden und wurde nicht gelesen. Wer einen neueren Stand von `main` hat, vergleicht diese Summen, bevor er sich auf diese Tabelle verlässt.

**Nicht verglichen.** `src/services/protocol.ts` (Hüllen- und `connected`-Parser, `isDataMessage`), `dashboardProtocol.ts` und `src/features/notifications/notificationController.ts` lagen nicht im Abzug. Die Hülle und `connected` sind der bestätigte Vertrag von Version 1 und wurden nicht verändert; ob der `connected`-Parser die Capability-Namen genau so liest, ist nicht gegengeprüft.

**Methode.** Die ausführbaren Parser des Clients (`parseRegistered`, `parseUnregistered`, `parseEventDetail`, `parsePushData`) wurden unverändert gegen die echten Ausgaben von Pages gehalten: die Encoder der drei Antworten, den Ereignisleser mit einer nachgebildeten Speicherung und Rechteprüfung sowie den Aufbau der Push-Nachricht. Das ist eine **Simulation** ohne Netz, Datenbank, FCM und Gerät. Sie belegt die Formverträglichkeit mit dem Parser, nicht die Zustellung.

**Abweichungen, die der Abgleich gefunden und in Pages behoben hat.**

| Befund                                                                          | Folge für die App                                                                                                               | Korrektur in Pages                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namen wurden nach Unicode-Zeichen gekürzt                                       | Der Parser zählt UTF-16-Codeeinheiten (`length`); 400 Emoji sind 800 Einheiten und verletzten die Grenze von 500                | Kürzung nach UTF-16-Codeeinheiten, ohne ein Ersatzpaar zu zerschneiden (Plan-, Schrittname, Grund)                                                                                              |
| `steps[].instanceId` konnte Leerraum enthalten oder länger als 200 Zeichen sein | Der Parser verwirft die ganze Antwort als `protocol`; betroffen sind Knotenkennungen mit Leerraum und lange Schleifenmitglieder | Genügt die Kennung nicht (`^\S{1,200}$`), sendet Pages `si-` und 32 Hexzeichen eines SHA-256 der Kennung; gleiche Kennung, gleicher Wert                                                        |
| Antwort ohne Größengrenze                                                       | Der Vertrag verlangt höchstens 16384 UTF-16-Codeeinheiten; die App beendet bei mehr die Verbindung                              | `notification_event` bleibt darunter: zuerst entfallen Schritte vom Ende (`stepCount` behält die Gesamtzahl), dann kürzen die Namen auf 80 Zeichen; passt es dann nicht, antwortet Pages `gone` |
| `detailUrl` stand im Typ innerhalb von `event`                                  | Der Parser liest `payload.detailUrl`; ein dort eingebauter Link wäre nie gelesen worden                                         | Typ und Beschreibung: `detailUrl` steht im Payload neben `event`. Pages sendet weiterhin keinen                                                                                                 |
| Sichtbare Texte wichen vom Vertrag ab                                           | Der Vertrag nennt die Titel und den Text verbindlich als [Server-Pflicht]                                                       | Titel, Text und `details`-Format wie im Vertrag (siehe [Push-Nutzlast](#push-nutzlast-und-datenschutz))                                                                                         |

**Widersprüche im Mobile-Vertrag selbst und ihre Auflösung.**

| Widerspruch                                                                                                                                                                                                                                                                                          | Auflösung                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runnerStates` im Parser und die Tabelle `event.run` im Vertrag nennen `blocked`; die Ereignissemantik sagt, `blocked` erzeuge keine Ereignisse und sei kein Laufstatus (`dashboard.v1` kennt `completed` nur als Projektion von `succeeded`), und „Fortsetzen“ spricht von einem „blockierten“ Lauf | Pages hat keinen Laufzustand `blocked` und führt keinen ein. Pages sendet `run.status` nur aus den sieben Zuständen `running`, `pausing`, `paused`, `stopping`, `succeeded`, `failed`, `cancelled`. Dass der Parser `blocked` zusätzlich annimmt, ist eine Obermenge und schadet nicht; die Probe bestätigte alle sieben. Ein fortsetzbarer Lauf ist in Pages ein fehlgeschlagener oder unterbrochener. Der Client kann `blocked` bei Gelegenheit streichen, muss es aber nicht |
| Der Vertrag nennt `reason` „bereinigten Klartext“; Pages hat keinen bereinigten Freitext, der garantiert ohne Prompts, Antworten oder Pfade ist                                                                                                                                                      | Pages sendet den Fehlercode des ersten fehlgeschlagenen Schritts (`^[a-z][a-z0-9_.:-]{0,99}$`, zum Beispiel `plan_step_failed`) oder `null`. Das ist kurzer Klartext im Rahmen des Parsers (höchstens 200 Zeichen) und enthält nie Modell- oder Logtext. In der Meldung mit `details` erscheint der Code                                                                                                                                                                        |
| Der Vertrag nennt Schleifen „jeden echten neuen Durchlauf“ ein Ereignis; die Beschreibung des Starts einer Schleife lässt offen, ob der erste Durchlauf eins ist                                                                                                                                     | Der Start der Schleife meldet Pages als Schritt, jede weitere Iteration ab der zweiten einmal mit `iteration`                                                                                                                                                                                                                                                                                                                                                                   |

**Entscheidungen, wo der Vertrag Spielraum lässt.** Diese Punkte muss der Client bestätigen:

| Punkt                                      | Entscheidung von Pages                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS und APNs                               | nicht unterstützt; `platform: "ios"` und jeder andere Provider sind `invalid_message`, `notifications.push.apns` wird nie genannt                    |
| Registrierung ohne FCM-Sender              | `server_unavailable`; `notifications.v1` bleibt genannt, `notifications.push.fcm` fehlt (ein Client, der die Capability prüft, sendet dann nichts)   |
| Unbekanntes `preview`                      | `invalid_message`, kein stilles `hidden`; fehlt es, gilt `hidden`                                                                                    |
| Unbekanntes `locale`                       | `de`                                                                                                                                                 |
| `detailUrl`                                | wird nie gesendet: die Weboberfläche von Pages hat keine Adresse, die einen einzelnen Lauf ohne Query-Teil öffnet, und eine erfundene Route entfällt |
| Fremde, unbekannte, abgelaufene Ereignisse | `gone`; `forbidden` nur für ein eigenes Ereignis, dessen Rechte entfallen sind                                                                       |
| `run.status`                               | aktueller Runner-Zustand (`running`, `pausing`, `paused`, `stopping`, `succeeded`, `failed`, `cancelled`), nie `blocked`, nie `completed`            |
| `reason`                                   | Fehlercode von Pages statt Freitext, höchstens 200 Zeichen, sonst `null`                                                                             |
| `steps[].instanceId`                       | Kennung des Knotens im Lauf; für ein Schleifenmitglied `<Schleife>:<Knoten>:<Iteration>`; sonst, wenn unzulässig, der Digest (siehe oben)            |
| `steps[].number`                           | Nummer des Knotens im Ablauf (Start ist 1); `null` für Schleifenmitglieder                                                                           |
| `steps[].attempt`                          | Versuch des Schritts beim Start, ab 1                                                                                                                |
| Englische Titel im Modus `details`         | der Vertrag nennt nur deutsche: „Next step“, „Plan cancelled“, „Plan failed“, „Plan completed successfully“ sind die Wahl von Pages                  |
| Erster Schritt eines Laufs                 | meldet Pages nicht; eine Schleife meldet ihren Start als Schritt, jede Iteration ab der zweiten als eigenes Ereignis                                 |
| Schrittbündelung                           | 1 Sekunde; Drosselung höchstens eine Schrittmeldung je Lauf und Gerät in 10 Sekunden                                                                 |
| Unterbrechung durch Pages                  | wird nicht gemeldet (Fehlercode `plan_interrupted`)                                                                                                  |
| Starts weiter als 1 Sekunde auseinander    | getrennte Ereignisse                                                                                                                                 |
| Aufbewahrung der Ereignisse                | 7 Tage, höchstens 100 je Konto                                                                                                                       |
| Kennungen von Konto, Plan und Lauf         | Pages vergibt UUIDs; die App verlangt Text ohne Leerraum bis 200 Zeichen. Pages prüft das für Konto-, Plan- und Lauf-Kennungen nicht eigens          |

**Feld für Feld bestätigt (kein Befund).** Die Nachrichtentypen und ihre Antworttypen (`notification_register` → `notification_registered` und so weiter), die Hülle `{version, type, requestId, payload}` und die gleiche `requestId`; die Felder und Prüfmuster von `deviceId`, `platform`, `provider`, `token` (≤ 4096), `locale`, `preview`; die Antwort `notification_registered` (`deviceId` wiederholt, `instanceId`, `accountId`, `registeredAt` als ISO-8601 mit Zeitzone, `replayTtlSeconds` 60–3600); `notification_unregistered` mit der wiederholten `deviceId`; die Antwort `notification_event` mit wiederholter `eventId`, `access` `ok`, `forbidden`, `gone` (bei den beiden letzten nur `eventId` und `access`); Ereignistypen, `occurredAt`, `seq` ab 1, `plan.name` nicht leer und höchstens 500, `steps` (1–20 bei `step_started`, bei terminalen Ereignissen ohne `steps` und `stepCount`), `stepCount` zwischen Länge von `steps` und 1000, `reason` nur bei `run_failed`; die Push-Daten `pica_v`, `pica_event`, `pica_instance`, `pica_account`, `pica_type`, `pica_plan`, `pica_run`, `pica_seq`, `pica_at` und `tag` (genau diese zehn Schlüssel), `tag` und Kanal je Ereignisart; die Capability-Namen `notifications.v1` und `notifications.push.fcm`; keine Nachricht von Pages ohne Anfrage.

## Erweiterung notifications.team.v1

Die Erweiterung (PAGE-263) lässt ein Konto Push-Meldungen zu Läufen anderer Personen in Plänen seiner Teams ein- und ausschalten. Sie ergänzt `notifications.v1`, ändert keine bestehende Nachricht und keine Push-Nutzlast. Eine App, die sie nicht kennt, behält ihr bisheriges Verhalten: die Einstellung ist für jedes Konto aus, bis eine App sie einschaltet. Pages nennt `notifications.team.v1` immer zusammen mit `notifications.v1`; ein Pages ohne die Capability beantwortet die beiden Nachrichten mit `unknown_type`.

**`notification_settings_get`** (Client → Pages, nur nach `auth`) hat den Payload `{}`; unbekannte Felder werden ignoriert. **`notification_settings_set`** ändert die genannten Einstellungen; fehlende bleiben, wie sie sind:

```json
{
  "version": 1,
  "type": "notification_settings_set",
  "requestId": "s1",
  "payload": { "teamRuns": true }
}
```

`teamRuns` muss `true` oder `false` sein, sonst `invalid_message`. Ein Konto- oder Gerätefeld nimmt die Nachricht nicht an: es gilt immer das Konto der authentifizierten Sitzung, fremde Konten lassen sich nicht einstellen. Beide Anfragen beantwortet Pages mit **`notification_settings`** und derselben `requestId`:

```json
{
  "version": 1,
  "type": "notification_settings",
  "requestId": "s1",
  "payload": {
    "accountId": "…",
    "teamRuns": { "isAvailable": true, "isEnabled": true }
  }
}
```

| Feld                   | Bedeutung                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountId`            | immer `connected.payload.user.id`.                                                                                                                                                     |
| `teamRuns.isAvailable` | `false`, solange Pages keinen verwendbaren FCM-Sender hat. Dann ist auch `isEnabled` `false`, gleich was das Konto gespeichert hat: Nicht Lieferbares erscheint nie als eingeschaltet. |
| `teamRuns.isEnabled`   | ob Pages dem Konto Team-Läufe meldet.                                                                                                                                                  |

Regeln:

- **Standard aus.** Für bestehende und neue Konten und Registrierungen ist `teamRuns` aus.
- **Je Konto und Pages-Instanz.** Die Einstellung gehört dem Konto auf dieser Pages-Instanz, nicht dem Gerät oder der Sitzung. Sie bleibt bei erneuter Registrierung, neuer Sitzung und Neustart erhalten und gilt für alle Geräte des Kontos.
- **Einschalten ohne FCM** beantwortet Pages mit `server_unavailable` und speichert nichts. Ausschalten geht immer.
- **Kein Nachholen.** Erneutes Einschalten wirkt ab diesem Moment; frühere Läufe und Ereignisse werden weder erzeugt noch zugestellt. Ausschalten verwirft wartende Team-Zustellungen und macht Team-Ereignisse beim Abruf `forbidden`.
- **Sitzung.** Endet die Sitzung oder gilt das Konto nicht mehr, beendet Pages die Sitzung wie bei den anderen Anfragen.

## Authentifizierung und Rechte

Pica Mobile führt keinen eigenen Zugang ein, sondern nutzt die Pages-Konten:

- `method: "password"` ist ein normaler Pages-Login: gleiche Prüfung, gleiche Sperre nach zu vielen Fehlversuchen (pro Benutzername und Adresse), gleiche Sitzung. Die ausgestellte Sitzung erscheint in Einstellungen → Persönlich → Sicherheit und lässt sich dort beenden.
- `method: "session"` weist eine solche Sitzung vor. Sie ist 14 Tage gültig, wie im Browser.
- Konten, die ihr Passwort erst ändern müssen, können sich nicht verbinden (`password_change_required`), ebenso wenig wie sie Pages im Browser nutzen können.

Die Verbindung gehört nach `connected` genau diesem Benutzer. Alle späteren fachlichen Nachrichten prüft der Server bei jeder Nachricht gegen die aktuellen Rechte dieses Benutzers; was die App anzeigt, entscheidet nichts. Fachliche Nachrichten sind `dashboard_get` und `avatar_get` der Erweiterung `dashboard.v1`, `notification_register`, `notification_unregister` und `notification_event_get` der Erweiterung `notifications.v1` , `plans_sync` und `plan_get` der Erweiterung `plans.v1` (auch mit `flow` der Erweiterung `plans.flow.v1`) sowie die acht `chat_*`-Anfragen und die Datei-Endpunkte der Erweiterung `chat.v1` und `chat_delete` der Erweiterung `chat.delete`.

Pages prüft die Sitzung einer Verbindung etwa jede Minute neu. Wurde sie beendet oder das Konto deaktiviert, sendet Pages `authentication_failed` und trennt mit Code 1008 („Session ended“). Schlägt nur die Prüfung selbst fehl (zum Beispiel wegen einer Störung der Datenbank), bleibt die Verbindung bestehen.

## Heartbeat, Abbrüche und Grenzen

| Wert                                    | Größe         | Wirkung                                                                                                                                          |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| WebSocket-Ping des Servers              | alle 20 s     | Standard-Pings; Browser und React Native antworten selbstständig mit Pong                                                                        |
| Stille einer Verbindung                 | mehr als 45 s | Pages beendet die Verbindung ohne Abschlussaustausch                                                                                             |
| Zeit bis zur Authentifizierung          | 10 s          | danach Close-Code 1008 „Authentication timeout“                                                                                                  |
| Größe einer Nachricht                   | 16 KiB        | vor der Anmeldung beendet ein größerer Frame die Verbindung (Close-Code 1009); danach wird er mit `invalid_message` abgelehnt, außer `chat_send` |
| Größe von `chat_send`                   | 128 KiB       | größere Frames beenden die Verbindung (Close-Code 1009)                                                                                          |
| unerledigte Nachrichten je Verbindung   | 8             | mehr beenden die Verbindung (1008 „Too many pending messages“)                                                                                   |
| Verbindungen insgesamt                  | 100           | weitere Handshakes erhalten HTTP 503                                                                                                             |
| Abschluss-Handshake bei Pages-Schließen | 2 s           | danach wird die Verbindung getrennt                                                                                                              |

Jede Nachricht und jedes Pong des Clients gilt als Lebenszeichen. Eine App sollte zusätzlich ein `ping` senden, wenn sie länger als 30 Sekunden nichts gesendet hat, damit Mobilfunk- und NAT-Zustände offen bleiben, und die Laufzeit des `pong` für ihre Verbindungsanzeige nutzen.

Close-Codes, die Pages sendet:

| Code | Anlass                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 1001 | Pages beendet sich oder der Administrator hat den Port gewechselt: verbinde dich mit der Adresse neu               |
| 1008 | Verstoß gegen die Regeln: Authentifizierungsfrist, zu viele Fehlversuche, Ablehnungen, Rate-Limit, Sitzung beendet |
| 1009 | Nachricht zu groß                                                                                                  |

Ein Abbruch wegen verlorener Verbindung (1006) oder Pages-Neustart (1001) ist normal. Die App verbindet sich mit wachsendem Abstand (zum Beispiel 1 s, 2 s, 5 s, bis 30 s) neu, authentifiziert sich mit `method: "session"` und beendet den Versuch bei `authentication_failed` durch Anmelden mit dem Passwort. Nach 1008 wartet sie mindestens 30 Sekunden.

## Sicherheit

- **Kein TLS in Version 1.** Auf `ws://` sind Passwort, Sitzungstoken und alle Nachrichten im Netz lesbar, mit `chat.v1` auch alle Chat-Inhalte; die Datei-Endpunkte übertragen Dateien und das Sitzungstoken (`Authorization`) über `http://` ebenso im Klartext. Betreibe den Endpunkt nur in einem vertrauenswürdigen Netz und gib den Port nicht ins Internet frei. Eine spätere Version ergänzt `wss://`.
- Der Endpunkt liest keine Cookies; fremde Webseiten können über den Browser des Administrators keine Verbindung als er aufbauen.
- Fehlversuche sind pro Verbindung (3) und pro Benutzername und Adresse (Anmeldesperre von Pages) begrenzt.
- Das Protokoll enthält weder Passwörter noch Tokens: Pages protokolliert Start, Portwechsel, Öffnen und Schließen von Verbindungen, Ablehnungsgründe (nur den Code) und Fehler. Die ersten fünf Ablehnungen je Verbindung werden protokolliert, damit ein Client das Protokoll nicht füllen kann. Nachrichteninhalte stehen nie im Protokoll.
- Ein Fehler einer Verbindung beendet nur diese Verbindung; der Server läuft weiter.

## Entwurfsentscheidungen

- **Eigener Port statt Pfad am Webserver.** Die App-Adresse bleibt unabhängig vom Webserver (und von einem späteren Proxy) und der Administrator wählt den Port. Der Endpunkt ist standardmäßig aus.
- **Sitzungen statt neuer Tokenart.** Pica Mobile ist ein Client des Benutzers selbst, deshalb nutzt es dessen Login und Sitzung statt eines eigenen Tokens.
- **`version` in jeder Nachricht.** So lässt sich Version 2 neben Version 1 einführen, ohne dass der Handshake sich ändert; Pages nennt in `unsupported_version` die unterstützten Versionen.
