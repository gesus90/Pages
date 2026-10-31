# Pica Mobile: WebSocket-Anbindung (PAGE-148, PAGE-164)

Pages stellt für die App Pica Mobile einen WebSocket-Endpunkt bereit. Dieses Dokument ist der Vertrag zwischen Pages und der App: Es beschreibt, wie ein Administrator den Endpunkt einrichtet, wie eine Verbindung aufgebaut wird und welche Nachrichten in Version 1 des Formats gelten.

Version 1 spricht `ws://` ohne TLS. Anmeldedaten und Sitzungstoken sind im Netzwerk lesbar, solange kein `wss://` zur Verfügung steht; der Endpunkt gehört deshalb nur in ein vertrauenswürdiges Netz (siehe [Sicherheit](#sicherheit)). Version 1 enthält Authentifizierung, Verbindungsbestätigung, Heartbeat und strukturierte Fehler sowie die Erweiterung `dashboard.v1` (Profil, eigene aktive Läufe, zugewiesene Projekte, Avatar; siehe [Erweiterung dashboard.v1](#erweiterung-dashboardv1)). Chat gehört nicht dazu.

## Einrichtung durch einen Administrator

Einstellungen → Verbindungen zeigt Administratoren im Admin-Modus oben die Karte „Pica Mobile“:

- **WebSocket-Port**: eine ganze Zahl von 1 bis 65535. Eingaben außerhalb davon lassen sich nicht speichern.
- **Verbindungsadresse**: `ws://<Host>:<Port>/pica-mobile`, die Adresse für die App. Sie ändert sich mit der Eingabe und gilt nach dem Speichern.
- **Speichern** bindet den Port, schreibt ihn in die Konfiguration und lässt den Endpunkt dort lauschen.

Der Host der Adresse ist nie `localhost`, denn der zeigt auf das Smartphone selbst. Pages nimmt (1) eine in der Konfiguration gesetzte `listenAddress`, sonst (2) den Host, mit dem der Administrator Pages im Browser geöffnet hat, und fällt bei einem Loopback-Namen auf (3) die erste externe IPv4-Adresse des Servers zurück. Findet sich keine, zeigt die Karte stattdessen einen Hinweis, Pages über die Netzwerkadresse des Servers zu öffnen.

Andere Benutzer sehen die Karte nicht. Der Server prüft die Berechtigung bei jedem Speichern erneut (aktiver Administrator im Admin-Modus), unabhängig davon, was die Oberfläche anzeigt.

### Speicherung und Neustart

Der Port steht in `~/.pages/config.toml` als `picaMobilePort`. Ohne den Schlüssel ist der Endpunkt aus und es wird kein zusätzlicher Port geöffnet. Beim Start lauscht Pages auf dem gespeicherten Port; ein Neustart behält die Einstellung. Der Schlüssel darf auch von Hand gesetzt werden; ein Wert außerhalb von 1 bis 65535 verhindert den Start mit einer Fehlermeldung zur Konfiguration, wie bei `port`. Der Endpunkt lauscht auf derselben Schnittstelle wie Pages (`listenAddress`, sonst auf allen).

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

Der Handshake verlangt weder Cookies noch Header oder Subprotokoll. Eine Browser- oder App-Herkunft (`Origin`) wird nicht ausgewertet, denn der Endpunkt liest keine Cookies; berechtigt ist allein, wer sich mit einer `auth`-Nachricht ausweist. Ein einfacher HTTP-Aufruf des Ports ohne Upgrade wird mit `426 Upgrade Required` beantwortet.

Bis `auth` gelingt, lehnt Pages jede andere Nachricht mit `authentication_required` ab. Wer nicht binnen 10 Sekunden erfolgreich authentifiziert, wird mit Code 1008 getrennt.

## Nachrichtenformat

Jede Nachricht ist ein WebSocket-**Textframe** mit einem JSON-Objekt. Nachrichten des Clients sind höchstens 16 KiB (`16384` Bytes) groß; die Antworten von Pages unterliegen dieser Grenze nicht (ein `avatar` trägt bis zu 128 KiB Bilddaten). Binärframes lehnt Pages ab. In beide Richtungen gilt dieselbe Hülle:

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

`server.capabilities` nennt die Erweiterungen von Version 1, die diese Verbindung beantwortet. Pages nennt `dashboard.v1` nur, wenn es den gesamten Vertrag der Erweiterung beantwortet. Ein Pages ohne das Feld kennt die Erweiterung nicht; ein Client behandelt ein fehlendes Feld wie eine leere Liste und fragt dann kein Dashboard ab.

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

| `code`                     | Wann                                                                                                                                                          | Folge                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `invalid_message`          | kein JSON-Objekt, Pflichtfeld fehlt oder ungültig, Payload ungültig, Binärframe; `avatar_get` mit einer Version, die nicht (mehr) die aktuelle des Kontos ist | Verbindung bleibt                                                                    |
| `unsupported_version`      | `version` nicht unterstützt (`supportedVersions` nennt die erlaubten)                                                                                         | Verbindung bleibt                                                                    |
| `unknown_type`             | `type` unbekannt, auch `dashboard_get` und `avatar_get` bei einem Pages ohne `dashboard.v1`                                                                   | Verbindung bleibt                                                                    |
| `authentication_required`  | andere Nachricht als `auth` vor erfolgreicher Authentifizierung                                                                                               | Verbindung bleibt                                                                    |
| `authentication_failed`    | Zugangsdaten oder Sitzungstoken ungültig, Konto deaktiviert; auch bei später beendeter Sitzung, auch als Antwort auf ein `dashboard_get` oder `avatar_get`    | nach 3 Fehlversuchen getrennt; ist die Sitzung beendet, wird die Verbindung getrennt |
| `password_change_required` | das Konto muss in Pages zuerst sein Passwort ändern                                                                                                           | wie `authentication_failed`                                                          |
| `too_many_attempts`        | die Anmeldesperre von Pages greift (`retryAfterSeconds`)                                                                                                      | wie `authentication_failed`                                                          |
| `already_authenticated`    | zweites `auth` auf einer authentifizierten Verbindung                                                                                                         | Verbindung bleibt                                                                    |
| `rate_limited`             | mehr als 30 Nachrichten in 10 Sekunden                                                                                                                        | Verbindung wird getrennt                                                             |
| `server_unavailable`       | Pages kann die Nachricht gerade nicht entscheiden (zum Beispiel vor Abschluss des Setups)                                                                     | Verbindung bleibt                                                                    |

Fünf abgelehnte Nachrichten in Folge trennen die Verbindung (Code 1008, „Too many rejected messages“); eine gültige Nachricht setzt den Zähler zurück.

## Erweiterung dashboard.v1

Die Erweiterung liefert der angemeldeten App echte Daten des Kontos: Profil, die eigenen aktiven Plan-Läufe und die zugewiesenen Projekte, dazu das Profilbild. Sie folgt dem Vertrag `PM-13-1` des Clients (Pica Mobile, `docs/wire-contract.md`, Revision vom 30.10.2026) in der Fassung des Tickets PAGE-164; offene Abstimmungspunkte stehen am Ende des Abschnitts. Hülle, Authentifizierung, Heartbeat, Rate-Limit und Fehlerregeln von Version 1 gelten unverändert; die Erweiterung führt weder eine zweite Anmeldung noch einen Push- oder Livekanal, Chat oder Plansteuerung ein und liest nur: sie verändert keine fachlichen Daten (die Sitzungsprüfung vermerkt wie bei jeder Nachricht die letzte Nutzung der Sitzung). Die App fragt nach der Anmeldung, beim Wechsel in den Vordergrund, nach einer Wiederverbindung und beim Herunterziehen zum Aktualisieren; Pages sendet nichts von sich aus.

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
| Schleife                                              | eine Stufe `loop` mit der Schleife als einem Schritt, ohne ihre Mitglieder    |
| `icon` eines Projekts                                 | immer `null`                                                                  |
| `progress` eines Projekts                             | gespeicherte Prozent plus Ziele; `null` ohne Ziele                            |
| `ticket` eines Laufs                                  | nur bei genau einem Ticket                                                    |

## Authentifizierung und Rechte

Pica Mobile führt keinen eigenen Zugang ein, sondern nutzt die Pages-Konten:

- `method: "password"` ist ein normaler Pages-Login: gleiche Prüfung, gleiche Sperre nach zu vielen Fehlversuchen (pro Benutzername und Adresse), gleiche Sitzung. Die ausgestellte Sitzung erscheint in Einstellungen → Persönlich → Sicherheit und lässt sich dort beenden.
- `method: "session"` weist eine solche Sitzung vor. Sie ist 14 Tage gültig, wie im Browser.
- Konten, die ihr Passwort erst ändern müssen, können sich nicht verbinden (`password_change_required`), ebenso wenig wie sie Pages im Browser nutzen können.

Die Verbindung gehört nach `connected` genau diesem Benutzer. Alle späteren fachlichen Nachrichten prüft der Server bei jeder Nachricht gegen die aktuellen Rechte dieses Benutzers; was die App anzeigt, entscheidet nichts. Fachliche Nachrichten sind `dashboard_get` und `avatar_get` der Erweiterung `dashboard.v1`.

Pages prüft die Sitzung einer Verbindung etwa jede Minute neu. Wurde sie beendet oder das Konto deaktiviert, sendet Pages `authentication_failed` und trennt mit Code 1008 („Session ended“). Schlägt nur die Prüfung selbst fehl (zum Beispiel wegen einer Störung der Datenbank), bleibt die Verbindung bestehen.

## Heartbeat, Abbrüche und Grenzen

| Wert                                    | Größe         | Wirkung                                                                   |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| WebSocket-Ping des Servers              | alle 20 s     | Standard-Pings; Browser und React Native antworten selbstständig mit Pong |
| Stille einer Verbindung                 | mehr als 45 s | Pages beendet die Verbindung ohne Abschlussaustausch                      |
| Zeit bis zur Authentifizierung          | 10 s          | danach Close-Code 1008 „Authentication timeout“                           |
| Größe einer Nachricht                   | 16 KiB        | größere Frames beenden die Verbindung (Close-Code 1009)                   |
| unerledigte Nachrichten je Verbindung   | 8             | mehr beenden die Verbindung (1008 „Too many pending messages“)            |
| Verbindungen insgesamt                  | 100           | weitere Handshakes erhalten HTTP 503                                      |
| Abschluss-Handshake bei Pages-Schließen | 2 s           | danach wird die Verbindung getrennt                                       |

Jede Nachricht und jedes Pong des Clients gilt als Lebenszeichen. Eine App sollte zusätzlich ein `ping` senden, wenn sie länger als 30 Sekunden nichts gesendet hat, damit Mobilfunk- und NAT-Zustände offen bleiben, und die Laufzeit des `pong` für ihre Verbindungsanzeige nutzen.

Close-Codes, die Pages sendet:

| Code | Anlass                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 1001 | Pages beendet sich oder der Administrator hat den Port gewechselt: verbinde dich mit der Adresse neu               |
| 1008 | Verstoß gegen die Regeln: Authentifizierungsfrist, zu viele Fehlversuche, Ablehnungen, Rate-Limit, Sitzung beendet |
| 1009 | Nachricht zu groß                                                                                                  |

Ein Abbruch wegen verlorener Verbindung (1006) oder Pages-Neustart (1001) ist normal. Die App verbindet sich mit wachsendem Abstand (zum Beispiel 1 s, 2 s, 5 s, bis 30 s) neu, authentifiziert sich mit `method: "session"` und beendet den Versuch bei `authentication_failed` durch Anmelden mit dem Passwort. Nach 1008 wartet sie mindestens 30 Sekunden.

## Sicherheit

- **Kein TLS in Version 1.** Auf `ws://` sind Passwort, Sitzungstoken und alle Nachrichten im Netz lesbar. Betreibe den Endpunkt nur in einem vertrauenswürdigen Netz und gib den Port nicht ins Internet frei. Eine spätere Version ergänzt `wss://`.
- Der Endpunkt liest keine Cookies; fremde Webseiten können über den Browser des Administrators keine Verbindung als er aufbauen.
- Fehlversuche sind pro Verbindung (3) und pro Benutzername und Adresse (Anmeldesperre von Pages) begrenzt.
- Das Protokoll enthält weder Passwörter noch Tokens: Pages protokolliert Start, Portwechsel, Öffnen und Schließen von Verbindungen, Ablehnungsgründe (nur den Code) und Fehler. Die ersten fünf Ablehnungen je Verbindung werden protokolliert, damit ein Client das Protokoll nicht füllen kann. Nachrichteninhalte stehen nie im Protokoll.
- Ein Fehler einer Verbindung beendet nur diese Verbindung; der Server läuft weiter.

## Entwurfsentscheidungen

- **Eigener Port statt Pfad am Webserver.** Die App-Adresse bleibt unabhängig vom Webserver (und von einem späteren Proxy) und der Administrator wählt den Port. Der Endpunkt ist standardmäßig aus.
- **Sitzungen statt neuer Tokenart.** Die vorhandenen Pairing- und Personal-Tokens gehören zu MCP-Agenten mit eigenem Geltungsbereich; Pica Mobile ist ein Client des Benutzers selbst, deshalb nutzt es dessen Login und Sitzung.
- **`version` in jeder Nachricht.** So lässt sich Version 2 neben Version 1 einführen, ohne dass der Handshake sich ändert; Pages nennt in `unsupported_version` die unterstützten Versionen.
