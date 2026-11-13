API und CLI sowie der Nutzungsumfang der Anbindungen.

[Zur Übersicht](index.md)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden

Die folgenden Festlegungen bleiben in ihrem ursprünglichen Wortlaut erhalten. Ein Umsetzungsstand gilt nur dort als nachgewiesen, wo er ausdrücklich genannt ist; die übrigen Einordnungen sind noch zu bestätigen.

## Anbindungen (API und CLI) in den Einstellungen

**Bereich und Zugang**

- Der Bereich „Agents“ erscheint mit Bot-Symbol neben „Persönlich“ und „System“ **nur für persönliche Admins im aktiven Admin-Modus**. Im Rollenmodus führt die direkte Adresse nur zu „Admin-Modus erforderlich“ mit Wechselknopf; ohne Admin-Berechtigung erscheint „Zugriff verweigert“. Der Rollenmodus nennt den Agents-Bereich.
- Der Bereich besteht aus einem Abschnittskopf und zwei Karten (API und CLI), die die vorhandenen Bausteine verwenden; Kartenköpfe umbrechen.

**Tabellen**

- Tabellen in einer waagerecht scrollenden Fläche zeigen Name, Anbieter beziehungsweise Werkzeug, Status mit Symbol und Text, letzten Prüfzeitpunkt und „Bearbeiten“ oder „Einrichten“ plus Zeilenmenü.
- **Schlüssel-Fragmente und Zugangsdaten-Pfade fehlen** bewusst. **CLI-Fundorte** sind getrennte, lesende Betriebsinformationen mit Installations- und PATH-Hinweis.
- Leere Tabellen zeigen Inline-Leerzustände; die Navigation nutzt den verzögerten 200-ms-Platzhalter.
- „Zuletzt geprüft“ zeigt „—“, relativ bis sieben Tage, danach das Datum. Katalogzeiten stehen im Regionsformat.

**Seitenpanel einer Anbindung**

- Das Panel enthält Name, den **nach der Anlage unveränderlichen Anbieter**, Zugangsart, nur eingebbaren API-Schlüssel beziehungsweise CLI-Anmeldung und „Modell und Reasoning“.
- Das **Ersetzen eines Schlüssels beginnt leer**; das Auge zeigt nur die aktuelle Eingabe. Nach der Anlage bleibt das Panel zur Einrichtung offen. Ein ersetzter Schlüssel klappt nach dem Speichern wieder zu.
- Fuß: „Entfernen“ (destruktiv, weich), „Abbrechen“ (leise), „Speichern“ (Hauptaktion). Ungeänderte Werte und Ergebnisse bleiben erhalten; Schlüssel- und Code-Eingaben werden nach Erfolg oder Schließen verworfen.
- Feldfehler erscheinen am Feld, blockierende Fehler als Inline-Hinweis; Speichern und Entfernen melden Erfolg per Toast. Formular-, Aktions-, Polling- und beendete Login-Fehler erscheinen als Fehlerblock.
- Auswahllisten bleiben auf dem Phone im sichtbaren Bereich und brechen lange Kennungen um.

**CLI-Anmeldung**

- Die Anmeldung zeigt: fehlendes Programm, Anmeldebedarf, laufenden Ablauf, Erfolg oder abgelaufenen, abgebrochenen oder fehlgeschlagenen Zustand.
- Nur aktive Sitzungen werden **alle zwei Sekunden** abgefragt; das Verlassen der Ansicht bricht die Abfrage ab.
- **Codex** zeigt Link, kopierbaren Gerätecode und Ablauf; **Claude** Link, Eingabecode und Abschließen. Beide haben eine Statuszeile und „Abbrechen“. Der Terminal-Ausweichweg ist aufklappbar und enthält ausschließlich den isolierten Befehl. **Abmelden benötigt eine Bestätigung.**

**Prüfungen**

- **Zugang** und **Modelltest** sind getrennte, ausdrückliche Aktionen mit Prüfumfang, Zeitpunkt, Dauer und Details. Ergebnisse heißen bei APIs „Zugangsprüfung“ und „Modelltest“, bei CLIs „Anmeldestatus“ und „CLI-Test“.
- Der Status unterscheidet: nicht geprüft, Zugang bestätigt oder angemeldet, Modelltest bestanden, jüngster Fehlschlag, Anmeldebedarf, aktive Anmeldung und fehlendes Programm. Ein **gespeicherter Schlüssel ist kein Erfolg**.
- Ungespeicherte Änderungen sperren Prüf- und Login-Aktionen mit dem Hinweis „Zuerst speichern“.
- Ein Modelltest benötigt einen **Dialog** mit fester Eingabe, Modell, Stufe, Kosten- und Kontingenthinweis und der Zusicherung, dass **keine Pages-Inhalte übertragen** werden; das Ergebnis nennt die verwendete Stufe.
- **Entfernen** bestätigt den Namen und die getrennte Wirkung bei API und CLI. Der CLI-Text erklärt, dass persönliche Server-Anmeldungen unberührt bleiben. Fokus-Falle, Fokus-Rückgabe und Verwerfen-Rückfrage gelten auch hier.

## Nachtrag Stand 2026-10-13: Nutzungsumfang, Arbeitsverzeichnis und Nutzer-Agents

**Nutzungsumfang je Anbindung (PAGE-19)**

- Im Anbindungs-Panel gibt es den Abschnitt **„Nutzung der Modelle“** mit den Werten **Global** und **Eingeschränkt**. Bei Eingeschränkt wählt der Administrator mehrere Personen, Gruppen und Abteilungen; mindestens ein Ziel ist Pflicht.
- Die Listenspalte **„Nutzung“** zeigt den Umfang. Der Standard für neue und bestehende Anbindungen ist **Global**.
- Mehrere Ziele bilden eine **Vereinigungsmenge (ODER)**: Berechtigt ist, wer direkt ausgewählt ist oder aktuell Mitglied einer ausgewählten Gruppe oder Abteilung ist. Nur Mitgliedschaften zählen; nur aktive Konten sind berechtigt.
- Der Umfang ist eine **Obergrenze auf die Profilzuweisungen**. Er ersetzt die Zuweisungen nicht und gewährt keinen Admin-Bypass. Die Prüfung erfolgt beim Anbieten und vor jedem Providerlauf; ist die Prüfung nicht möglich, wird fail-closed verweigert und nicht auf einen anderen Zugang zurückgefallen.
- Mitgliedschaftsänderungen wirken sofort beim nächsten Zugriff. Die Lösch- und Entfernungssperre von Gruppen und Abteilungen berücksichtigt die Umfänge.
- Bei der Chat-Nutzung (Pica) meldet das System bei fehlender Berechtigung ausdrücklich, dass der Anbindungsumfang den Zugriff nicht erlaubt.


# Offen

- **Offen zur Bestätigung:** die Lesart „Global“ als Obergrenze statt Ersatz der Profilzuweisungen sowie der fehlende Admin-Bypass.


