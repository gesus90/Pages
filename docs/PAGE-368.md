# PAGE-368: Antigravity-Verbrauch und OpenRouter-Vergleich

Implementierungs- und Nachweishandoff vom 15.11.2026, gemäß dem reduzierten
Ticketumfang von Igor. Dies ist keine Live-Abnahme des Providers.

## Umsetzung und Herkunft (T1)

Die gemeinsame ACP-Erfassung aus PAGE-85 wird weiterverwendet. Der vorbereitete
Branch enthielt den PAGE-364-Preiskatalog noch nicht. Dessen lokal vorhandene
Fassung aus `8ca66416` (ursprünglich `9a6f9b87`) wurde für gemeinsame ACP-Werte
adaptiert; ein Branchwechsel oder die Übernahme des gesamten anderen Tickets
war dafür nicht nötig. Die vorherige Arbeit, insbesondere PAGE-367 in
`840eab77`, bleibt erhalten.

| Verhalten                    | Datei und Umsetzung                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tatsächlich gemeldete Tokens | `backend/service/agents/sessions/AgentSessionUsage.ts`: bestehende Validierung von Eingabe, Ausgabe, Cache-Lesen, Cache-Schreiben und Gesamtzahl. Fehlende Werte bleiben `null`; Kontextbelegung und Textlängen werden nicht zu Verbrauch umgerechnet. Antigravity bleibt vorsichtig als teilweise erfasst mit unbekannter Cache-Semantik eingestuft.                                                                                                                                      |
| Fehlender Turn-Verbrauch     | `backend/service/agents/sessions/AgentSessionRecorder.ts`: auch ein Antigravity-Prompt ohne Usage schreibt einen Turn mit unbekannten Zählern. Dadurch verschwindet eine solche Lücke nicht zwischen bekannten Turns. Für andere Provider bleibt der bisherige Pfad erhalten.                                                                                                                                                                                                              |
| Speicherung und Wiederholung | Bestehende `AgentSessionRepository.saveTurnUsage`, `LocalSessionOutbox` und `LocalSessionImport`: ein Turn wird über `(attempt_id, turn)` ersetzt, auch bei Replay. Kein neues Datenbankschema. Die neue Auswertung verwendet zusätzlich `withTurnUsage` und `sumTurnUsage`.                                                                                                                                                                                                               |
| Schritt und Lauf             | `backend/service/agents/sessions/AntigravityUsage.ts` und `AgentSessionService.ts`: getrennte Antigravity-Summen; erwartete Versuche werden aus den autorisierten Laufdaten einschließlich gespeicherter Schleifen und Retry-IDs gelesen. Eine fehlende Meldung macht die Summe teilweise und den Betrag unbekannt. Andere Provider werden nicht in diese Summe einbezogen.                                                                                                                |
| Modellzuordnung              | Der Modellwert eines Turns hat Vorrang. Fehlt er, darf ausschließlich das bestätigte `record.effective.model` desselben Versuchs verwendet werden. Ein angefragtes Modell allein bestätigt keinen Preis. Retry-Versuche ohne erhaltene Bestätigung bleiben unbekannt.                                                                                                                                                                                                                      |
| Katalog und Rechenbetrag     | `backend/service/agents/sessions/OpenRouterPriceCatalog.ts`: öffentlicher OpenRouter-Katalog, tägliche Aktualisierung, zusammengefasste gleichzeitige Ladevorgänge, datierter Offline-Snapshot mit privatem Schreibmodus und atomarem Rename. Ausfälle behalten einen vorhandenen alten Stand und seinen tatsächlichen Zeitpunkt.                                                                                                                                                          |
| Keine geratenen Tarife       | Nur exakte IDs, optional ohne `openrouter/` bzw. für Antigravity mit exaktem `google/`-Präfix. Kein erratener Hydrogen-Alias. Fehlende Cache-Preise werden nicht durch normale Eingabepreise ersetzt. Ausdrückliche Nullpreise sind erlaubt; leere, negative und ungültige Preise sind unbekannt.                                                                                                                                                                                          |
| Keine Token-Doppelberechnung | Bei bestätigten enthaltenen Cache-Lese-Tokens werden diese vor dem normalen Eingabepreis einmal abgezogen. Unbestätigte nichtleere Cache-Zähler führen zu unbekanntem Betrag. Die Gesamtzahl und Reasoning werden nicht zusätzlich zu Eingabe/Ausgabe berechnet.                                                                                                                                                                                                                           |
| Einbindung und Verträge      | `app/lib/agent-plan-services.server.ts`, `definition/AgentSessionPricing.ts`, `definition/AgentSessionJournal.ts`: optionale Antigravity-Projektion nach dem bestehenden Berechtigungscheck. Der Katalog liegt zur Laufzeit im konfigurierten Instanz-Datenverzeichnis; keine Schlüssel nötig. Bei unvollständigen Zählern wird kein Katalogabruf für eine ohnehin unmögliche Rechnung gestartet.                                                                                          |
| Anzeige                      | `app/components/agents/plans/plan-agent-console/antigravity-usage-section.tsx`, `console-sidebar.tsx`, deutsche/englische Übersetzungen: getrennte Schritt-/Laufwerte für Eingabe, beide Cache-Arten und Ausgabe; Reasoning ausdrücklich unbekannt. Rechenbetrag und Abo-Abrechnung sind getrennt. Die vorhandene native Session-Kostenmeldung heißt bei Antigravity ausdrücklich Provider-Meldung und gilt nicht als Abo-Rechnung. Lücken, Teilstände und Katalogzeitpunkt sind sichtbar. |

