# Team-Zugriff auf Storage und Projektcode

Seit PAGE-323 arbeitet jedes Konto mit seinen eigenen Pages-Rechten. Ein Agent
braucht keinen Admin-Modus, um Berichte in freigegebenen Ordnern abzulegen oder
den Code eines sichtbaren Projekts zu lesen.

## Einrichtung durch einen Administrator

1. Im Admin-Modus unter **Einstellungen → System → Google Drive** die
   Instanzverbindung einrichten. Google muss Schreibzugriff erlauben; eine
   Pages-Freigabe erweitert Googles Rechte nicht.
2. Unter **Storage** die Ordner `Storage/Pages`, `Storage/Pages MCP` und
   `Storage/Pica Mobile` anlegen. Vorhandene Ordner weiterverwenden.
3. Unter **Einstellungen → System → Storage schreiben** jeweils den
   vollständigen Ordnerpfad eingeben, zum Beispiel `/Storage/Pages`.
   Als Empfänger die **Gruppe A-Team** wählen und **Storage schreiben erlauben**
   anklicken. Für die beiden anderen Ordner wiederholen.
4. Die gespeicherten Einträge in der Liste prüfen. **Entziehen** widerruft genau
   diesen Eintrag. Andere Freigaben bleiben erhalten.

Die Gruppe A-Team umfasst All Might, Ed, Mei, Conan und Bakuman. Die Abteilung
Entwicklung ist kein Ersatz: Conan und Bakuman gehören ihr nicht an. Neue
Gruppenmitglieder erhalten das Recht automatisch; entfernte Mitglieder verlieren
es beim nächsten Aufruf. Es werden keine Einzelkonten freigeschaltet. Igor
behält seinen Zugriff als Administrator. Auch Rollen und Abteilungen können
explizit als Empfänger gewählt werden; Freigaben wirken additiv.

Pages prüft beim Speichern, dass Pfad und Empfänger existieren. Gespeichert
werden die stabile Ordner-ID und die Identität des verbundenen Google-Kontos.
Umbenennen eines Ordners entzieht die Freigabe nicht; das Verbinden eines anderen
Google-Kontos übernimmt alte Freigaben nicht. Die Migration legt keine
Produktivordner, Gruppenmitgliedschaften oder Freigaben automatisch an.

## Was Mitglieder dürfen

Das Recht umfasst den freigegebenen Ordner und seine Unterordner:

- Inhalt auflisten und Dateien lesen oder herunterladen;
- Unterordner anlegen;
- Dateien hochladen und neue Versionen speichern.

Andere Ordner sind gesperrt. Löschen, Verschieben, Umbenennen, Kopieren,
Wiederherstellen und Sammeländerungen bleiben beim aktiven Administrator.
Globales Suchen, Papierkorb und Speicherquote bleiben ebenfalls administrativ;
Suchen in einem freigegebenen Ordner ist erlaubt.

In Storage sehen Mitglieder zunächst **Freigegebene Ordner**. Die Oberfläche
aktiviert nur erlaubte Aktionen. Der Server prüft jede Anfrage unabhängig davon,
auch wenn eine Freigabe zwischenzeitlich entzogen wurde. Im **Storage-Verlauf**
stehen die erfolgreichen Aktionen unter dem Namen des handelnden Kontos.
Mitglieder sehen ihre eigenen Einträge, Administratoren alle. Der Verlauf enthält
keine Dateiinhalte oder Zugangsdaten.

## Pica- und Agent-Werkzeuge

`storage_capabilities` nennt die erlaubten Operationen und `grantedFolders` mit
`ref` und Name. Diese Referenzen für `storage_list`, `storage_create_folder` und
`storage_upload` verwenden. Ein Upload eines Berichts hat zum Beispiel diese
Argumente:

```json
{
  "parentRef": "<ref des freigegebenen Ordners>",
  "name": "Changelog.md",
  "content": "# Changelog\n\nÄnderungen …",
  "encoding": "text",
  "mimeType": "text/markdown"
}
```

`storage_update` speichert eine neue Version. Die bestehende Bestätigung für
Ersetzen/Überschreiben bleibt erforderlich und an Konto, Aktion, Datei und
Version gebunden. Pica hält den Bestätigungstoken serverseitig. Fehlende Rechte
liefern `FORBIDDEN`; die HTTP-Schnittstellen verwenden den bestehenden Code
`forbidden` mit Status 403. Eine Ablehnung ändert nichts.

