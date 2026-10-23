# Pica Mobile: WebSocket-Anbindung (PAGE-148)

Pages stellt für die App Pica Mobile einen WebSocket-Endpunkt bereit. Dieses Dokument ist der Vertrag zwischen Pages und der App: Es beschreibt, wie ein Administrator den Endpunkt einrichtet, wie eine Verbindung aufgebaut wird und welche Nachrichten in Version 1 des Formats gelten.

Version 1 spricht `ws://` ohne TLS. Anmeldedaten und Sitzungstoken sind im Netzwerk lesbar, solange kein `wss://` zur Verfügung steht; der Endpunkt gehört deshalb nur in ein vertrauenswürdiges Netz (siehe [Sicherheit](#sicherheit)). Version 1 enthält weder Chat noch fachliche Funktionen: nur Authentifizierung, Verbindungsbestätigung, Heartbeat und strukturierte Fehler.

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

Jede Nachricht ist ein WebSocket-**Textframe** mit einem JSON-Objekt, höchstens 16 KiB (`16384` Bytes) groß. Binärframes lehnt Pages ab. In beide Richtungen gilt dieselbe Hülle:

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
    "server": { "version": "0.1.0", "protocolVersions": [1] }
  }
}
```

`sessionToken` ist bei `method: "password"` das neu ausgestellte Sitzungstoken und sonst `null`. Die App speichert das Token im sicheren Speicher des Geräts und meldet sich danach mit `method: "session"` an; das Passwort behält sie nicht.

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

| `code`                     | Wann                                                                                           | Folge                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| `invalid_message`          | kein JSON-Objekt, Pflichtfeld fehlt oder ungültig, Payload ungültig, Binärframe                | Verbindung bleibt             |
| `unsupported_version`      | `version` nicht unterstützt (`supportedVersions` nennt die erlaubten)                          | Verbindung bleibt             |
| `unknown_type`             | `type` unbekannt                                                                               | Verbindung bleibt             |
| `authentication_required`  | andere Nachricht als `auth` vor erfolgreicher Authentifizierung                                | Verbindung bleibt             |
| `authentication_failed`    | Zugangsdaten oder Sitzungstoken ungültig, Konto deaktiviert; auch bei später beendeter Sitzung | nach 3 Fehlversuchen getrennt |
| `password_change_required` | das Konto muss in Pages zuerst sein Passwort ändern                                            | wie `authentication_failed`   |
| `too_many_attempts`        | die Anmeldesperre von Pages greift (`retryAfterSeconds`)                                       | wie `authentication_failed`   |
| `already_authenticated`    | zweites `auth` auf einer authentifizierten Verbindung                                          | Verbindung bleibt             |
| `rate_limited`             | mehr als 30 Nachrichten in 10 Sekunden                                                         | Verbindung wird getrennt      |
| `server_unavailable`       | Pages kann die Nachricht gerade nicht entscheiden (zum Beispiel vor Abschluss des Setups)      | Verbindung bleibt             |

Fünf abgelehnte Nachrichten in Folge trennen die Verbindung (Code 1008, „Too many rejected messages“); eine gültige Nachricht setzt den Zähler zurück.

## Authentifizierung und Rechte

Pica Mobile führt keinen eigenen Zugang ein, sondern nutzt die Pages-Konten:

- `method: "password"` ist ein normaler Pages-Login: gleiche Prüfung, gleiche Sperre nach zu vielen Fehlversuchen (pro Benutzername und Adresse), gleiche Sitzung. Die ausgestellte Sitzung erscheint in Einstellungen → Persönlich → Sicherheit und lässt sich dort beenden.
- `method: "session"` weist eine solche Sitzung vor. Sie ist 14 Tage gültig, wie im Browser.
- Konten, die ihr Passwort erst ändern müssen, können sich nicht verbinden (`password_change_required`), ebenso wenig wie sie Pages im Browser nutzen können.

Die Verbindung gehört nach `connected` genau diesem Benutzer. Alle späteren fachlichen Nachrichten prüft der Server bei jeder Nachricht gegen die aktuellen Rechte dieses Benutzers; was die App anzeigt, entscheidet nichts. Version 1 hat keine solchen Nachrichten.

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
