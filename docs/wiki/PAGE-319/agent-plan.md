Graph, Nodes, Vorlagen, gemeinsame Pläne und Parität der Schnittstelle.

[Zur Übersicht](index.md)

# Umgesetzt

Umgesetzt sind Textfilter (Name, Tag, Modell beziehungsweise Ticketkennung, Titel, Status), Task- und Subtask-Auswahl, Nutzbarkeitsfilter, Einfügen ohne Ziehen, numerische Positionen, beschriftete Ports und Auswahlfelder.


# Entschieden

Die folgenden Festlegungen bleiben in ihrem ursprünglichen Wortlaut erhalten. Ein Umsetzungsstand gilt nur dort als nachgewiesen, wo er ausdrücklich genannt ist; die übrigen Einordnungen sind noch zu bestätigen.

## Ausführplan

- Die **Planauswahl** zeigt bestehende Pläne und die Aktion „Neuer Plan“. Die Neuanlage fragt Name und Arbeitsplatz ab; zugehöriges Projekt und gegebenenfalls GitHub werden automatisch angezeigt. Der Arbeitsplatz-Wechsel erfordert einen leeren Graphen.
- Der **Editor** hat zwei getrennte, filterbare Quellsets: für Nutzer und Projekt verfügbare **Agents** sowie **Projekt-Tasks inklusive Subtasks**. Filter verändern die Auswahl, nicht die Berechtigungen. Nicht nutzbare Quellen zeigen ihren Grund.
- Die **zentrale Rasterfläche** erlaubt Ziehen und Ablegen für Agent-Knoten und Verbindungen für sequenzielle und parallele Abläufe. Parametrisierte Agents zeigen zusätzliche **benannte Andockpunkte** für Task- und Parameterquellen; Parameter-Ports werden zusätzlich zu Ablauf-Ports angezeigt und beschriftet.
- **Planweite Parameter** (z. B. Branch-Name) sind konfigurierbar und im Graphen einbindbar. Variablen-, Task- und Agent-Knoten haben unterscheidbare Farben und Typbezeichnungen. Der persönliche Modellzugang wird bei Mehrdeutigkeit ausdrücklich ausgewählt.
- **Starten** (bisherige sichtbare Bezeichnung Play) führt den gespeicherten Graphen einschließlich Parallelzweigen und Abhängigkeiten aus. Ungespeicherte Änderungen sperren Starten und lösen Verwerf- und Navigationsschutz aus. Speichern oder Klonen startet nichts.
- Die **Laufansicht** zeigt die letzten 20 eigenen Läufe, Fortschritt, die Zustände wartet, läuft, erfolgreich, fehlgeschlagen und abgebrochen, bereinigte Endergebnisse und feste Fehlergründe. **Stop** gilt dem gewählten eigenen Lauf.
- Native Zieh-Ereignisse und **Einfüge-Schaltflächen**, numerische Rasterpositionen, getrennte Ablauf- und Datenports sowie Parameter-Auswahlfelder bedienen denselben Graphen. Der Rasterbereich scrollt innerhalb seines Containers; Formulare und Quellen ordnen sich auf Tablet und Phone um.


Gezieltes Fortsetzen nach Pause/Absturz ist seit 22.10.2026 bestätigter Zielumfang wie unten beschrieben. 

### Geplante Script-Node: eigene Typfarbe und bestehende Kartenstruktur

**Entschieden am 19.10.2026 (Igor), noch nicht implementiert:** Script benötigt eine eigenständige, von der bestehenden blauen/blaugrünen Agent-Node unterscheidbare Typfarbe. Die korrigierte visuelle Richtung wurde von Igor am 19.10.2026 bestätigt: zurückhaltend rosa getönte Script-Karte mit rosa Kontur und Code-Symbol sowie dasselbe rosa Symbol am Eintrag „Script“ in der rechten Palette, auf Grundlage der tatsächlichen bestehenden Kartenstruktur. Der zuerst frei nachgebaute orangefarbene Entwurf ist verworfen. Der konkrete produktive Farbwert und seine helle/dunkle Tokenbelegung sind damit noch nicht abschließend festgelegt.

Die Vorschau übernimmt die tatsächlich ausgelieferte Agent-Kartenstruktur statt einer frei gezeichneten Ersatzkarte: gleiche Kartenbreite, Headerhöhe, Typografie, Abstände, Eingabezeilen, Anschlusspositionen und Menü-/Bearbeiten-Icons. Script ersetzt Modell/Reasoning durch ein Interpreterprofil; dies bleibt ein Layoutvorschlag, kein Nachweis einer integrierten Script-Node. Typfarbe und Laufstatus sind getrennte Bedeutungen; bestehende Ablauf-/Datenportfarben werden nicht durch Rosa ersetzt. Interpreterverwaltung und noch abzustimmende Script-Planintegration bleiben getrennte Umfänge.

