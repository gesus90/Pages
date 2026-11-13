# PAGE-378: Wiki-Entwurf für „Agents: Festlegungen“

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Der folgende Abschnitt ersetzt „DREAM.md – Lehren“ und den einen Zeitpunkt des Traumlaufs aus PAGE-305 und baut auf dem Lagebuch aus PAGE-377 auf.

---

## Dreaming: Zeitplan je Agent, Lektionen und Rezepte (umgesetzt)

**Wozu.** Jeder Agent wird mit der Zeit effizienter. Ein Verdichtungslauf („Dreaming“) wertet aus, was der Agent erlebt hat und wie er gearbeitet hat, und macht daraus dauerhaftes Wissen (`MEMORY.md`), Lektionen zur Arbeitsweise (`DREAM.md`) und Rezepte, Abkürzungen, die der Agent sofort nutzt. Lektionen und Rezepte wirken ohne Freigabe.

**Zeitplan je Agent** (`agent_employees`, Migration 059; Reiter „Dreaming“ im Popup „Agent-Einstellungen“):

- Ein/Aus (`is_learning_enabled`): schaltet den Zeitplan und den Anstoß durch das Lagebuch aus. „Jetzt träumen“ läuft auch dann.
- Takt: Intervall als Zahl plus Einheit, von **1 Stunde bis 30 Tage** (Stunden 1 bis 720, Tage 1 bis 30). Stunden zählen ab dem letzten Lauf. Tage laufen zur Uhrzeit (`HH:MM`, Zeitzone des Servers; ohne eigene Zeit gilt die Zeit der Instanz, Einstellungen → Agents, Standard 03:00): täglich, jeden n-ten Tag nach dem letzten Lauf, und bei 7 Tagen auf Wunsch an einem Wochentag (1 Montag bis 7 Sonntag). Beispiele: „alle 1 Stunde“, „alle 6 Stunden“, „täglich um 02:00“, „jeden Montag um 02:00“, „alle 30 Tage um 02:00“.
- „Bei vollem Lagebuch“ (`dream_on_full_logbook`, Standard an): Das Lagebuch stößt bei etwa 80 % Füllung einen Lauf an (PAGE-377), höchstens einmal je Stunde.
- Modell für Dreaming (`dream_connection_id`, `dream_model`): ein Modell, das der Administrator wählen darf; ohne eigene Wahl das Modell des Agents. Ein Modell, das die Regel für Agents nicht mehr erfüllt, fällt auf das eigene Modell zurück.
- Der nächste Lauf ist der erste Zeitpunkt des Takts nach dem letzten Lauf (`nextDreamRun`); ein Lauf, der spät kam, verschiebt die folgenden. Die Anzeige im Reiter und das Starten durch den Planer (`AgentLearningScheduler`, jede Minute) rechnen dieselbe Funktion.
- **Nur in der Ruhepause.** Ein Lauf startet nur, wenn der Agent in keinem Chat arbeitet (eine Runde läuft oder wartet). Ein geplanter Lauf bleibt sonst fällig und startet beim nächsten ruhigen Blick des Planers. „Jetzt träumen“ und der Anstoß des Lagebuchs merken sich ihren Wunsch (`dream_requested_at`, `dream_requested_trigger`) und laufen in der nächsten Ruhepause; der Reiter zeigt „wartet auf eine Ruhepause“.

**Was ein Lauf tut** (`AgentLearningService`, ein Modellaufruf, nur wenn es etwas Neues gibt: Lagebuch-Einträge, Werkzeugaufrufe, Inhalte der Chats, Projekte, Gruppen und Planläufe seit dem letzten Lauf oder ein Rezept, das nach Fehlschlägen ausgeschaltet ist; vertrauliche Chats bleiben überall draußen):

1. **Wissen verdichten.** Das Modell liest die neuen Einträge des Lagebuchs (die ältesten zuerst, höchstens 80 je Lauf, sie fallen zuerst aus dem Ringpuffer). Dauerhaftes (Entscheidungen, Vorlieben, Projektwissen, Zuständigkeiten) wird ein knappes Thema in `MEMORY.md` mit Quelle (der Chat des ersten genannten Eintrags, damit die Regeln zum Teilen gelten), Tickets und Datum; Erledigtes wandert ins Archiv, Veraltetes wird verworfen.
2. **Arbeitsweise auswerten.** Das Modell liest eine Verdichtung der Werkzeugaufrufe (Zähler je Werkzeug, mehrfach gleiche Aufrufe mit Pfaden, IDs und festen Werten, Fehlschläge mit Fehler, die Reihenfolge der neuesten Aufrufe) und daraus Lektionen: häufige Pfade und Orte, feste Werte, Fehlschläge und ihre Lösung, teure Muster. Die Lektionen stehen in `DREAM.md` mit Beleg, Datum und Stärke; bestätigte werden gestärkt (Stärke steigt), schwache fallen heraus, wenn die Datei voll ist. Eine ausgeschaltete Lektion bleibt ausgeschaltet, auch wenn der Lauf sie bestätigt.
3. **Rezepte anlegen.** Wiederkehrende Abläufe werden Rezepte (siehe unten); der Lauf legt sie an, korrigiert ein ausgeschaltetes Rezept, verwirft Rezepte und lässt selten genutzte Rezepte des Laufs herausfallen (45 Tage ungenutzt, Stärke 1, weniger als 3 Nutzungen); höchstens 40 Rezepte je Agent.
4. Alles wirkt sofort. Jeder Lauf legt eine Version an und schreibt sein Protokoll (übernommen, gelernt, bestätigt, verworfen, Rezepte angelegt, aktualisiert, verworfen), das der Reiter für den letzten Lauf zeigt.