Die Gebühren eines Abos werden weder auf Tokens umgelegt noch mit einem
OpenRouter-Betrag gleichgesetzt. Der konkrete Abo-Status der Verbindung wird
nicht aus ihrem Anzeigenamen abgeleitet. Weil er hier nicht nachgewiesen ist,
meldet die Anzeige die Abo-Kosten als unbekannt, auch wenn laut Ticket Igors
Verbindung ein Abo nutzt.

## Gezielte Funktionsnachweise

Backend, letzter Lauf: **4 Dateien, 22 Tests bestanden**, ohne Coverage:

```sh
NODE_ENV=test pnpm exec vitest run --config vitest.backend.config.ts --coverage.enabled=false tests/backend/backend/service/agents/page368-price-catalog.unit.test.ts tests/backend/backend/service/agents/page368-antigravity-usage.unit.test.ts tests/backend/backend/service/agents/page85-session-usage.unit.test.ts tests/backend/backend/service/agents/page85-session-service.unit.test.ts
```

- `page368-price-catalog.unit.test.ts`: 5 Tests mit gemocktem HTTP und
  Dateisystem; exakte Zuordnung, täglicher gemeinsamer Abruf, datierter privater
  Snapshot, Offline-Nutzung, unbekannte Tokens/Cache-Semantik/Preise, echte
  Nullpreise und einmaliger Cache-Abzug. Die Preise sind synthetische Fixtures,
  keine Aussage zum aktuellen OpenRouter-Angebot.
- `page368-antigravity-usage.unit.test.ts`: 4 Tests mit Memory-Store und
  gemockter Preisgrenze; Deduplizierung, Versuchssummen, Provider-Trennung,
  fehlende Versuche, bestätigter Modell-Fallback und Aufnahme eines Turns ohne
  Usage über den echten Session-Service. Kontextbelegung bleibt separat.
- Bestehende `page85-session-usage.unit.test.ts` und
  `page85-session-service.unit.test.ts`: 13 Tests der gemeinsamen Zähler,
  Session-Zuordnung und bisherigen Service-Verträge. Das ersetzt keine
  vollständige Regression aller Provider.

Frontend, letzter Lauf: **2 Dateien, 15 Tests bestanden**, ohne Coverage:

```sh
NODE_ENV=test pnpm exec vitest run --config vitest.frontend.config.ts --coverage.enabled=false tests/frontend/app/components/agents/plans/plan-agent-console/antigravity-usage-section.unit.test.tsx tests/frontend/app/components/agents/plans/plan-agent-console/console-session.unit.test.tsx
```

Die 2 neuen Tests prüfen Rechenbetrag versus unbekannte Abo-Kosten, unbekanntes
Reasoning, sichtbare Lücken und das Ausbleiben des neuen Abschnitts für andere
Provider. Die 13 bestehenden Console-Session-Tests bleiben grün. Dies sind
isolierte React-Tests in jsdom, keine Browser- oder Live-Anzeigenachweise.

Der erste Frontend-Aufruf ohne `NODE_ENV=test` scheiterte vor dem Rendern an
`React.act is not a function`, weil die Umgebung Produktions-React auswählte.
Der oben dokumentierte Aufruf mit Testumgebung bestand unverändert; keine
Tests oder Infrastruktur wurden dafür abgeschwächt.