### Geplant: rechte Tabs und einheitliche Node-Typografie — 19.10.2026

**Beauftragt zur Gestaltung, noch nicht implementiert:** Das rechte schwebende Quellenpanel bekommt die benachbarten Tabs „Nodes“ und „Vorlagen“. Die Nodeauswahl liegt im ersten Tab; Vorlagen sind ein gesonderter Inhalt desselben einklappbaren Panels, kein zweites dauerhaftes Seitenpanel. Bestehende Node-Typfarben und zulässige unterschiedliche Kartengrößen bleiben erhalten. Eine neue Tabansicht ändert nicht die Graphdaten oder die Ausführung.

Alle Nodefamilien einschließlich Start/Ende, Agent, Parameter, Tickets, Gruppen und der geplanten Script-Node verwenden dieselben semantischen Schriftrollen: gleicher Titelstil, gleicher Stil für Typzeilen, Feldnamen/-werte und ergänzende Metadaten. Eine größere Karte rechtfertigt keine zusätzliche Titelgröße oder abweichende Fettschrift. Vorschlag der aktuellen Vorschau: Titel 14 CSS-Pixel / 600, Felder und Werte 12 CSS-Pixel, Typzeilen und Zusatzinformationen 11 CSS-Pixel. Diese konkreten Maße sowie die leicht breitere Panelgeometrie sind noch abzustimmen; sie sind kein bereits umgesetzter globaler Designstandard. Unterschiedliche Karten dürfen weiterhin unterschiedliche Inhalte, Höhen und Breiten haben. Gemeinsame Regeln zentral pflegen und nicht pro Nodefamilie divergent kopieren; Touch-/Tastaturzugang und kleine Bildschirme bleiben zu berücksichtigen.

**Präzisiert von Igor am 19.10.2026, 15:35:** Parameter-, Agent-, Script- und Group-Nodes bekommen im Drei-Punkte-Menü zusätzlich zu „Löschen“ die Aktion „Als Vorlage speichern…“ (EN: „Save as template…“). Ziel ist, die gleiche Konfiguration wiederholt aus dem Tab „Vorlagen“ übernehmen zu können. Für diese vier Typen ersetzt dies die frühere Vorgabe „nur Löschen“; Start, Ende und Tickets erhalten durch diesen Auftrag keine Vorlagen-Speicheraktion. Der neue Umfang ist noch nicht implementiert und erweitert nicht das separate Interpreterverwaltungsticket. Vollständige Planvorlagen sind damit nicht beauftragt.

**Aktuelle Ablaufvorschau:** Menüaktion → kleiner Dialog „Als Vorlage speichern“ mit Name und „Abbrechen“ / „Speichern“ → typfarbiger Eintrag unter „Vorlagen“. Die aktuelle Konfiguration wird als benannte wiederverwendbare Konfiguration übernommen. Die gezeigten Vorlagen und ihr Speichern sind simulierte Layoutzustände, keine echten gespeicherten Einträge. Die gezeigte Variante mit Namensfeld, Abbrechen/Speichern und anschließendem Vorlagen-Tab wurde am 19.10.2026 mit dem Ticketauftrag bestätigt; sie ist noch nicht implementiert.

**Bestätigte Kopiersemantik (Ticketauftrag 19.10.2026):** Einfügen erzeugt eine eigenständige Node mit neuen IDs und der gespeicherten Konfiguration; spätere Änderungen an einer eingefügten Node ändern nicht still die Vorlage. Groups übernehmen auch die enthaltenen Nodes und internen Verbindungen, mit neuen IDs und ohne Verknüpfung zurück auf den Ursprungsgraphen. Die Behandlung externer Bindungen/Referenzen ist weiterhin abzustimmen. Laufstatus, Sessions und Zugangsdaten gehören nicht zu einer konfigurierbaren Vorlage. Erforderliche Quellen/Profile und Rechte beim Einfügen erneut prüfen, ohne unbemerkt ein anderes Modell oder Interpreterprofil zu wählen. Die gemeinsame Geltung ist am 19.10.2026, 16:13 entschieden: Projektzugriff UND tatsächliche Mitgliedschaft in der zum Objekt gehörenden Abteilung eröffnen den gemeinsamen Plan-/Vorlagenbestand nach erforderlichen Nutzungs-/Schreibrechten. Details zu Altbestandszuordnung, Mehrfachmitgliedschaften und weitergehender Vorlagenverwaltung bleiben offen.

### Gemeinsame Pläne und Vorlagen nach Projekt UND Abteilung — entschieden 19.10.2026