**Werkzeugaufrufe als Quelle** (`agent_tool_uses`). Jede Chat-Sitzung eines Agents hält ihre Aufrufe fest: Werkzeug, Eingabe und Anfang des Ergebnisses (begrenzt, Zugangsdaten maskiert), Erfolg oder Fehler. Aufrufe von Rechner-Werkzeugen („Arbeitsplatz“, „YOLO“) stehen mit dem Vorsatz `host:` darin. Ein vertraulicher Chat schreibt nichts; Aufrufe sind 30 Tage lesbar.

**Rezepte** (`agent_recipes`):

- **Ablauf-Rezept:** eine feste Kette von bis zu 8 Werkzeugaufrufen mit Platzhaltern: `{{name}}` für einen Parameter, `{{2.ticket.id}}` für ein Feld des Ergebnisses von Schritt 2. Aufruf mit dem Werkzeug `rezept(name, parameter)`: die Kette läuft in einem Aufruf, die Antwort nennt den Stand jedes Schritts und das Ergebnis des letzten. `rezept()` ohne Namen listet die Rezepte, `rezept(name)` eines Wissens-Rezepts liefert seine Anleitung.
- **Wissens-Rezept:** eine kurze Anleitung (bis 1.500 Zeichen) mit festen Pfaden und Werten. Sie wird nur in die Runde geladen, wenn ihre Stichwörter oder ihr Name zur Nachricht passen (höchstens drei).
- Jedes Rezept trägt Beleg, Datum der letzten Bestätigung, Stärke, Nutzungszahl, letzte Nutzung und Status.
- **Laden in die Sitzungen.** Jede Runde einer Chat-Sitzung (also auch beim Start und nach einem Neustart) enthält `MEMORY.md`, `DREAM.md` (ohne ausgeschaltete Lektionen) und die Liste der Rezepte, die an sind, mit Name, Art und Kurzbeschreibung. Ein neues Rezept ist sofort aufrufbar, auch wenn es in der Liste der laufenden Sitzung noch fehlt.

**Sicherheitsregeln für Rezepte.**

- Ein Rezept verleiht keine Rechte: Jeder Schritt ruft ein Werkzeug über dieselbe Werkzeugliste, mit denselben Prüfungen und demselben Aufrufbudget wie ein Aufruf des Agents. Ein Werkzeug, das die Sitzung nicht anbietet, macht den Schritt zum Fehlschlag.
- Löschen, Entfernen, Archivieren und alles andere, was die normale Bestätigung braucht, führt ein Rezept nie selbst aus: Werkzeuge, deren Name löscht, entfernt oder archiviert, jedes Administrator-Werkzeug, eine Eingabe mit einer Bestätigung und ein Werkzeug, das selbst `CONFIRMATION_REQUIRED` antwortet, halten das Rezept an dieser Stelle an. Der Agent ruft das Werkzeug dann selbst auf und fragt wie sonst. Ein solcher Schritt wird weder vom Lauf noch beim Bearbeiten als Rezept-Schritt angenommen. Das Rezept ruft sich nicht selbst.
- Schlägt ein Rezept **zweimal hintereinander** fehl, wird es ausgeschaltet (`disabled_reason = failed`) und nicht mehr aufgelistet; der nächste Lauf korrigiert oder verwirft es. Ein Erfolg setzt den Zähler zurück. Ein Haltepunkt für die Bestätigung, fehlende Parameter und ein verbrauchtes Aufrufbudget zählen nicht als Fehlschlag.
- Rezepte lassen sich von Hand einschalten (der Zähler beginnt neu), ausschalten und löschen; ein von Hand ausgeschaltetes Rezept schaltet der Lauf nicht wieder ein.

**Oberfläche.** Die Reiter „Dreaming“ und „Lektionen & Rezepte“ im Popup „Agent-Einstellungen“ öffnen sich über „Dreaming, Lektionen & Rezepte …“ im Kontextmenü eines Agents im Chat und über Einstellungen → Agents. Endpunkte: `/chat-page-api/agent-dreaming` (lesen, `save-settings`, `run-now`) und `/chat-page-api/agent-lessons` (lesen, `save-lesson`, `set-lesson-active`, `remove-lesson`, `save-recipe`, `set-recipe-active`, `remove-recipe`). Den Zeitplan sehen alle; Protokoll, `MEMORY.md`, `DREAM.md`, Lektionen und Rezepte sehen und ändern nur Administratoren im Admin-Modus, denn sie halten, was der Agent aus den Chats seiner Leute gelernt hat; nur sie speichern den Zeitplan und starten „Jetzt träumen“.

**Nicht Teil davon:** die Sitzungsverwaltung je Chat (PAGE-376) und Aufbau und Werkzeuge des Lagebuchs (PAGE-377).
