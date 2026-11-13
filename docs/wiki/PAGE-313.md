# Swarm-Knoten im Agent-Plan

> Entwurf zu PAGE-313. Wird nach der Abnahme ins Wiki übertragen.

## Was ist Swarm

Ein **Swarm** ist ein Knoten im Agent-Plan, in dem ein **Hauptmodell** eine Aufgabe zur Laufzeit auf mehrere **Helfer** (H1 … H10) verteilt. Das Hauptmodell läuft in einer eigenen Sitzung, jeder Helfer ebenfalls in einer eigenen Sitzung mit seinem Modell. Alle arbeiten im selben Arbeitsverzeichnis auf dem Pages-Rechner. Das Hauptmodell teilt die Aufgabe auf, vergibt Teilaufgaben, überwacht die Helfer, behandelt Fehler und fasst das Ergebnis zusammen.

Beispiel: Opus als Hauptmodell, fünf Helfer, H1–H2 mit einem Codex-Modell, H3–H5 mit DeepSeek über OpenCode. Aufgabe: „Analysiere alle Dokumente in `docs/`“. Das Hauptmodell gibt jedem Helfer einen Ordner oder jedem Helfer eine andere Teilaufgabe über alle Dateien.

## Einrichten

Den Knoten „Swarm“ aus der Palette in den Plan ziehen und mit Start und Ende verbinden. Das Einstellungs-Panel hat vier Abschnitte:

1. **Aufgabe** – als Text oder aus einem Ticket-Knoten des Plans.
2. **Hauptmodell** – Anbindung, Modell und Reasoning (wie bei Agent-Knoten, nur ACP-Anbindungen), Zugriff und optional eine zusätzliche Anweisung.
3. **Helfer** – Anzahl 1–10 mit − und +. „Für alle gleich“ nutzt eine Modellwahl für alle Helfer, „Einzeln“ zeigt eine Zeile je Helfer. Zugriff je Helfer: _Nur lesen_, _Schreiben_ (Dateien schreiben, Pages nur lesen) oder _YOLO_. Optional eine gemeinsame Anweisung für alle Helfer.
4. **Ausführung** – Arbeitsverzeichnis (unterhalb des Plan-Arbeitsbereichs) und Zeitgrenze für den ganzen Knoten in Minuten (1–1440). Es gibt keine Kostengrenze.

Swarm-Knoten laufen **nur auf dem Pages-Rechner**. Ein fernes Ausführungsziel – am Knoten oder vom Plan geerbt – wird beim Speichern abgewiesen: „Swarm-Knoten laufen nur auf dem Pages-Rechner. Wähle ein lokales Ziel.“

Über die Pages-Schnittstelle legen `create_plan` und `update_plan` Swarm-Knoten mit dem Typ `swarm` an (Felder `task`, `main`, `workers`, `directory`, `timeoutMinutes`, `executionTarget`).

## Werkzeuge

Das Hauptmodell erhält `swarm_assign`, `swarm_status`, `swarm_result`, `swarm_cancel` und `swarm_finish`. Helfer erhalten `swarm_lock`, `swarm_unlock` und `swarm_locks`. Die Werkzeuge wirken nur im eigenen Lauf und Knoten; der Server prüft das bei jedem Aufruf. Kein Werkzeug wartet blockierend: `swarm_status` kehrt sofort zurück oder mit `waitSeconds` spätestens nach dieser Zeit beim nächsten Wechsel.

## Bereiche, Sperren, Verstöße