**Produktziel, noch nicht implementiert:** Personen mit Zugriff auf dasselbe Projekt und tatsächlicher Mitgliedschaft in der dem Plan bzw. der Vorlage zugeordneten Abteilung sollen dieselben Pläne und Vorlagen verwenden können. Beide Bedingungen sind erforderlich. Bloße Verwaltung einer Abteilung, Projektzugriff allein oder eine Mitgliedschaft ohne Projektzugriff genügen nicht. Die Zuordnung gehört stabil zum gemeinsamen Objekt, nicht zum gerade speichernden Konto.

Berechtigte Teammitglieder sollen denselben Plan im Rahmen der bestehenden Schreib-/Nutzungsrechte öffnen, bearbeiten, speichern und ausführen können. Normales Speichern erhält Plan-ID, Projekt-/Abteilungskontext, gemeinsame Geltung und Ersteller-/Eigentümerbezug; es erzeugt keine persönliche Kopie, keine implizite Eigentumsübertragung und keine Zurücksetzung auf privat. Andere Berechtigte sehen nach regulärem Neuladen die neue Revision. Konkurrierende Bearbeitung bleibt revisionsgesichert; Echtzeit-Coediting ist nicht beauftragt. Gemeinsam verfügbare Vorlagen erzeugen beim Einfügen weiterhin unabhängige Node-/Group-Kopien.

**Plannamen:** Doppelte Agent-Plan-Namen werden bei Anlegen/Umbenennen serverseitig und atomar auch bei Konkurrenz verhindert. Speichern desselben Plans unter seinem unveränderten Namen bleibt erlaubt. Namen dürfen nicht durch bloße Groß-/Kleinschreibung oder Rand-Leerzeichen doppelt werden. Mindestumfang/Arbeitsannahme ist der gemeinsame Projekt-/Abteilungsbereich, unabhängig von Ersteller und Workspace; projektweite Eindeutigkeit über Abteilungen hinweg ist noch zu klären. Eine instanzweite Regel oder neue Eindeutigkeit für Vorlagen-Namen ist damit nicht beschlossen.

Privatsphäre, persönliche Credentials, Quellen-/Modellrechte und bestehende Laufsteuerrechte werden nicht mitfreigegeben. Entzogene Projekt-/Abteilungsrechte müssen auch offene Editoren und direkte API-Aufrufe sperren. Offene Ausarbeitung: Abteilungszuordnung bei mehreren/keinen Mitgliedschaften, Zuordnung privater Altobjekte, Umgang mit alten Namenskollisionen und der genaue Namensraum. Keine automatische Veröffentlichung privater Altbestände, Zusammenführung, Löschung oder willkürliche Umbenennung.

### MCP-Parität des Planeditors — Vorgabe 19.10.2026

Die fachlichen Bedienmöglichkeiten des visuellen Planeditors sollen auch über MCP verfügbar sein: Pläne finden/lesen, erzeugen, ändern und ihre Nodes einschließlich Positionen, Gruppen/Mitgliedern, Tickets, Parametern, Verbindungen und Konfiguration verwalten. Geplante Script-/Vorlagenfunktionen müssen entsprechend ergänzt werden. Gleiche Rechte, gemeinsame Projekt-/Abteilungsregeln und Validierung wie im Editor; keine MCP-Sonderrechte und keine implizite Ausführung beim Bearbeiten. Die konkrete Lückenmatrix und der nur lesend geprüfte Ist-Stand stehen unter [Pages-Schnittstelle und MCP: technische Umsetzung](/wiki/6d5a37ed-6ab1-4c4e-8962-96b7f1224b5b). Vollständige Parität ist ausdrücklich noch nicht nachgewiesen.

# Offen

Aus den Zielverträgen bleiben außerdem offen: der produktive Script-Farbwert und die Belegung der Theme-Tokens; die konkreten Schriftmaße und die Panelgeometrie; externe Bindungen von Vorlagen; Altbestandszuordnung, Mehrfachmitgliedschaften und Vorlagenverwaltung; der Namensraum über Abteilungen hinweg und alte Namenskollisionen. Die vollständigen datierten Aussagen stehen unter „Entschieden“.

- **Offen:** erweiterte Dropdown-Filter für Zuweisung, Ticketstatus und Zuständigkeit, Zoom und Verschieben sowie allgemeines Wiederholen. 

- **Offen:** konkrete Knotenfarben, Portformen und Kantenstile des Planeditors (Vorschlag: zurückhaltende typabhängige Tönungen, beschriftete Parameter-Ports, unterscheidbare Ablauf- und Datenverbindungen; bestehende helle Flächen, Radien und Typografie beibehalten).


