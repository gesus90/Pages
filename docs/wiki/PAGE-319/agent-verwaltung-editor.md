Funktionsrollen, zentrale Agent-Verwaltung, Agent-Editor und Nutzer-Agents.

[Zur Übersicht](index.md)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden

Die folgenden Festlegungen bleiben in ihrem ursprünglichen Wortlaut erhalten. Ein Umsetzungsstand gilt nur dort als nachgewiesen, wo er ausdrücklich genannt ist; die übrigen Einordnungen sind noch zu bestätigen.

## Funktionsrollen und Zuweisung

- Die frühere Funktionsrolle **„Text“** ist seit 2026-10-18 entfernt (Entscheidung des Auftraggebers: kein Textassistent mehr). Zuweisungen für Chat und Agent-Ausführung laufen über das zentrale Panel „Agents“; wählbar sind nur Modelle und Reasoning-Stufen, die die Anbindung tatsächlich liefert, nicht unterstützte Stufen erscheinen nicht als Option. Fehlende oder ungültige Zuordnungen erklärt ein verständlicher Hinweis. Die Rollenverwaltung ist durch die Admin- und Rechte-Architektur geschützt. Weitere Funktionsrollen sind nicht beauftragt.
- **Persönliche Pages-Tokens für Agents:** Jeder Benutzer erzeugt einen benannten Token mit wählbarer Gültigkeit; er ist an diesen Benutzer gebunden und **widerrufbar sowie rotierbar**. Die MCP-Token-Rechte folgen der persönlichen Admin-Eigenschaft **unabhängig vom aktiven Rollenmodus** (entschiedene Ausnahme); die allgemeinen Rollenmodus-Regeln gelten außerhalb des MCP-Token-Pfads unverändert.
- Der frühere Bereich **„Agent-Aufgaben“** (Tabelle mit Funktionsaufgabe, Anbindung, Modell, Reasoning-Stufe) ist durch das zentrale Panel „Agents“ ersetzt. Für Zuordnungen galt: Auswahl in der Reihenfolge Funktionsaufgabe, benannte Anbindung, gelistetes Modell, gelistete Stufe; Modelle und Stufen stammen ausschließlich aus dem gespeicherten Katalog der Anbindung, keine freie Eingabe; ist ein Katalog leer oder nicht geladen, erklärt ein Hinweis, dass die Anbindung zuerst verifiziert werden muss; ungültige oder nicht mehr gelistete Zuordnungen bleiben sichtbar und sind als unbrauchbar markiert, mit Grund; es gibt keinen stillen Ersatz.
- Die echten Konto-Abläufe von Codex und Claude Code (Anmeldung bis „Angemeldet“, CLI-Test, Abmelden) wurden vom Auftraggeber bestätigt.

## Zentrale Agent-Verwaltung

- Der Admin-Bereich „Agents“ ist das **einzige Einstellungspanel**. Darin die **Liste aller Agents** mit Name, Geltung, Zugang, Modell, Verwendungszweck, Status und Nutzbarkeit.
- Die **Detailansicht** zeigt Name, Zugang, Modell, Reasoning-Stufe, Verwendungszweck (Chat, Dreaming oder Agent-Ausführung), Geltung, Status und eine optionale Markdown-Grundkonfiguration mit Parametern. **Nicht nutzbare Agents** sind ausgegraut und nennen den Grund in Klartext, z. B. „Kein persönlicher Modellzugang zugewiesen“.
- Der Abschnitt **„Zugewiesen an“** listet Funktionen, Projekt-Aufgaben, Tickets und Personen; **Zuweisungen werden nur an dieser Stelle gepflegt**. Mehrfachzuweisung ist möglich; jede Zuweisung hat genau eine Geltung.
- **Geltung** als Auswahl (System, Gruppe, Abteilung, Person). Bei „System“ werden Gruppe, Abteilung und Person ausgegraut und deaktiviert, mit kurzem Hinweis. Systemfunktionen (Chat, Dreaming) bieten nur „System“ an.
- **Suche und Filter** per Auswahl (Geltung, Anbieter, Zugang, Verwendungszweck, Status, Nutzbarkeit). Filter ändern nur die Anzeige; nicht nutzbare Agents werden markiert, nicht ausgeblendet.
- **Löschen** über ein Zeilenmenü: Ist der Agent zugewiesen, zeigt der Dialog die Verwendungsliste, und die Aktion ist deaktiviert. Ist er nicht verwendet, folgt ein Bestätigungsdialog. Der Server prüft erneut.
- Das Panel ist für persönliche Administratoren im aktiven Admin-Modus sichtbar und bedienbar; **Teamleiter** sehen und verwalten darin nur ihre berechtigten Gruppen und Abteilungen.
- Mehrere **benannte CLI- und API-Anbindungen je Anbieter** sowie Benutzer-, Gruppen-, Abteilungs- und globale Zuweisungen sind möglich; bestehende Chat-Einstellungen werden berücksichtigt.

