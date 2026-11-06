# Anfragen über Prozessgrenzen verfolgen

`correlationId` ist die gemeinsame Kennung einer ausgelösten Arbeit. Sie steht
auf oberster Ebene der bestehenden strukturierten JSON-Logzeilen. `requestId`
bezeichnet dagegen genau eine HTTP-Anfrage und wird von Pages immer neu erzeugt;
die Antwort liefert sie weiterhin als `X-Request-ID`.

Interne HTTP-Aufrufe senden `X-Correlation-ID`. Pages übernimmt eine einzelne
Kennung aus 1 bis 128 ASCII-Zeichen: zuerst Buchstabe oder Ziffer, danach außerdem
Punkt, Unterstrich, Doppelpunkt und Bindestrich. Fehlende, mehrfache oder ungültige
Werte beginnen mit der neuen `requestId` eine eigene Korrelation. Die Antwort
enthält die gewählte Kennung in `X-Correlation-ID`. Diese Kennung gewährt keine
Rechte und ersetzt keine Authentifizierung. Sie darf keine Nutzdaten oder Secrets
enthalten.

Pages übergibt `PAGES_CORRELATION_ID` in den expliziten Umgebungen lokaler
CLI-Agenten, ihrer Worker-Units, Plan-Skripte und der ACP-MCP-Brücke. Ein Prozess,
der den Pages-Logger verwendet, übernimmt die validierte Umgebungskennung beim
Laden des Loggers. Andere Worker lesen dieselbe Variable für ihre eigene
Protokollierung. Der eigenständige MCP-Prozess sendet sie bei Agent-API-Aufrufen
und Asset-Uploads als `X-Correlation-ID` zurück. Externe Provider-APIs erhalten
diesen internen Header nicht.

Geschäftsoperationen und Jobs behalten die Korrelation ihres Auslösers; ohne
Auslöser erzeugen sie eine neue UUID. `withBackgroundDatabaseWork` behält die
Logkorrelation und entfernt das Abbruchsignal sowie das kurze Datenbankbudget
der auslösenden Anfrage. Ein expliziter Stop und der geordnete Server-Shutdown
bleiben wirksam. Der Planscheduler hält die Logfakten pro aktivem Lauf fest,
damit ein Poll oder ein anderer Lauf sie beim nächsten Schritt nicht ersetzt.
Nach einem Prozessneustart beginnt ein neu ausgelöster Lauf eine neue Korrelation;
`runId` verbindet ihn mit den vorhandenen Laufprotokollen. Das externe
Runner-Protokoll wird durch diesen HTTP-/Umgebungsvertrag nicht erweitert.

Zur Suche zuerst `X-Correlation-ID` aus der Antwort oder `correlationId` aus einer
bekannten Zeile ablesen. Dann die JSON-Dateien im `log/`-Verzeichnis neben der
jeweiligen Instanzkonfiguration und die Worker-Logs nach dieser Kennung filtern:

```sh
jq -c --arg id 'KENNUNG' 'select(.correlationId == $id)' /private/instance/log/*.jsonl
```

`time`, `component`, `event`, `pid` und `instanceId` zeigen Reihenfolge und
Prozessgrenzen. Unterschiedliche `requestId` bei gleicher `correlationId` sind
erwartet. `runId`, `jobId` und `attemptId` grenzen die Arbeit weiter ein. Schema,
Schweregrade, Meldungen, Metadaten, Fehlerdarstellung, Redaktion und Dateirotation
behalten ihr bestehendes Format.
