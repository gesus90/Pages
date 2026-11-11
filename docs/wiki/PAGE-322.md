# MCP Interface – Löschungen ohne Bestätigungswort

Entwurf für den Abschnitt **Löschen und Bestätigung** der Wiki-Seite „MCP Interface“. Die übrigen Abschnitte der bestehenden Seite bleiben bei der Übernahme erhalten.

Ein Löschaufruf braucht kein eingetipptes Wort mehr. Ein Agent ruft ein löschendes Werkzeug nur auf, wenn die Person die Löschung des konkreten Ziels in ihrer **aktuellen Nachricht ausdrücklich verlangt**. Bei mehrdeutigen Zielen fragt der Agent nach. Ein MCP-Client zeigt der Person den gelesenen Zielzustand und, wo vorgesehen, die Vorschau; seine Löschanforderung bezieht sich auf genau dieses Objekt. Die Pages-Oberfläche fragt mit einem Dialog samt „Abbrechen“ und roter Schaltfläche „Löschen“ oder „Endgültig löschen“ nach.

Die Löschwerkzeuge `delete_ticket`, `delete_milestone`, `wiki_page_delete` (Agent-Werkzeug `delete_wiki_page`), `wiki_comment_delete` (Agent-Werkzeug `delete_wiki_comment`), `delete_plan`, `delete_plan_template`, `delete_chat_sessions` und `delete_admin_project` verlangen kein `confirmation`-Feld. Dies gilt auch für Löschungen von Gruppen, Abteilungen und Rollen sowie weitere Löschoperationen. Für ältere Clients nimmt Pages ein noch mitgesendetes `confirmation` während der Übergangszeit an und ignoriert seinen Wert. Antworten liefern kein `confirmationWord`. Clients sollen das Feld bei neuen Aufrufen weglassen.

Die bisherigen Schutzprüfungen bleiben bestehen: Pages prüft aktuelle Rechte und Sichtbarkeit bei jedem Aufruf, auch beim Replay einer `operationId`; Schreibaufrufe vergleichen die erforderlichen `expected`-Felder oder die `expectedRevision`. Vorschauen und Bestätigungsfragen, etwa für ein Projekt, eine Wiki-Seite, einen Plan, eine Automation oder einen Agent, beschreiben weiterhin die konkrete Wirkung. Eine Vorschau autorisiert weder ein anderes Objekt noch eine andere Revision. `delete_chat_sessions` löscht nur die ausdrücklich ausgewählten eigenen IDs und vergleicht `expectedCount` mit deren Anzahl. Bei Projektlöschungen bleiben Umfangsvorschau, atomare Ausführung, laufende Plan-Sperren und Audit erhalten. Die `previewId` einer Agent-Löschung bleibt erforderlich.

Beispiel für einen neuen Aufruf ohne Wort:

```json
{
  "operationId": "eindeutige-operation-id",
  "ticketId": "PAGE-123"
}
```

Bei einer Schnittstelle mit `confirmed`-Schritt liest der Client zuerst die Vorschau und sendet danach für **dasselbe Ziel und dieselbe gelesene Revision** `confirmed: true`. Das Feld ist eine Bestätigung des konkreten Umfangs, kein Bestätigungswort. Eine veraltete Revision ergibt `CONFLICT`; fehlende Berechtigung ergibt `FORBIDDEN` beziehungsweise ein für die Person unsichtbares Ziel `NOT_FOUND`.
