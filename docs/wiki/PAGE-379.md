# Wiki-Entwurf PAGE-379: Gruppen-Chats – Zuständigkeit per @ und Decision-Modell (OpenRouter Decisions) mit Schwellen

Entwurf für All Might. Er ersetzt in [PAGE-317](./PAGE-317.md) die Abschnitte „Instanzweites Entscheidungsmodell“, „Wer antwortet?“ je Gruppenchat und „Ablauf und Fallback“; der Beobachter von PAGE-296 wählt in Gruppen keine Agents mehr. Die Wiki-Seiten liegen im Live-Dienst und wurden vom Lauf nicht geändert.

---

## Ablauf in Gruppenchats

| Nachricht                                                  | Wer antwortet                                                                           | Decision-Modell gefragt?      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| Person mit `@Name` eines Agents                            | genau die genannten Agents                                                              | nein                          |
| Person mit `@Name` nur von Menschen                        | niemand (die Nachricht gilt den Genannten)                                              | nein                          |
| Agent mit `@Name`                                          | die genannten Agents (wie bisher mit Weitergabe)                                        | nein                          |
| Agent ohne `@`                                             | niemand                                                                                 | nein                          |
| Person ohne `@`, Modus **Nur @**                           | niemand                                                                                 | nein                          |
| Person ohne `@`, Modus **@ + Decision** (Standard)         | Pages entscheidet mit den Schwellen anhand der Wahrscheinlichkeiten des Decision-Modells | ja, genau einmal je Nachricht |
| Person ohne `@`, kein Modell eingestellt oder ausgefallen  | niemand, die Gruppe verhält sich wie **Nur @**                                          | Aufruf entfällt oder schlägt fehl |

`ConversationAgentReplies.answer()` ist die einzige Stelle der Verzweigung. Die Nachrichten, die ein Agent selbst gesendet hat, lösen weiter nur die Agents aus, die sie mit `@` nennen; eine Antwort ohne `@` fragt niemanden mehr (der Beobachter, der danach noch einmal gewählt hat, ist weg).

## Decision-Modell

- **Anbindung:** `POST https://openrouter.ai/api/alpha/decisions` mit `model`, `state` und `questions`, Schlüssel der bestehenden OpenRouter-Verbindung im Header `Authorization: Bearer …`. Es ist **nicht** der Chat-Endpunkt. Die Schnittstelle ist bei OpenRouter noch „alpha“; Pages prüft die Antwort deshalb streng und behandelt jede Abweichung als „keine gültige Antwort“. Quellen: <https://openrouter.ai/docs/guides/community/multimodal-decisions>, <https://openrouter.ai/docs/client-sdks/python/sdks/decisions/README>, <https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-decisions/references/decisions-api.md> (Stand 13.11.2026).
- **Modelle:** `GET /api/v1/models?output_modalities=decisions` (Ausgabeart „decisions“, zum Beispiel `perplexity/pplx-decider-v1.3`, `perplexity/pplx-decider-flash-v1.3`). Der Katalog-Abgleich fragt diese Liste zusätzlich zu Text, Transkription und Sprache ab; die Modelle erscheinen nur in der Auswahl der Decision-Modelle und werden von Pica, Agents und Plänen abgelehnt (Regel `decision` in `AgentModelConsumers`).
- **Zwei typisierte Fragen in einem Aufruf:**
  - `answer_expected` (`noul`, Ja/Nein): „Erwartet diese Nachricht eine Antwort eines Agents?“ → Wahrscheinlichkeit für Ja.
  - `agent_meant` (`choice`): „Welcher Agent ist gemeint?“ mit den Optionen aller verfügbaren Agents der Gruppe (Schlüssel = Benutzername) und `(niemand)` → je eine Wahrscheinlichkeit.
- **Eingabe (`state`):** Gruppenname, die Agents mit Name, Benutzername und Spezialisierung, die letzten 8 Nachrichten (höchstens 6 000 Zeichen, Zugangsdaten geschwärzt) und die neue Nachricht. Die **Spezialisierung** ist die Einleitung der `AGENT.md` plus die Liste unter „Zuständig für“/„Zuständigkeit“/„Spezialisierung“/„Schwerpunkt“ (englisch: „Responsible for“, „Specialization“, „Focus“), ohne Markup und Zugangsdaten, höchstens 400 Zeichen. Arbeitsregeln der `AGENT.md` gehören nicht dazu. Vorher wurde nur der Jobtitel übergeben.
- Zeitlimit 30 s, kein Wiederholen, Weiterleitungen verboten; geloggt werden nur HTTP-Status und Ausgang, nie Text, Schlüssel oder Fehlerkörper.

## Schwellen (Pages entscheidet, nicht das Modell)

| Schwelle                    | Standard | Bedeutung                                                                                       |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Antwort-Schwelle            | 60 %     | Darunter antwortet niemand.                                                                     |
| Zuständigkeits-Schwelle     | 50 %     | Der wahrscheinlichste Agent antwortet ab hier.                                                  |
| Zweit-Schwelle              | 40 %     | Weitere Agents antworten ab hier, solange die Höchstzahl es erlaubt.                            |
| Höchstzahl Antwortende      | 2        | Bereich 1 bis 3 (gleich der Grenze automatischer Antworten je Runde).                           |

