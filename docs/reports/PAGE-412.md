# PAGE-412 — Gruppen als Sitzungsspeicher

Stand: 14.11.2026. Technische Umsetzung auf dem vorbereiteten Session-Branch;
keine Änderungen an gespeicherten Live-Plänen, Diensten oder Zugangsdaten.

## Umsetzung

- Gruppen speichern enthaltene Loops optional unter `loops`; ihre bisherigen
  Agenten bleiben unter `steps`. Die neue Richtung ist Gruppe → Loop →
  Agent/Script mit separaten Entscheidungen. Bisherige Gruppen in Loops bleiben
  erhalten; tiefere Containerstrukturen und doppelte Identitäten werden abgewiesen.
- Drag-and-drop, Mitgliederkoordinaten, Rahmengrößen, Einklappen, Auswahl,
  Einstellungen und die bestehenden strukturierten Planänderungen verstehen die
  neue Richtung. Beim Verschieben einer ganzen Loop bleiben Flow-Kanten,
  Einstellungen, Parameter-, Stack- und Ergebnisbindungen erhalten. Speichern,
  erneutes Lesen, Klonen und Gruppenvorlagen erhalten die Struktur bzw. ordnen
  kopierte Identitäten konsistent neu zu.
- Der Snapshot hält den Gruppenbesitzer zusätzlich zum aufgelösten
  Ausführungsgraphen fest. Alle kompatiblen Agenten einer äußeren Gruppe teilen
  `runId/groupId`, auch in verschiedenen Loops und Iterationen. Die bestehenden
  Prüfungen für Adapter, Verbindung, Modell, Workspace und Zugriff gelten auch
  für die enthaltenen Agenten. Keine Provider- oder Credential-Umschaltung.
- Die vorhandene Besitzerwarteschlange serialisiert bereite Agent-Züge. Die
  Flow-Kanten bestimmen Bereitschaft; Koordinaten erzeugen keine Abhängigkeiten.
  Der erste tatsächlich ausgeführte Agent öffnet die Sitzung. Gruppenvorbereitung
  bewahrt die aktuellen Iterations- und Voriterationsbindungen.
- Innere Loops übernehmen die Gruppensitzung unabhängig von ihrer gespeicherten
  `fresh/reuse`-Wahl. Der Editor zeigt „Sitzung der Gruppe übernehmen“. Außerhalb
  der Gruppe bleibt der bisherige Schalter wirksam.
- Eine solche Gruppe hält ihre Sitzung bis zum bestehenden abschließenden
  Scheduler-Closeout des Laufs. Loop-Ende und erstmalig besuchte Agent-IDs beenden
  sie nicht. Pause bewahrt den Besitzer; Wiederanbindung nutzt die gespeicherte
  Gruppenidentität. Ein nicht verfügbarer Besitzer wird als verloren gemerkt,
  sodass keine leere Ersatzsitzung entsteht. Stop adressiert den tatsächlichen
  Besitzer innerhalb des eigenen Laufs.
- Agent-Versuche und Iterationen behalten getrennte Aufträge, Ergebnisse,
  Abnahmen und TODOs. Sitzungslinks enthalten Gruppen- und Loop-Bezug,
  ACP/native Identität und Zugnummer. Bestehende Verbrauchsbuchung bleibt pro
  Versuch; der Gruppenbesitzer führt keine zusätzliche Verbrauchssumme.
  Skripte erzeugen keinen Agent-Zug; Modellentscheidungen behalten ihren eigenen
  Sitzungsweg. Ein vollständiger neuer Start hat einen neuen Besitzer.

