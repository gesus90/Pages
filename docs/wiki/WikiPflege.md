# Pflege des Pages-Wikis

Stand: **22.11.2026**. Verantwortlich für Bestand, Redaktion und laufende Pflege
des Pages-Wikis ist **Conan**.

Die verbindlichen Pflegeregeln stehen im Pages-Wiki auf der Hauptseite
[Dokumentation und Arbeitsweise](/wiki/bc146b7f-2763-4c17-bdb1-36a152a57231),
Abschnitt „Laufende Pflege des Wikis“. Offene Befunde stehen auf
[Befunde der Wiki-Pflege](/wiki/c9632954-e9ca-44fc-a7e4-0c440c80a063). Beide
Adressen erfordern Zugriff auf die Pages-Instanz. Diese Datei ist der Einstieg
aus dem Repository und wiederholt die Regeln nur so weit, wie Code-Änderungen
sie auslösen.

## Was eine Code-Änderung auslöst

1. Ändert eine abgeschlossene Änderung dokumentiertes Verhalten (sichtbare
   Abläufe, Schnittstellen und Werkzeuge, Konfiguration, Betrieb, Datenmodell
   oder festgelegte Regeln), nennt der Umsetzende in Bericht oder Abnahme die
   betroffenen Wiki-Seiten, soweit bekannt (`AGENTS.md`, Abschnitt 12).
2. Conan prüft diese Seiten gegen den belegten Stand: Code, Migrationen,
   Konfiguration, Repository-Dokumentation und datierte Entscheidungen. Die
   Aufgabenbeschreibung allein ist kein Beleg.
3. Bei Bedarf wird die Seite nachgezogen: Inhalt korrigieren, Kopfzeile mit
   Status, Stand und Quellen anpassen, abgelöste datierte Entscheidungen als
   abgelöst kennzeichnen statt löschen, danach Inhalt und Verweise nachlesen.
   Was nicht sofort nachgezogen wird, kommt in die Befundliste.
4. Neue Inhalte kommen zuerst auf eine bestehende Hauptseite. Eine neue Seite
   entsteht nur, wenn kein Thema passt.

Quellen im Wiki sind Repository-Dateien, Code-Stände und datierte
Entscheidungen mit Herkunft. Ticket-Schlüssel und interne Planungsnummern
werden nicht genannt (`AGENTS.md`, Abschnitt 15).

## Regelmäßige Durchsicht

Alle zwei Wochen montags, höchstens 30 Minuten, durch Conan. Nächster Termin:
07.12.2026. Einmal im Quartal werden alle Seiten vollständig geprüft. So wird
geprüft:

| Prüfung                       | Vorgehen                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Offene Befunde                | Befundliste durchgehen, erledigte nachprüfen und mit Datum schließen.                                                                           |
| Nicht nachgezogene Änderungen | Abgenommene Aufgaben und `git log main` seit der letzten Durchsicht sichten, betroffene Seiten über die Wiki-Suche finden.                      |
| Kaputte Wiki-Verweise         | Alle Seiten mit `read_wiki_tree` auflisten, Seiten mit `read_wiki_page` lesen, jede Adresse `/wiki/<id>` gegen die Liste der Seiten-IDs prüfen. |
| Fehlende Repository-Dateien   | Pfade in Backticks gegen eine aktuelle Arbeitskopie prüfen (`test -e`); Laufzeitpfade unter `~/.pages/` und Platzhalter ausnehmen.              |
| Stand und Quellen             | Kopfzeile jeder Hauptseite mit Festlegungen oder Ist-Aussagen prüfen. Gliederungsseiten ohne eigene Aussagen brauchen keine.                    |

Das Ergebnis steht als Zeile unter „Durchsichten“ in der Befundliste.

## Erste Prüfung und Beleg des Ablaufs

Am 22.11.2026 wurden alle 93 Seiten des Projekt-Wikis geprüft (Code-Stand
`2db46dc2`): kein kaputter Wiki-Verweis, 22 Verweise auf nicht mehr vorhandene
Repository-Dateien auf 9 Seiten, 8 als veraltet bewertete Seiten, 64 Seiten
ohne Stand und Hauptseiten ohne Quellen. Alle Befunde stehen in der
Befundliste.

Der Ablauf ist an einer tatsächlichen Änderung belegt: Seit 16.11.2026
verlangt `vitest.backend.config.ts` 100 % Abdeckung je Datei, der Workflow
`.github/workflows/backend-tests.yml` führt `pnpm run test:backend` bei Push auf
`main` aus, und am 22.11.2026 wurde die vollständige Backend-Abdeckung
wiederhergestellt (Commit `99429fa3`). Die Wiki-Suche nach „Coverage“ und
„test:backend“ fand sechs Fachseiten. Vier davon (Dokumentation und
Arbeitsweise, Unit-Tests: Struktur, Scopes und Coverage, Technische
Dokumentation, Integrationen: GitHub, CI und Releases) beschrieben noch
„Coverage ohne Mindestquote“ und „keine Testausführung“. Sie wurden
nachgezogen und haben Stand und Quellen erhalten. Die beiden übrigen Seiten
waren nicht betroffen oder sind als Befund erfasst. Das Protokoll steht unter
„Pflegeprotokoll“ auf Dokumentation und Arbeitsweise.