Lint, Check, Typecheck, Formatprüfung, Build, vollständige Suiten und Coverage:
**an die Abschluss-QA übergeben**, nicht ausgeführt und nicht als bestanden
behauptet. Die berührten Quellen wurden formatiert; eine Formatprüfung wurde
nicht ausgeführt.

## Fehlende Daten und zurückgestellte Nachweise (T2)

- **Reasoning:** Der hier verwendete ACP-`Usage`-Vertrag liefert keinen eigenen
  Reasoning-Zähler. Er bleibt `null`. Es gibt keine Ableitung aus Gedanken-Text,
  Gesamtzahl oder Effort. Zusätzliche native Felder von `agy` sind nicht
  verifiziert und werden nicht spekulativ ausgewertet.
- **Vollständigkeit und Zählweise:** Antigravity bleibt `per_prompt` und
  `isPartial: true` gemäß bisheriger Capability-Tabelle. Ob alle Modellaufrufe,
  delegierte Arbeit, interne Wiederholungen und Cache-Arten enthalten sind,
  ist nicht live belegt. Ein berechenbarer Betrag bewertet nur die gemeldeten
  Tokens; er behauptet keine vollständigen Laufkosten. Unbestätigte positive
  Cache-Zähler oder fehlende Cache-Werte verhindern einen Rechenbetrag.
- **Historische Lücken:** Für neue abgeschlossene Prompts ohne Usage wird ein
  unbekannter Turn gespeichert. Bereits früher ausgelassene Turns innerhalb
  eines ansonsten vorhandenen Versuchs lassen sich nicht rückwirkend zählen.
  Ein Abbruch vor der Prompt-Antwort kann ebenfalls ohne Turn-Verbrauch bleiben;
  ein ganz fehlender erwarteter Versuch wird in der Projektion markiert.
- **Preise und Modelle:** Kein Live-Abruf, kein Nachweis eines realen Treffers
  für `gemini-4-hydrogen` und keine Alias-Tabelle oder Mapping-Einstellung neu
  eingeführt. Fehlende Modelltreffer, Cache-Tarife oder ein fehlender Katalog
  bleiben unbekannt. Ein alter Offline-Katalog wird als alter Stand angezeigt.
- **Preisstände:** Der tägliche Katalog-Snapshot wird gespeichert, die Rechnung
  aber beim autorisierten Lesen erstellt. Keine unveränderlichen Einzelpreise
  oder Kostenbelege je Turn in der Datenbank; spätere Katalogstände können die
  angezeigte Schätzung ändern. Das bleibt für eine spätere fachliche Erweiterung
  zurückgestellt. Die Anzeige ist keine historische Abrechnung.
- **Abo:** Keine Prüfung von Google-Konto, Aboberechtigung, Restkontingent oder
  Rechnung. Kein bestätigtes „im Abo“-Badge. Der Ticket-Hinweis ersetzt diese
  technische Provider-Bestätigung nicht; Gebühren bleiben getrennt und unbekannt.
- **Live und Betriebswege:** Kein Provider-Lauf, kein kompletter Live-Vergleich
  aller Tokenarten, keine Echtzeit-Anzeigenprüfung und keine neue Wegwerf-Instanz.
  Die reine Aggregation wird mit Versuch-Fixtures geprüft; reale Schleifen,
  Gruppen, Retry-Prozesse, Remote-Transport und Prozess-Neustarts wurden hier
  nicht neu durchlaufen. Der bestehende Persistenz-/Outbox-Pfad wird verwendet,
  aber nicht mit einer echten Datenbank oder einem ACP-Prozess neu abgenommen.
- **Betriebsgrenzen:** Der erste berechenbare Abruf kann bis zum bestehenden
  Katalog-Timeout von 15 Sekunden warten. Der Offline-/HTTP-Fehlerpfad wurde mit
  Mocks geprüft, nicht gegen einen ausgefallenen realen Anbieter.

Keine Änderungen an Live-Diensten, Live-Daten oder Zugangsdaten; kein Push,
Deployment, Rebase oder Branchwechsel. Der lokale Commit umfasst diese
Implementierung und diesen Handoff; seine ID wird im verbindlichen Pages-Bericht
genannt. T1 und T2 sind durch die oben genannten Quellen, tatsächlichen
Testläufe und ausdrücklich zurückgestellten Fälle belegt. K1 verweist auf
diesen Handoff im Workspace. Die fachliche Abnahme bleibt beim Review.