## Agent-Editor

- Der Editor enthält **Name, Tag, Markdown-Grundkonfiguration (großer Wiki-Editor), freigegebene Modellwahl mit Reasoning, Geltung, Projekt oder global, Zuweisung und eine getrennte Nutzungsfreigabe**.
- **Parameter-Platzhalter** sind in der Beschreibung verwendbar und erscheinen als Parameterfelder in der Konfiguration; Arbeitsplatz- und Wiki-Referenzen werden im Plan gebunden. Parameterfelder haben Name, Typ, Beschreibung, Pflichtregel und optional einen Text-Standard; **erkannte Platzhalter müssen ausdrücklich bestätigt werden**.
- **Unvollständige Konfiguration** wird als inaktiver Entwurf gespeichert. Personen-, Gruppen- und Abteilungsziele sind bei Systemgeltung deaktiviert; eine globale Vorlagenfreigabe setzt keine Systemfunktion.
- **Nicht nutzbare, persönlich geteilte Agents** erscheinen ausgegraut oder transparent. Bei der Nutzung kommt der **eigene Zugang** zum Einsatz, nie der persönliche Zugang des Erstellers. Der Blockgrund bleibt neben dem ausgegrauten Namen lesbar.
- Das Zeilenmenü bietet Bearbeiten und Löschen; der Löschdialog liest aktuelle Verwendungen und sperrt verwendete Agents. **SKILLS** bleibt als schreibgeschützter Altbestand sichtbar.
- Der Editor und die Liste liegen im zentralen Panel; die Navigation führt unter „Agents“ zu „Ausführplan“, „Arbeitsplatz“ und „Agents Liste“. Die Verwaltung im zentralen Panel bleibt an den aktiven persönlichen Admin-Modus gebunden.

**Nutzer-Agents (PAGE-20)**

- Unter **Agents → Agents** erstellen und verwalten Nutzer eigene Agents: Name, Instruktion, typisierte Parameter, Modell und Reasoning aus den für sie freigegebenen Admin-Modellen. Die Liste zeigt die für sie sichtbaren Agents; Administratoren finden hier einen Link zur Verwaltung.
- **Freigabe je Agent:** **Privat** (nur der Ersteller), **Global** (alle aktiven Nutzer) oder **Eingeschränkt** (Gruppen und/oder Abteilungen, mit **UND** oder **ODER**). Ein neuer Agent ist zunächst privat.
- Ein Agent speichert **keine Zugangsdaten**. Ausgeführt wird er nur mit einem Modell, das für die **ausführende** Person freigegeben ist; die Anbindungsfreigabe wird bei jedem Start erneut geprüft. Eine Agent-Freigabe erweitert keine Modellberechtigung.
- Je Agent entsteht die Datei **AGENT.md** unter dem Agent-Ordner. Sie ist während Läufen unveränderlich; Läufe dürfen sie weder ändern noch löschen. Änderungen laufen nur über die Verwaltung.
- Nach jedem beendeten Lauf entsteht genau eine Laufdatei **runs/<run-id>.md** mit Agent, Lauf, Zeitstempeln, Status, Modell, aufbereiteter Eingabe und Ergebnis. Erfolg, Fehler, Abbruch und Zeitüberschreitung werden gleich behandelt; wiederholte Abschlussverarbeitung erzeugt keine Duplikate. Diese Dateien sind die Eingabe für späteres DREAMING; die Auswertung selbst gehört nicht zu diesem Umfang.
- Laufdateien und Zugriffe folgen den Berechtigungen des Agenten und des Laufs; Zugangsdaten stehen weder in der AGENT.md noch in Laufdateien.
- Das Löschen eines Admin-Profils berührt bestehende Nutzer-Agents nicht; Nutzer-Agents sperren ihre Löschung nicht.

Weiterführend: [Benutzer, Rollen und Autorisierung (Technik): Zielmodell](/wiki/bcf6d1ea-462e-4b02-8b8a-afdcab75af77) für Rollen und Rechte.


# Offen

Keine weitere offene Sachfrage im Ausgangstext ausdrücklich ausgewiesen. Die Einordnung des Umsetzungsstands folgt den Hinweisen unter „Entschieden“.