Niemand antwortet außerdem, wenn „niemand“ mindestens so wahrscheinlich ist wie der beste Agent (bei Gleichstand gewinnt „niemand“). Alle Vergleiche gelten einschließlich der Schwelle (`≥`). Die Entscheidung ist `settleDecision()` in `ConversationDecisionOutcome.ts`.

## Einstellungen

- **Instanzweit (Einstellungen → Agents, Karte „Entscheidungen in Chats“):** das Decision-Modell (nur die OpenRouter-Decision-Modelle) und die Standardwerte der vier Regler. Speichern nur Administratoren im Admin-Modus. Tabelle `chat_decision_settings`.
- **Je Gruppe (Gruppen-Menü → „Wer antwortet? …“, der Eintrag nennt den Modus):** Popup mit den Reitern **Antworten** (Modus „Nur @“ / „@ + Decision“ mit Erklärung, das Modell der Instanz, vier Regler, bei „Nur @“ aus, „Auf Standard zurücksetzen“) und **Letzte Entscheidungen** (Zeit, Nachricht, „Antwort erwartet“, Verteilung, Ergebnis, auch „keine Antwort“ und @-Ansprachen; 30 Einträge). Alle Mitglieder lesen, ändern dürfen nur die Gruppenverwalter (wer die Gruppe angelegt hat). Ohne eigene Werte folgt die Gruppe den Standardwerten der Instanz. Tabelle `conversation_reply_settings`, Schnittstelle `PUT /api/mcp/v1/conversations/{id}/reply-settings` mit `mode`, den drei Schwellen, `maximumResponders` oder `useDefaults`.
- Der Standard-Antwortende der Gruppe entfällt: ohne nutzbares Modell gilt „Nur @“.

## Ausfall

Kein Modell eingestellt, nicht mehr im Katalog, Schlüssel fehlt, Aufruf fehlgeschlagen, Zeitlimit oder ungültige Antwort: niemand antwortet, die Entscheidung wird als `unavailable` mit `no_model` oder `model_failed` gespeichert, und in der Gruppe erscheint **keine** Systemzeile. Gruppenverwalter sehen im Popup einen Hinweis („Kein Decision-Modell eingestellt …“, „… nicht mehr verfügbar“, „… zuletzt nicht erreichbar“); der Hinweis erscheint nur im Modus „@ + Decision“.

## Nachvollziehbar

- Jede Entscheidung wird einmal je Nachricht in `conversation_reply_decisions` gespeichert: Ergebnis (`responders`, `nobody`, `mention`, `unavailable`), Modell (genauer Stand, den OpenRouter meldet), „Antwort erwartet“, Wahrscheinlichkeiten je Agent und für niemand. @-Ansprachen von Personen werden im Modus „@ + Decision“ mit Ergebnis `mention` festgehalten.
- Im Chat zeigt jede **Antwort**, die das Decision-Modell ausgelöst hat, ein **„Warum?“**: „Antwort erwartet 82 % · Ed 78 %, Mei 15 %, niemand 7 %“ und das Modell. Entscheidet sich niemand zu antworten, steht unter der Personen-Nachricht für alle Mitglieder die dezente Zeile **„keine Antwort · niemand 91 %“**; ein Klick zeigt die Wahrscheinlichkeiten. Bei Nachrichten mit `@`, bei Agenten-Nachrichten, im Modus „Nur @“ und bei einem ausgefallenen Modell gibt es keine Zeile.

## Bestehende Gruppen (Migration `060_group_decision_rules.sql`)

| Vorher                              | Nachher                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `observer` oder `decision`          | `decision` („@ + Decision“)                                          |
| `mentions`                          | `mentions` („Nur @“)                                                 |
| Gruppe ohne gespeicherte Einstellung | Standard `decision`                                                 |
| Höchstzahl 2 (alter Standard)       | ohne eigenen Wert, folgt der Instanz                                 |
| Standard-Antwortender               | entfällt                                                             |
| Modell der Instanz (Chat-Modell)    | geleert, weil nur ein Decision-Modell passt; bis zur Wahl gilt „Nur @“ |
| gespeicherte Entscheidungen         | `default`/`notice` werden `responders`/`nobody`/`unavailable`        |

Die Migration wurde auf einem Wegwerf-PostgreSQL 18 (Migrationen 001 bis 059, Altzeilen, dann 060) geprüft; dabei fiel die falsche Reihenfolge von Constraint und Datenumschreibung auf, die behoben ist. Die neuen Abfragen der Repositories liefen gegen dasselbe Schema.

## Entscheidungen und offene Punkte

- Eine Nachricht, die nur Menschen mit `@` nennt, gilt als direkt angesprochen: kein Aufruf, keine Systemzeile.
- Bei Gleichstand von „niemand“ und bestem Agent antwortet niemand.
- Der Beobachter-Code für die Agent-Auswahl (`ConversationObserverRouting.choose`, Routing-Prompt und -Antwortleser) wird nicht mehr aufgerufen; Gruppenkontext und Zusammenfassungen nutzen den Beobachter weiter. Das Entfernen des ungenutzten Routings ist ein eigener Aufräumschritt.
- `docs/wiki/PAGE-317.md` beschreibt den Stand davor.
