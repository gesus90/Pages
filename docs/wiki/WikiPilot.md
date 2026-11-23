# Pilot des Wiki-Aufräumens: Wiki

Stand: **22.11.2026**. Der Pilot bearbeitet die Wiki-Seiten „Wiki und Editor“
und „Wiki: Festlegungen“ nach der Seitenvorlage. Die übrigen Bereiche folgen
erst nach der Abnahme des Piloten, anhand der Zuordnungsliste in
[WikiBestandsaufnahme.md](WikiBestandsaufnahme.md). Pflegeregeln stehen in
[WikiPflege.md](WikiPflege.md).

## Ergebnis

| Seite      | Adresse                                      | Vorher               | Nachher                                                                                  |
| ---------- | -------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Hauptseite | `/wiki/328231ba-412b-4bb8-b05b-0bf8580595b8` | „Wiki und Editor“    | „Wiki“, Status Gültig, Stand 22.11.2026, nach Vorlage gegliedert                         |
| Wegweiser  | `/wiki/03215cd3-4112-4526-8a03-279cfd515baf` | „Wiki: Festlegungen“ | Titel unverändert, Status Überholt, kurze Tabelle „früherer Abschnitt → neuer Ort“       |
| Protokoll  | `/wiki/75f267e9-86ad-4f40-a140-efed191276f4` | neu                  | „Entscheidungen“ unter „Pages“, Status Entwurf, Wiki-Entscheidungen mit Datum und Quelle |

Beide bestehenden Seiten behalten ihre Seiten-ID; die neue Seite „Entscheidungen“
ist der Bereichsknoten, den die Vorlage verlangt.

## Was auf der Hauptseite steht

- Aufbau nach Vorlage: Statuszeile, Zeile mit Stand und Quelle, „Auf einen Blick“
  (drei Sätze), dann „Zweck“, „Aufbau“, „Festlegungen“ (nummeriert),
  „Zustände und Sonderfälle“, „Offene Punkte“. Die erste Überschrift
  wiederholt den Titel nicht.
- Die Bedienbeschreibung beider Seiten steht nur noch einmal unter „Aufbau“. Die
  Regeln stehen unter „Festlegungen“, die vier datierten Entscheidungen
  (2026-10-05 zweimal, 2026-10-07, 2026-11-11) mit Datum und Herkunft ebenfalls
  dort und im Protokoll „Entscheidungen“.

## Korrekturen gegen den Code

Die Korrekturen stammen aus der Bestandsaufnahme und wurden gegen den Code-Stand
`99429fa3` geprüft:

| Aussage vorher                                                                                | Aussage nachher                                                                                              | Beleg                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Kürzel „Alt + 0–3“                                                                            | Strg/Cmd + Alt + 0–3; Strg/Cmd + Alt + C für den Codeblock ergänzt                                           | `app/lib/editor/editor-shortcuts.ts`                                                                       |
| Löschdialog verlangt „LÖSCHEN“ / „DELETE“                                                     | kein Bestätigungswort; MCP prüft `confirmed=true`                                                            | `app/components/wiki/wiki-page-dialogs.tsx`, `language/locales/de/translation.json` (`wiki.dialog.delete`) |
| Verweise auf nicht sichtbare Ziele ausgegraut, Kurzinfo „Dieser Verweis ist nicht verfügbar.“ | belegt nur für Ticket-Verweise; für Wiki-Seitenverweise als offener Punkt geführt                            | `app/components/editor/extensions/ticket-links.ts`, `wiki.ticketLink.unavailable`                          |
| Import „bewusst später“                                                                       | datierte Entscheidung bleibt; Stand ergänzt: agentischer Wiki-Import vorhanden, Archivieren und Export nicht | `backend/service/agents/WikiImportService.ts`                                                              |
| „Lesemodus“ beim Kommentieren                                                                 | gestrichen; Lesende sehen denselben Aufbau ohne Bearbeitung                                                  | Seite kennt keinen Lese- oder Bearbeiten-Modus                                                             |

## Prüfung von Verweisen, Adressen und Anhängen

- **Adressen:** Beide Seiten behalten ihre Seiten-ID. Eine alte Endung
  `/wiki/<id>/<slug>` wird auf den aktuellen Titel umgeleitet
  (`app/routes/wiki-page-server.ts`); die Umbenennung der Hauptseite bricht
  keine Adresse.
- **Eingehende Verweise:** Auf die Hauptseite zeigen Frontend, Architektur und
  Datenmodell, Ergänzungen und Herkunft der Festlegungen, Wiki/Suche/Sichtbarkeit
  (technische Umsetzung), der Wegweiser, die Bestandsaufnahme und die Befunde der
  Wiki-Pflege. Auf den Wegweiser zeigen zusätzlich Benutzerverwaltung:
  Festlegungen und das Produktkonzept. Nach der Änderung lesen
  `read_wiki_links` alle früheren eingehenden Verweise unverändert (Hauptseite
  8 eingehend, Wegweiser 9 eingehend).
- **Ausgehende Verweise:** Alle Verweise der neuen Texte lösen auf bestehende
  Seiten auf (Hauptseite 5, Wegweiser 9, Protokoll 2).
- **Anhänge und Cover:** Beide Seiten hatten keine Anhänge und kein Cover; es
  gibt nichts umzuhängen.
- **Tickets und Pläne:** Die Bestandsaufnahme erfasst keine Ticket-Verweise auf
  diese beiden Seiten (`incomingTickets` leer).

## Offen für die Abnahme

- Die Linktexte „Wiki und Editor“ auf den verweisenden Seiten zeigen weiter auf
  die richtige Adresse, tragen aber noch den alten Namen. Sie werden beim
  Aufräumen des jeweiligen Bereichs angepasst, ebenso die Verweise auf den
  Wegweiser.
- Die Seiten stehen noch unter „Frontend“. Die Bereiche Produkt, Bedienung,
  Design und Technik werden erst nach der Abnahme des Piloten angelegt; bis
  dahin gilt die Struktur als Vorschlag.
- Die Herkunft (Ticket oder Chat) der vier Wiki-Entscheidungen ist im Wiki nicht
  dokumentiert und ist im Protokoll als offen vermerkt.
- Papierkorb: Der Pilot schlägt keine Seite für den Papierkorb vor. Der
  Wegweiser kommt erst in Frage, wenn seine eingehenden Verweise umgestellt sind,
  und nur mit Zustimmung des Auftraggebers.
- Die weiteren Bereiche werden erst nach der Pilotabnahme bearbeitet.