- **Bereiche:** `swarm_assign` kann einer Teilaufgabe Pfade oder Ordner geben. Bereiche gleichzeitig wartender oder laufender Teilaufgaben dürfen sich nicht überlappen; eine Überlappung wird abgewiesen, ohne dass sich etwas ändert.
- **Sperren je Datei:** Vor dem Bearbeiten einer Datei außerhalb seines Bereichs sperrt ein Helfer sie mit `swarm_lock`. Die Antwort kommt sofort: „gesperrt“ oder „gesperrt von Hn“. Die Sperrliste ist virtuell; es entstehen keine `.lock`-Dateien. Lesen braucht keine Sperre.
- Sperren haben Besitzer und Ablaufzeit und verlängern sich, solange der Helfer lebt. Sie werden frei, wenn die Teilaufgabe endet, abgebrochen wird oder der Helfer abstürzt. Ein beendeter Helfer kann danach keine Werkzeuge mehr nutzen.
- **Prüfung:** Vor und nach jeder Teilaufgabe liest Pages `git status --porcelain=v2 -z --untracked-files=all`, `HEAD` und den Index. Änderungen außerhalb der Bereiche und Sperren aller in dem Zeitraum aktiven Helfer, ein geänderter `HEAD` oder Index (zum Beispiel ein `git commit` eines Helfers) werden dem Hauptmodell als **Verstoß** mit Dateiliste gemeldet. Ist der Verursacher unklar, nennt Pages die aktiven Helfer. Eine erlaubte Änderung von H2 ist kein Verstoß von H1. Shell-Schreibzugriffe sperrt Pages nicht auf Dateisystemebene; sie werden erkannt.
- Helfer committen nicht; Commits macht das Hauptmodell am Ende oder ein späterer Plan-Schritt.

## Laufansicht

Auf der Karte stehen die Helfer als Schilder H1 … H10 (höchstens fünf pro Zeile). Farbe und Symbol zeigen den Stand: frei (grau), beschäftigt (Kreis dreht sich), fertig (Haken), fehlgeschlagen (Kreuz), nicht gestartet (durchgestrichener Kreis). Während des Laufs zeigt eine Pille „abgeschlossen/vergeben“.

Die Laufansicht zeigt die Spuren **untereinander**: oben „Haupt“ mit Modell, Tätigkeit, TODOs und Verstößen, darunter je Helfer eine Zeile mit Modell, Bereich und Teilaufgabe, Sperren und TODO-Fortschritt. Jede Zeile lässt sich aufklappen (volle Teilaufgabe, TODO-Liste, Sperren, Teilergebnis). Unten steht die Zusammenfassung des Hauptmodells. Auf dem Handy rutschen Bereich und Sperren in eine zweite Zeile; es gibt kein waagerechtes Scrollen.

`read_plan_run` liefert im Ergebnis des Knotens das Feld `swarm` mit Hauptmodell, Helfern, Teilaufgaben und Verstößen getrennt.

## Fehler und Fortsetzen

- Scheitert ein Helfer oder überschreitet er die Zeit, erhält das Hauptmodell Fehler und letzten Stand und entscheidet: neu vergeben (höchstens dreimal je Teilaufgabe), anders aufteilen oder ohne diese Teilaufgabe weitermachen.
- Kann ein Helfer nicht starten (keine Kapazität, `acp_worker_limit`, `cli_not_logged_in`), erscheint er als „nicht gestartet“; der Knoten scheitert nicht. Ein Helfer wartet höchstens 120 Sekunden auf einen ACP-Platz und startet nur, solange danach noch ein Platz frei bleibt. Startet kein Helfer, arbeitet das Hauptmodell selbst oder beendet mit „keine Helfer-Kapazität“.
- Der Knoten scheitert nur, wenn das Hauptmodell ihn mit `swarm_finish` als fehlgeschlagen beendet, die Zeitgrenze abläuft oder die Sitzung des Hauptmodells verloren geht.
- Die Aufgabentafel liegt in der Datenbank. Beim Fortsetzen erhält das Hauptmodell den gespeicherten Stand; offene Teilaufgaben gehen zurück auf die Tafel, ihre Sperren werden frei, Helfer-Sitzungen werden nicht wiederbelebt. **Fertige Teilaufgaben laufen nicht erneut.**

## Grenzen

- Nur auf dem Pages-Rechner, keine fernen Ziele.
- Höchstens 10 Helfer, Zeitgrenze 1–1440 Minuten, keine Kostengrenze.
- Sperren und Bereiche sind virtuell; das Dateisystem selbst wird nicht gesperrt.
- Das Hauptmodell muss `swarm_finish` aufrufen; endet seine Runde ohne, weckt Pages es mit dem aktuellen Stand erneut (höchstens 100 Mal).
