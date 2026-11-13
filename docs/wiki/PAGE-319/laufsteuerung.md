Starten, Pause, Stop und Fortsetzen sowie die Darstellung im Planpanel.

[Zur Übersicht](/wiki/93eb063a-a63c-4cac-8393-af182291a582)

# Umgesetzt

## Laufsteuerung: Fortsetzen in jedem Zustand (umgesetzt, 11.11.2026)

Der mittlere Button entscheidet selbst, welcher technische Weg nötig ist; Bedienende müssen Resume, Recovery und Continue nicht unterscheiden. **Fortsetzen** ersetzt Pause, solange ein Lauf fortsetzbar ist, und genügt ein Klick:

| Zustand | Mittlerer Button | Wirkung |
|---|---|---|
| läuft | Pause | keine neuen Schritte, laufende laufen kontrolliert aus |
| pausiert | Fortsetzen | am Pausenpunkt weiter |
| fehlgeschlagen | Fortsetzen | fehlgeschlagenen Schritt neu versuchen, fertige Schritte übernehmen |
| unterbrochen (Absturz, Neustart des Dienstes) | Fortsetzen | nach Abgleich und Freigabe der eigenen Ressourcen am letzten sicheren Stand weiter |
| Schritt blockiert (Ergebnis `blocked`) | Fortsetzen | blockierten Schritt neu versuchen, nachdem die Ursache behoben ist, zum Beispiel ein geändertes Ticket; Nachfolger werden wieder freigegeben |
| nur Abschluss-Schritt offen | Fortsetzen | nur diesen Schritt wiederholen |
| gestoppt oder abgebrochen | Fortsetzen | wie fehlgeschlagen, wenn ein sicherer Stand gespeichert ist |

- Fortsetzen nutzt den gespeicherten Plan in seiner aktuellen Revision; Änderungen an Plan oder Ticket dazwischen wirken beim Fortsetzen. Erfolgreich abgeschlossene Schritte laufen nie erneut.
- **Starten** beginnt immer einen neuen Lauf von vorn. Gibt es einen offenen Lauf, fragt ein Dialog, ob er beendet und neu begonnen werden soll.
- **Stop** funktioniert in jedem nicht abgeschlossenen Zustand, auch bei hängenden oder unbekannten Prozessen: eigene Prozesse enden, Ressourcen werden freigegeben, der Status wird `cancelled`. Ein zweiter Klick auf Stop beendet einen hängenden Stop erzwungen. Bleibt ein Prozess unbestätigt, sagt Pages das, statt Erfolg vorzutäuschen.
- **Nach Absturz oder Neustart** des Dienstes gleicht Pages offene Läufe mit den tatsächlichen Prozessen ab und markiert verlorene Läufe als unterbrochen. Ihre eigenen Sitzungen und Reservierungen werden nach bestätigtem Prozessende automatisch freigegeben; danach ist der Lauf ohne weiteren Schritt fortsetzbar.
- **Gesperrtes Fortsetzen** ist deaktiviert und zeigt sichtbar den konkreten Grund und die nächste Handlung, zum Beispiel „Admin-Modus nötig: Der Plan enthält Skript-Schritte“ (mit Schaltfläche zum Wechsel), „Arbeitsplatz von Lauf X belegt“, „Das Ende der Prozesse des Laufs ist nicht bestätigt“ (mit Schaltfläche „Freigeben“) oder „Kein sicherer Stand gespeichert“ (mit „Neu starten“). Keine Sperre ohne Grund; eine lösbare Sperre bietet ihre Handlung direkt an. Die vollständige Liste der Gründe steht im [technischen Planvertrag](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440).
- Feste Breite und Höhe der Laufbuttons bleiben erhalten; die Beschriftung **Fortsetzen** bestimmt die Breite.
- Über die Pages-Schnittstelle gilt dasselbe: `resume_plan` setzt in allen genannten Zuständen fort, `read_plan_control` liefert `canResume`, `resumeKind` und bei Sperre `resumeBlock` (Grund und Handlung) passend zur Oberfläche.


# Entschieden (noch nicht umgesetzt)

Im Ausgangstext keine weitere Festlegung ausdrücklich als noch nicht umgesetzt ausgewiesen.

# Festlegungen ohne eindeutigen Umsetzungsstand