Auch der bestehende, schrittgebundene Plan-Bridge-Katalog bietet die Werkzeuge
an. Eine Sitzung mit Nur-Lesen-Reichweite erhält ausschließlich Leseoperationen;
eine volle Sitzung darf zusätzlich `storage_create_folder`, `storage_upload` und
`storage_update` verwenden. Ticketgebundene Sitzungen erhalten diese Werkzeuge
nicht. Schreibaufrufe der Plan-Bridge benötigen `operationId`; Pages reserviert
diese dauerhaft vor dem Drive-Aufruf und speichert anschließend das Ergebnis.
Eine unveränderte Wiederholung liefert den gespeicherten Beleg, prüft aber
zuerst erneut das Ordnerrecht. Ein nach Abbruch unvollständiger Beleg liefert
`CONFLICT`: zuerst den tatsächlichen Ordnerinhalt prüfen, keine blinde
Wiederholung mit neuer ID. Nach einer Bestätigungsanforderung einen neuen
Aufruf mit neuer ID und dem an Datei und Version gebundenen Token verwenden.

Das authentifizierte API-Präfix bleibt `/api/mcp/v1/storage/`. Es gibt keinen neuen
externen MCP-Server oder Zugriff auf einen Sitzungs-Checkout.

## Projekt-Repository lesend nutzen

Ein Administrator hinterlegt die GitHub-Verbindung beim jeweiligen Projekt.
Das vorhandene Token bleibt verschlüsselt in Pages. Für die lesenden Werkzeuge
reicht bei einem Fine-grained Token das Repository-Recht **Contents: read**.
Die Synchronisation muss für die Leseaufrufe nicht eingeschaltet sein.
Siehe [GitHub-Dokumentation](https://docs.github.com/en/rest/commits/commits).

Jeder Aufruf prüft das aktive Konto und dessen aktuellen Zugriff auf das
Projekt, bevor Pages das Token lädt. Das Modell erhält weder Token noch
Deploy-Key. Es wird kein Klon angelegt und kein Checkout eingebunden.

| Werkzeug          | Eingabe                                                  | Ergebnis                                           |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `repository_log`  | `projectId`, optional `range`, `commit`, `page`, `limit` | Commits, Reihenfolge und nächste Seite             |
| `repository_diff` | `projectId`, `base`, `head`                              | GitHub-Vergleich ab gemeinsamem Vorfahren, Patches |
| `repository_show` | `projectId`, `commit`, optional `page`, `limit`          | Commit und eine Seite geänderter Dateien           |
| `repository_file` | `projectId`, `commit`, `path`                            | Textdatei an diesem Commit                         |

Beispiel für den angefragten Bereich:

```json
{ "projectId": "<Pages-Projekt-ID>", "range": "c5ee1978..3468b2db" }
```

Bereiche erscheinen in GitHubs Vergleichsreihenfolge, ältester Commit zuerst;
History ohne Bereich erscheint neuester zuerst. `nextPage` bis `null` verfolgen.
Commit-Referenzen müssen hexadezimale SHAs mit 7–40 Zeichen sein. Dateipfade sind
relativ zum Repository und dürfen weder `..` noch absolute Pfade enthalten.
Vergleiche können bei GitHub auf 300 Dateien begrenzt sein; das Ergebnis nennt
`fileLimit`, `filesMayBeTruncated` und `missingPatches`. Show-Seiten nennen fehlende
Patches ebenfalls. Binärdateien haben keinen Text-Patch. Antworten sind auf
512 KiB, Textdateien auf 128 KiB und native Tool-Ergebnisse zusätzlich auf das
Pages-Ergebnisbudget begrenzt. Zu große Antworten liefern `TOO_LARGE`.

Die GET-Endpunkte sind `/api/mcp/v1/repository/log`, `/diff`, `/show` und `/file`,
mit denselben Argumenten als Query-Parameter und Pages-Bearer-Authentifizierung.
Schreibende Methoden liefern 405. Provider-Fehler werden ohne Antwortkörper oder
Transportdiagnose in nativen Tools und der GET-API als `PROVIDER_UNAVAILABLE` weitergegeben. Die Plan-Bridge verwendet die bestehenden Agent-Fehlercodes: fehlende oder unbrauchbare Repository-Verbindungen werden dort als `INVALID_REQUEST`, zu große Ergebnisse als `PAYLOAD_TOO_LARGE` gemeldet. Zugangsdaten werden
auch aus zurückgelieferten Texten entfernt. Fehlender Projektzugriff liefert
`FORBIDDEN`, eine fehlende Verbindung `NOT_CONNECTED`.

Schreibzugriff auf Arbeitsbranches und `main` ist nicht Bestandteil dieses
Rechts. Darüber entscheidet Igor gesondert.