Die dauerhaften Besitz- und Lebensdauerregeln stehen in
[AgentPlanRunner.md](../AgentPlanRunner.md#groups-own-loop-sessions).

## Lokale Funktionsnachweise

Alle externen Modell-, Prozess- und Persistenzgrenzen bleiben in den verwendeten
Unit-Tests synthetisch. Kein Provider, Datenbankserver, MCP-Transport oder
Live-Plan wurde dafür gestartet.

Backend, gezielt sieben Dateien, **111 Tests bestanden**, Exitcode 0:

```sh
./node_modules/.bin/vitest run --config vitest.backend.config.ts --coverage.enabled false \
  tests/backend/backend/service/agents/page412-group-loops.unit.test.ts \
  tests/backend/backend/service/agents/page175-loop-run.unit.test.ts \
  tests/backend/backend/service/agents/page73-group-run.unit.test.ts \
  tests/backend/definition/agent-plan-group.unit.test.ts \
  tests/backend/definition/agent-plan-group-edit-flow.unit.test.ts \
  tests/backend/definition/agent-plan-loop-edit.unit.test.ts \
  tests/backend/definition/agent-plan-loop-graph.unit.test.ts
```

Die zwölf PAGE-412-Fälle prüfen insbesondere den Ablauf vor/zwei Loops/nach,
Skriptknoten, JSON-Roundtrip und Verschieben, Pause/Fortsetzen, Loop als ersten
Sitzungsöffner, neue vollständige Starts, inkompatible Agenten, unzulässige
Containerrekursion, Voriterationswerte, konkurrierend bereite Loops, Stop,
verlorene wiederhergestellte Besitzer, strukturierte Änderungen, Klonen,
Gruppenvorlagen sowie aktuelle Stack-/Ticket- und Agent-zu-Script-Ergebniswerte.
Die übrigen gezielten Dateien sichern bestehende Gruppen und Loops ab.

Frontend, gezielt vier Dateien, **73 Tests bestanden**, Exitcode 0:

```sh
./node_modules/.bin/vitest run --config vitest.frontend.config.ts --coverage.enabled false \
  tests/frontend/app/components/agents/plans/plan-loop-panel.unit.test.tsx \
  tests/frontend/app/components/agents/plans/use-plan-group-actions-loops.unit.test.tsx \
  tests/frontend/app/components/agents/plans/plan-flow-model.unit.test.ts \
  tests/frontend/definition/agent-plan-group-progress.unit.test.ts
```

Nachgewiesen sind der vererbte Sitzungsbereich ohne widersprüchlichen Schalter,
Verschieben der vollständigen Loop mit unveränderten Mitgliedskoordinaten,
Elternprojektion/Rahmen, Ausblenden der Loop-Verbindungen beim Einklappen sowie
die betroffenen bisherigen Editor- und Fortschrittsfunktionen.

## Abgrenzung und Entscheidungen

- Die spätere Abnahmevorgabe fordert gezielte Funktionstests; deshalb wurden
  entsprechende Unit-Fälle ergänzt, trotz des früheren Testentwicklungsverbots
  im Tickettext. Keine neuen Testinfrastrukturen oder Abhängigkeiten.
- Optionale Gruppen-Loops vermeiden eine automatische Umgestaltung alter Pläne.
  Die bestehende Gruppensitzungsverwaltung und die bestehenden autorisierten
  Planoperationen werden erweitert; kein zusätzliches Orchestrierungssystem.
- Gruppen mit Loops werden bewusst bis zum sicheren Lauf-Closeout gehalten.
  Eine grafische Position oder eine einmal vollständig besuchte Mitgliederliste
  ist kein Nachweis, dass keine weiteren Züge mehr folgen.
- Lint, Check, Typecheck, Formatprüfung, Build, vollständige Testsuiten und
  Coverage: **an die Abschluss-QA übergeben**, gemäß Abnahmevorgabe nicht ausgeführt.
- Echte Provider-Livebelege einschließlich nativer Wiederanbindung nach einem
  realen Dienstneustart und realer Tokenabrechnung bleiben **unbestätigt**.
  Die lokalen Ergebnisse belegen die technische Orchestrierung mit synthetischen
  externen Grenzen und werden nicht als Provider-Liveabnahme ausgegeben.
- Kein Push und kein Deployment.