Die Quelle nennt diese Festlegungen als entschieden oder umgesetzt, ohne ihren Umsetzungsstand eindeutig zuzuordnen. Historische Zielverträge sind keine Auslieferungsnachweise; spätere datierte Präzisierungen bleiben maßgeblich.

## Planpanel: Steuerung, Sequenz und Planaktionen (Entscheidung 22.10.2026)

**Bestätigtes Ziel, nicht als bereits ausgeliefert behauptet:** Im oberen Panel stehen **Starten · Pause · Stop**. Alle Laufbuttons haben dieselbe feste Breite und Höhe, ausreichend für **Fortsetzen**. Beschriftungswechsel/Disabled/Pending dürfen die Leiste nicht verschieben; Touch, Tastatur und Übersetzungen bleiben nutzbar.

Pause lässt die bereits laufenden Schritte (auch parallel) kontrolliert auslaufen, startet aber keine weiteren wartenden Schritte. Die Oberfläche zeigt bis dahin Pause angefordert; Stop unterbricht die gesamte eigene Sequenz und meldet zunächst Stop angefordert. Der mittlere Button heißt bei stabiler Pause oder relevanter Blockade **Fortsetzen** und führt am letzten sicheren offenen Stand weiter. Erfolgreich abgeschlossene Schritte werden nicht wiederholt. Fehlt ein sicherer Weg, bleibt Fortsetzen mit verständlichem Grund gesperrt. Ein erforderlicher neuer Versuch/eine neue Sitzung des unterbrochenen Schritts sowie mögliche Seiteneffekte brauchen eine ehrliche Darstellung und vorhandene nötige Freigabe; kein versteckter kompletter Neustart.

**Ergänzung Igor, 23.10.2026 – Fehler und Unstimmigkeiten:** Im eingeklappten oberen Planpanel nur einen kurzen verständlichen Statushinweis mit Aufklappziel zeigen; keine ausführlichen Ursachen, Fehlerlisten oder Logs. Erst aufgeklappt folgen betroffener Schritt, Ursache, erhaltener sicherer Stand und konkrete nächste Handlung. Laufbuttonbreiten/-höhen und korrekte Verfügbarkeit bleiben auch kompakt stabil. Aufklappen startet/ändert keinen Lauf und keine Recovery; Tastaturbedienung, aria-expanded/aria-controls und Fokus erhalten. Ältere Layoutreferenzen mit ständig sichtbaren langen Fehlertexten sind in diesem Punkt überholt. Zielvertrag, kein Auslieferungsnachweis.

Die Sequenz unten beginnt mit **1 Start** und folgt den **Ablaufkanten**. Beispiel: 1 Start → 2 Vorbereitung → parallel 3 Backend / 4 Frontend → 5 Prüfung → 6 Ende. Nummern ordnen nur die Darstellung, nicht die tatsächliche Parallelität. Reihenfolge bei gleichzeitiger Bereitschaft stabil halten; Status und Klickziele über Node-ID korrekt zuordnen. Datenbindungen/Canvaspositionen/Arrayreihenfolge sind keine Ausführungsreihenfolge.

**Präzisierung Igor, 23.10.2026:** Im oberen Panel bündelt ein **⋯-Kontext-/Aktionsmenü** die Einträge **Neu, Bearbeiten, Klonen und Entfernen**, statt separater Verwaltungsbuttons. Neu/Bearbeiten öffnen ihre Konfiguration im Modal; zusätzliche Feldvorgaben der Vorschau bleiben Vorschlag. Entfernen zeigt nur eine kurze zielbezogene Bestätigung mit **Abbrechen / Löschen**, ohne Namenseingabe, Checkbox oder zweite Bestätigung. Laufsteuerung/Graph-Speichern bleiben getrennt; bestehende Aktionsrechte und Runsperren bleiben bindend. Klonen fragt einen gültigen Namen/Zielkontext ab und kopiert den vollständigen Graphen unabhängig, ohne Historie/Sessions/Secrets/Dateien oder Autostart; Quelle und Entwurf nicht still verändern. Entfernen braucht das tatsächliche bestehende Löschrecht/Bestätigung, ist bei aktiven Runs gesperrt und löscht keine Workspacedateien oder fremde Objekte. Lauf-/Edit-/Lesefreigabe ist nicht automatisch Eigentümer-Löschrecht. Details im [technischen Planvertrag](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440).



# Offen

Keine weitere offene Sachfrage im Ausgangstext ausdrücklich ausgewiesen.

