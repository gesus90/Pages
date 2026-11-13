# PAGE-319 Wiki-Aufteilung zur Übernahme

**Stand: lokal vorbereitet, nicht im Wiki umgesetzt.** Der Lauf darf keine Live-Dienste oder Live-Daten ändern. Die im Ticket verlangten Wiki-Schreibzugriffe fallen unter dieses Verbot. Der Entwurf ist daher kein Abschluss von PAGE-319; T1 bis T4 bleiben im Ticket offen. Der Ticketstatus bleibt „In Arbeit“, bis die tatsächliche Umsetzung abgeschlossen ist. Eine Entscheidung zur Freigabe der Wiki-Übernahme ist erforderlich.

## Inhalt und Ziele

Die [Übersicht](PAGE-319/index.md) führt zu acht thematischen Entwürfen und zum Entwurf für die bereits vorhandene Unterseite zum Entscheidungsmodell. Alle Originalaussagen einschließlich früherer Entscheidungen, Datumsangaben und offener Punkte sind erhalten. Die Themen Remote/Runner und Laufsteuerung haben eigene Seiten, damit Arbeitsplätze und Agent-Plan übersichtlich bleiben.

Die [Zuordnung](PAGE-319/manifest.json) nennt Zielnamen, Elternseite, bestehende Seitenkennungen, Quellrevisionen und die Position jedes unverändert übernommenen Textfragments. Neue Wiki-Kennungen wurden nicht erfunden. Die relativen Markdown-Links dienen ausschließlich der lokalen Prüfung; vor einer Wiki-Übernahme müssen sie durch die tatsächlich zurückgegebenen Seitenkennungen ersetzt werden.

Die Hauptseite behält bei der Übernahme ihre Kennung `93eb063a-a63c-4cac-8393-af182291a582`. Die Unterseite zum Entscheidungsmodell behält `d645e528-e900-4673-9de1-4d817173ccf1`. Alle acht neuen Themen werden Kinder der Hauptseite. Die vorhandene Unterseite wird aktualisiert, nicht dupliziert. Ihre Inhalte wurden ebenfalls vollständig erhalten.

## Nachweis der lokalen Vorbereitung

| Todo | Lokaler Nachweis | Noch offen im Wiki |
| --- | --- | --- |
| T1 | Alle 42.794 Zeichen der Hauptseite, Revision 23, und alle 2.285 Zeichen der bestehenden Unterseite, Revision 1, aus den Zielfragmenten rekonstruiert und exakt mit den Ergebnissen von `read_wiki_page` verglichen. | Zielseiten anlegen beziehungsweise ersetzen und vollständig zurücklesen. |
| T2 | Alle zehn Seiten unter 20.000 Zeichen, auch nach UTF-16-Zählung. Größte Seite: 11.282 Zeichen. | Größen der tatsächlich gespeicherten Seiten nach Linkersetzung prüfen. |
| T3 | Übersicht verlinkt alle neun Unterseiten; jede Unterseite verlinkt zurück; alle lokalen Markdown-Ziele existieren. | Echte Wiki-Seitenkennungen einsetzen und Verknüpfungen zurücklesen. |
| T4 | Jede Unterseite enthält getrennte Abschnitte „Umgesetzt“, „Entschieden“ und „Offen“. Ausdrücklich umgesetzte Aussagen wurden getrennt; offene Bestätigungen stehen unter „Offen“. | Historisch nicht eindeutig ausgewiesene Umsetzungsstände bestätigen und die Struktur im Wiki speichern. |

| Datei | Zeichen (UTF-16) |
| --- | --- |
| [index.md](PAGE-319/index.md) | 1.601 |
| [anbindungen.md](PAGE-319/anbindungen.md) | 5.474 |
| [modell-reasoning.md](PAGE-319/modell-reasoning.md) | 3.438 |
| [agent-verwaltung-editor.md](PAGE-319/agent-verwaltung-editor.md) | 7.290 |
| [arbeitsplaetze.md](PAGE-319/arbeitsplaetze.md) | 4.572 |
| [remote-runner.md](PAGE-319/remote-runner.md) | 6.462 |
| [agent-plan.md](PAGE-319/agent-plan.md) | 11.282 |
| [laufsteuerung.md](PAGE-319/laufsteuerung.md) | 6.832 |
| [gedaechtnis.md](PAGE-319/gedaechtnis.md) | 1.136 |
| [entscheidungsmodell.md](PAGE-319/entscheidungsmodell.md) | 2.637 |

Quellnachweise (SHA-256 über UTF-8, vor der Aufteilung):

- Hauptseite, Revision 23: `9daa6254e61617a2d3f21b14eba8bf746d8f636648fd05fc398dd545a434e741`.
- Entscheidungsmodell, Revision 1: `42e577dae6da476469cd58482b07a660f9c8ba8f885d36f25480b4d737174e81`.

Die Positionen im Manifest sind nullbasiert in UTF-16-Codeeinheiten, das Ende ist exklusiv. Pro Quelle die Fragmente nach `start` sortieren, aus der angegebenen Zieldatei `[targetStart, targetEnd)` lesen und verketten: Das ergibt genau den ursprünglichen Seiteninhalt mit dem angegebenen SHA-256. Die Quellintervalle sind lückenlos und überlappen sich nicht. Neue Einleitungen, Verknüpfungen und Statushinweise gehören nicht zu diesen Originalfragmenten.

## Funktionale Dokumentprüfung

