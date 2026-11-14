Modellauswahl, Reasoning und Katalogpflege.

[Zur Übersicht](/wiki/93eb063a-a63c-4cac-8393-af182291a582)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden (noch nicht umgesetzt)

Im Ausgangstext keine weitere Festlegung ausdrücklich als noch nicht umgesetzt ausgewiesen.

# Festlegungen ohne eindeutigen Umsetzungsstand

Die Quelle nennt diese Festlegungen als entschieden oder umgesetzt, ohne ihren Umsetzungsstand eindeutig zuzuordnen. Historische Zielverträge sind keine Auslieferungsnachweise; spätere datierte Präzisierungen bleiben maßgeblich.

## Modell und Reasoning

- Jede Anbindung hat ein **„Modell“** als reguläre Konfiguration (statt eines Testmodells); Zugangs-, Modell- und CLI-Prüfungen verwenden es.
- **Vor dem Speichern** steht nur ein Hinweis; vor bestätigtem Zugang (API: bestandene Zugangsprüfung, CLI: Anmeldung) der Hinweis, dass die Liste danach automatisch lädt.
- **Jede bestandene Zugangsprüfung und jede erfolgreiche CLI-Anmeldung lädt die Modellliste** im selben Vorgang (nur Metadaten, keine Modellanfrage), auch aus dem Zeilenmenü oder bei geschlossenem Panel. Für eine Anbindung ohne Modell speichert der Server einen **gelisteten Standard**; eine vorhandene Auswahl bleibt. Das geöffnete Panel lädt nur eine Liste nach, die älter als ein früher bestätigter Zugang ist; ein Fehlversuch wiederholt sich nicht. Das offene Formular übernimmt den Standard, sofern das Modell dort nicht schon geändert wurde.
- Die Auswahl **„Modell“** bietet Suche (Kennung oder Name), ein „Free“-Label (deutsch „Free (kostenlos)“, englisch „Free“, nur wenn beide Preise in den Metadaten null sind) und „Andere Modell-ID manuell eingeben“; bei CLIs zusätzlich „CLI-Standardmodell“. Ohne Anbieterstandard (OpenAI) erscheint ein Hinweis zur Auswahl. Suche und Auswahl erscheinen erst mit abgerufenen Modellen, sonst nur die manuelle Kennung.
- Die Auswahl **„Reasoning-Stufe“** bietet nur die für das gewählte Modell gelisteten Stufen plus „Standard (x)“ beziehungsweise „Standard des Anbieters“; sonst erklärt ein Hinweis, ob das Modell selbst steuert, kein Reasoning hat, die Liste nichts angibt, eine manuelle Kennung oder der CLI-Standard gilt. Ein Modellwechsel setzt eine dort nicht gelistete Stufe zurück; eine gespeicherte, nicht mehr gelistete Stufe bleibt als „(gespeichert, nicht mehr gelistet)“ sichtbar, bis sie zurückgesetzt wird.
- Ohne nutzbare Liste (Z.AI, Fehler, noch nicht geladen) bleibt die „Modell-ID“ als **manueller Ausweg**. Z.AI und CLIs behalten die manuelle Eingabe.
- Die **Katalog-Verwaltung** (Admin) zeigt das Intervall (nur manuell, 6 Stunden, täglich, wöchentlich), manuelles Aktualisieren, letzten Versuch, letzte erfolgreiche Aktualisierung, nächste geplante Aktualisierung und einen übersetzten Fehler- oder Veraltet-Hinweis. Bei einem Fehler bleibt der letzte gute Katalog auswählbar. Intervalländerungen gelten sofort und setzen die nächste Frist neu; ungespeicherte Formulare und laufende Operationen sperren Katalogaktionen. **Erst speichern, dann Katalog laden**; es gibt keine automatischen Anbieteraufrufe beim Seitenaufruf. Nicht-Admins und Admins im Rollenmodus erhalten keine Katalog- und Intervalldaten.
- Der Testmodell-Hinweis unterscheidet Katalog-Schnittstelle, Schnittstelle ohne Katalog (Z.AI) und CLI-Standard. Die Modellliste enthält nur Text-Modelle; Anbindungs- und Modellauswahl zeigen „Name (Anbieter)“, z. B. „TSK_100 (Z.AI API)“; das Suchfeld sitzt im geöffneten Auswahlpanel.

# Offen

Keine weitere offene Sachfrage im Ausgangstext ausdrücklich ausgewiesen.
