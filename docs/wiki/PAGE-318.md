# Lange Wiki-Seiten über die Pages-Schnittstelle pflegen

Die Pages-internen Werkzeuge `wiki_page_create` und `wiki_page_set_content` nehmen Markdown-Inhalte mit höchstens **50.000 Zeichen** an. Das gilt für neue Seiten und für den vollständigen Ersatz des Inhalts einer bestehenden Seite. Der Seitentitel, die Platzierung und alle anderen Eingaben behalten ihre bisherigen Regeln.

Zum Ändern einer Seite zuerst die aktuelle Revision lesen und sie als `expectedRevision` an `wiki_page_set_content` übergeben. Ein erfolgreicher Aufruf speichert den vollständigen neuen Markdown-Text. Die Pages-Oberfläche lässt Inhalte dieser Länge ebenfalls zu.

Ein Inhalt mit mehr als 50.000 Zeichen wird ohne Änderung der Seite mit `INVALID_REQUEST` abgewiesen. Die Fehlerdetails nennen die Grenze:

```json
{
  "reason": "content_too_long",
  "maxLength": 50000
}
```

Den Inhalt in diesem Fall auf höchstens 50.000 Zeichen kürzen und den Aufruf mit der aktuellen Revision erneut ausführen.