Einmalige lokale Node-Assertions erfolgreich ausgeführt: lückenlose Rekonstruktion beider Quellen, zeichengetreuer Abgleich mit beiden Pages-Leseergebnissen, Größen aller zehn Seiten, neun Links aus der Übersicht, neun Rückverweise, Existenz aller lokalen Markdown-Ziele und drei Statusabschnitte je Unterseite. Keine externen Schreibzugriffe, kein Modell und keine Datenbank gestartet. Keine Unit-Tests ergänzt oder ausgeführt, weil kein Produktverhalten und kein Quellcode geändert wurden.

Lint, Check, Typecheck, Build, Formatprüfung, komplette Testsuiten und Coverage wurden gemäß Laufvorgabe nicht ausgeführt: **an die Abschluss-QA übergeben**. Es gibt dafür keine offenen technischen Todos dieses Tickets.

## Übernahme nach gesonderter Freigabe

1. Beide Quellseiten erneut über Pages lesen. Stimmen Revisionen oder rekonstruierte Quelltexte nicht mehr, den Entwurf mit den neueren Inhalten abgleichen; nichts überschreiben oder verwerfen.
2. Acht neue Themenunterseiten unter der bestehenden Hauptseite über Pages anlegen. Die zurückgegebenen Kennungen festhalten. Bestehende Unterseite zum Entscheidungsmodell nicht neu anlegen.
3. Alle relativen Links der zehn Entwürfe durch echte `/wiki/<id>`-Links ersetzen. Die Verweise auf externe Wiki-Seiten aus dem Original bleiben erhalten. Die bereits existierende Hauptseite zuletzt mit aktueller Revisionsprüfung ersetzen; ihren Titel, Ort, ihre Kennung und sonstige Metadaten erhalten.
4. Nicht eindeutig ausgewiesene Umsetzungsstände anhand bestätigter Nachweise einordnen. Historische Aussagen nicht als neu ausgeliefert ausgeben. Die vorhandenen Originaltexte und datierten Präzisierungen erhalten. Neuere lokale Wiki-Entwürfe anderer Tickets sind nicht Teil der gelesenen Quellrevision und werden hier nicht stillschweigend eingearbeitet.
5. Alle Seiten und ihre Verknüpfungen zurücklesen. Zeichenlimits erneut prüfen. Eingehende Verweise kontrollieren, insbesondere etwaige Abschnittsziele. Allgemeine Verweise behalten die unveränderte Hauptseitenkennung. Fachlich engere Verweise können mit aktueller Revision auf die passende Unterseite gesetzt werden.
6. Erst nach diesen Nachweisen T1 bis T4 abhaken und nach abgeschlossener Umsetzung und lokalem Commit auf Review setzen.

Die Ticket-Voraussetzung einer größeren Schreibgrenze ist nicht der Blocker: Der aktuelle lokale Vertrag erlaubt `wikiContentBytes = 1_048_576` in `definition/PagesAgentOperations.ts`; `AgentWikiFieldValidation.ts` validiert diese Bytegrenze. Der alleinige Ausführungsblocker ist das ausdrückliche Verbot von Live-Datenänderungen dieses Laufs.

## Bereits gelesene eingehende Verweise

`read_wiki_links` lieferte 16 sichtbare eingehende Verweise ohne weitere Ergebnisseite. Diese Seiten wurden nicht verändert; die Titel allein sind keine Grundlage für eine automatische Textänderung.

- [Agent Plan: Verbindliche Ticketauswahl-Referenz mit Suche, Phasen und Sortierung](/wiki/08d76d5e-d795-442d-b322-9f35e2181d24)
- [Agent-Dateien und Dreaming-Agent: technische Festlegungen](/wiki/129e8279-37b9-49b1-8a6d-fc6cd10b76cf)
- [Einstellungen und Verwaltung](/wiki/2839df7f-a2ad-4c9e-936c-f3bd1949215a)
- [Zentrale Agent-Verwaltung und Zuweisungen: technische Festlegungen](/wiki/2ce348a3-0793-4256-a893-43ff601a9231)
- [Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440)
- [Frontend](/wiki/3dc864cf-57af-47cc-8cad-79c1627372a7)
- [Assistenten](/wiki/4fd03334-b147-4fc5-b260-60c8a4bf2a19)
- [Pages-Schnittstelle und MCP: technische Umsetzung](/wiki/6d5a37ed-6ab1-4c4e-8962-96b7f1224b5b)
- [Rechte, Rollen und Modi: Festlegungen](/wiki/6d9ac5a3-3645-46fb-86f4-a75c48ce87fe)
- [AI-Anbindungen, Modellkatalog und Reasoning: technische Umsetzung](/wiki/8b665fab-daef-44ae-8189-15ebbf171a53)
- [Produktkonzept](/wiki/98906a63-6435-48e5-b0b3-465ebb926754)
- [Ergänzungen und Herkunft der Festlegungen](/wiki/d1e6ade3-73b9-4eb0-b9f9-d95d67a6cc60)
- [Entscheidungsmodell für Chats: Festlegungen](/wiki/d645e528-e900-4673-9de1-4d817173ccf1)
- [MCP-Pairing für stdio: technischer Vertrag](/wiki/d9b7a3c8-a1b3-4902-9e31-6fb0aa60fd2d)
- [Funktionsaufgaben und Auflösung der Zuweisung: technische Umsetzung](/wiki/e79ef9b3-3c6c-4866-8eae-2ffdd95ff9b6)
- [AI-Anbieter und Routing: technische Umsetzung](/wiki/fd0b40e2-07f7-48f4-85c4-620cdf812288)

