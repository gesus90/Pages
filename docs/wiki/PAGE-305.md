# PAGE-305: Wiki-Entwurf für „Agents: Festlegungen“

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Der folgende Abschnitt ersetzt den bisherigen Abschnitt zum Gedächtnis und Lernlauf (MEMORY.md, Archiv, Lernlauf alle 12 Stunden) bzw. wird nach „Agent-Chats: Sitzungen je Chat, Warteschlange und Grenzen“ eingefügt.

---

## Agent-Gedächtnis: MEMORY.md, DREAM.md, Traumlauf und Teilen über Chats (umgesetzt, 11.11.2026)

Ein Agent weiß in jedem Chat, was er in anderen Chats derselben Person erfahren hat, und wird mit der Zeit besser. Dafür hat jeder Agent zwei begrenzte Dateien und ein durchsuchbares Archiv.

**Verlauf im laufenden Chat**

- Jede Nachricht an einen Agent erhält den Verlauf und die Zusammenfassung **ihres** Chats, auch wenn die Agent-Sitzung fortgesetzt wird. Früher leerte Pages beides bei fortgesetzten Sitzungen („Bisheriger Verlauf: []“, „Zusammenfassung: null“).
- Lange Chats werden zusammengefasst: Ab 24 Nachrichten fasst Pages den älteren Teil zusammen (höchstens 4.000 Zeichen); die neuesten 10 Nachrichten bleiben wörtlich im Verlauf.

**MEMORY.md – aktuelle Themen**

- Nach jeder Antwort eines Agents in einem Chat aktualisiert Pages sofort seine MEMORY.md – ohne auf einen nächtlichen Lauf zu warten.
- Ein Eintrag je Thema in fester Form:
  - `## Titel`
  - `- Worum es geht: …`
  - `- Stand: …`
  - `- Nächster Schritt: …`
  - `- Quelle: [Chat mit Igor](chat:person/<ID>) · [PAGE-12](/tasks/PAGE-12) · [Wiki-Seite](/wiki/<ID>)`
  - `- Datum: JJJJ-MM-TT`
- Erledigte Themen wandern sofort ins Archiv.
- **Grenze:** Startwert 8.000 Zeichen, je Agent im Agent-Panel einstellbar (1.000 bis 100.000). Wird es voller, wandern die ältesten Themen mit ihrer Quelle ins Archiv; jedes Thema ist auf eine knappe feste Form begrenzt.
- Das Archiv bleibt mit `memory_search` durchsuchbar.

**DREAM.md – Lehren**

- Ein nächtlicher **Traumlauf** je Agent wertet die Chats, Unterhaltungen, Planläufe, Fehler und Rückmeldungen seit dem letzten Lauf aus und leitet Lehren ab: Vorlieben der Personen, wiederkehrende Fehler und ihre Vermeidung, effizientere Wege für häufige Aufgaben.
- Jede Lehre steht in einer Zeile mit Beleg, Datum und Stärke: `- Lehre — Beleg: … · Datum: JJJJ-MM-TT · Stärke: n`.
- **Grenze:** Startwert 4.000 Zeichen, je Agent einstellbar (500 bis 50.000). Neue Lehren werden mit ähnlichen zusammengeführt (Stärke steigt). Ist die Datei voll, fällt die schwächste, bei gleicher Stärke die älteste Lehre heraus.
- Ohne neue Inhalte startet kein Modell.
- Der Traumlauf ersetzt den früheren Lernlauf (alle 12 Stunden). Der Zeitpunkt gilt für alle Agents und steht unter **Einstellungen → Agents → Gleichzeitige Agent-Sitzungen → Traumlauf um** (Standard 03:00, Zeitzone des Servers). Im Agent-Panel lässt sich der Traumlauf je Agent ein- und ausschalten.

**In jeder Sitzung geladen**

- MEMORY.md (soweit die Regeln zum Teilen sie dem Chat erlauben) und DREAM.md sind in jeder Chat-Sitzung geladen.
- Zusätzlich holt Pages bei jeder Nachricht passende Einträge aus dem Archiv dazu, auch aus anderen Chats, jeweils mit Quelle.
- Der Agent kann selbst mit `memory_search` suchen; auch dort gelten die Regeln zum Teilen.
- Beide Dateien sind Daten, keine Anweisungen, und überstimmen nie SOUL.md, AGENT.md oder die Arbeitsweise.

**Regeln zum Teilen**

- Wissen aus einem Chat ist in jedem Chat nutzbar, an dem nur Personen teilnehmen, die auch am Ursprungschat teilnahmen – also in jedem Chat derselben Person.
- In Gruppenchats mit weiteren Personen teilt der Agent nur Wissen, das an Tickets und Wiki-Seiten hängt, die **alle** Teilnehmer sehen dürfen (geprüft mit den Rechten jeder Person).
- Ein Chat lässt sich im Chat-Kopf als **„Vertraulich“** markieren (Direktchat mit einem Agent oder Gruppe; die Markierung einer Gruppe gilt für alle Mitglieder). Aus einem vertraulichen Chat wird nichts geteilt, nichts in MEMORY.md oder das Archiv geschrieben und nichts in DREAM.md übernommen.
- Jeder Eintrag in MEMORY.md und Archiv trägt seine Quelle, damit diese Regeln geprüft werden können. Einträge ohne Quelle (von Hand oder aus der Zeit vor PAGE-305) gelten nur in Chats mit einer einzigen Person.

**Schutz und Verwaltung**

- Keine Zugangsdaten in MEMORY.md, DREAM.md oder Archiv: die bestehende Filterung zugangsdatenartiger Inhalte gilt beim Speichern.
- Im Agent-Panel der Benutzerverwaltung (Reiter „Gedächtnis“) sehen und bearbeiten Administratoren MEMORY.md und DREAM.md, stellen beide Grenzen ein und setzen jede Datei mit **Zurücksetzen** zurück. Jede Änderung (nach Antwort, Traumlauf, Bearbeiten, Zurücksetzen, Wiederherstellen) legt eine Version an; die letzten 50 Versionen lassen sich wiederherstellen.

**Modellaufrufe**

- Themen-Aktualisierung, Zusammenfassung und Traumlauf laufen in eigenen Sitzungen des Agent-Kontos mit seinem Modell (Gedächtnis-Sitzung bzw. Traum-Sitzung) und sind über eine austauschbare Abhängigkeit angebunden. In der Entwicklungs-Simulation (`PAGES_AGENT_SIMULATION=1`) beantwortet sie ein simuliertes Modell ohne Anbieter und ohne Kosten.
