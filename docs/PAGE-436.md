# PAGE-436: Planrevisionen und Zugriffsansichten

## Behobene Ursachen

`usePlanDraft` initialisierte Entwurf und Vergleichsstand nur beim Mount und
übernahm danach ausschließlich eigene Save-/Play-Bestätigungen. Eine erfolgreiche
Loader-Revalidierung konnte deshalb einen aktuellen Browsercache neben einem alten
Graphen hinterlassen. Der Hook übernimmt jetzt neuere autorisierte Revisionen in
beide Stände, solange der Entwurf unverändert ist. Es gibt keinen Revision-Key und
keinen dadurch ausgelösten Remount.

Geänderte Entwürfe behalten ihre ursprüngliche Revision. Eine dauerhafte Meldung
benennt die eingegangene Revision; ihre Übernahme verlangt eine ausdrückliche
Verwerfentscheidung. Abbruch erhält den Entwurf. Laufende Ziehbewegungen und noch
nicht angewandte Felder eines Knotendialogs verzögern die automatische Übernahme.
Rechte- und Einstellungsdialoge aktualisieren unveränderte Felder; geänderte Felder
behalten ihren Vergleichsstand und senden dessen Revision, damit ein späteres
Speichern einen Konflikt erkennt, statt neuere Einstellungen zu überschreiben.

Im Live-Vertrag fehlte außerdem eine Planbenachrichtigung. Graph-, Besitzer- und
Teamänderungen sowie reguläre und Einmal-Plan-Löschungen schreiben jetzt
`plan.catalog.changed` in ihrer Transaktion in die bestehende Outbox und den
PostgreSQL-Live-Kanal. Die Benachrichtigung nennt nur `catalog`, keine private
Plan-ID und keinen Inhalt. Sie erreicht auch Personen, deren Rechte gerade
entzogen wurden. Die vorhandene Bündelung revalidiert die Planseite mit Katalog,
Rechten und Graph; zusätzliches dauerhaftes Graph-Polling wurde nicht eingeführt.
API-Hub und pages-core verwenden denselben erweiterten Vertrag.

Planbenachrichtigungen, Resynchronisierung und bestätigte Ablehnungen verwerfen
gespeicherte Planantworten einschließlich ihrer URL-Aliase. Die nicht verfügbare
Auswahl bietet eine erneute autorisierte Prüfung derselben URL. Kein Ersatzplan
wird geöffnet. Freigaben können diese Ansicht über den Live-Kanal wiederherstellen.

## Diagnose und unveränderte Zugriffsregeln

`AgentPlanReadDenied` erhält intern den Ursprung einer Ablehnung: fehlender Plan,
Freigabeentscheidung, Workspace-/Projektzugriff oder den betroffenen Abschnitt
des Seitenaufbaus, einschließlich der Quellen. Die öffentliche Antwort bleibt
für fehlende und nicht lesbare Pläne identisch.

`agent_plan.access.denied` protokolliert den aktuellen Kanal, Kontomodus und die
Rollenentscheidung. Die Loader-Warnung benennt Ursprung und Grund im Component-
Feld, etwa `AgentPlansLoader.plan_access.sharing_denied`. Beide verwenden den
vorhandenen Logging-Kontext. Fehlt dessen Korrelation, verwendet die Loader-
Warnung eine validierte Request-Korrelation oder eine pro Anfrage erzeugte UUID.
Planname, Graph, angefragte private Plan-ID und Zugangsdaten werden nicht geloggt.

Normaler Rollenmodus, aktiver UI-Admin-Modus und MCP behalten ihre bisherigen
Regeln. Insbesondere ersetzt ein im UI ausgeschalteter Admin-Modus keinen
MCP-Administratorentscheid und umgekehrt. Workspace-/Projektregeln und die
Sonderregel für Agentkonten bleiben bestehen.

**Weiterhin unbelegt:** Der historische Auslöser des ersten „Plan nicht
verfügbar“ und eine ursächliche Rolle eines Besitzerwechsels. Die ergänzende
Analyse vom 15.11.2026 prüfte diesen Wechsel mit UI-Admin- und MCP-Adminrechten;
sie belegt kein Verhalten im normalen Rollenmodus. Dieses Ticket behebt die
nachgewiesene Entwurfs- und Aktualisierungslücke, keine vermutete Zugriffspolitik.
Es gab keine erneute Prüfung oder Änderung produktiver Konten oder Pläne.

## Lokale Funktionsbeobachtungen am 15.11.2026

Isolierte Vite-Instanz auf Loopback mit eigener PostgreSQL-Datenbank, synthetischen
Konten und bestehenden Browser-Setup-Funktionen. Die private `.pages`-Umgebung
war per Mount-Namespace von der echten Installation getrennt. Keine neuen Tests,
Fixtures, Mocks oder Harness-Dateien. Entwicklungs-Zwischenstände nach Hot Reload
wurden verworfen; die maßgebliche Beobachtung erfolgte nach frischer Einrichtung
mit dem aktuellen Quellstand. Es wurde kein Plan gestartet.

Diagnoseplan: `1d4ca4ff-a617-407a-93c6-8a04e6889479`.

| Beobachtung | Ergebnis |
| --- | --- |
| Zwei leere Browserseiten; Tab A fügt `access_probe` hinzu und speichert | Tab B zeigt die Karte automatisch. Server, IndexedDB und gerenderte Entwurfsprops: Revision 2, eine Karte. Null Läufe. |
| Tab B öffnet und schließt regulär den Verlauf | Karte bleibt sichtbar; Dokumentmarker `final-document` bleibt erhalten. |
| B schreibt ungespeichert `local_B`, A speichert `remote_A` als Revision 3 | B zeigt den Revisionshinweis und behält `local_B`. Auch Abbruch der Übernahme erhält den Wert. Erst bestätigte Übernahme zeigt `remote_A`; Dokumentmarker bleibt erhalten. |
| Besitzerwechsel bei bereits geöffnetem Rechte-Dialog in B | Nach Live-Revalidierung zeigt derselbe Dialog `Rita Reader`, der Admin-Badge erscheint; Dokumentmarker bleibt erhalten. |
| Lesefreigabe an normalen Leser, Revision 6 | Plan sichtbar, `canRead=true`, `canEdit=false`. |
| Entzug, Revision 7 | „Plan not available“, keine Parameterkarte, null Planinhalte im Cache; Dokumentmarker `final-reader-document` bleibt erhalten. |
| Erneute Prüfung während der Ablehnung | Ansicht bleibt gesperrt. |
| Erneute Freigabe, Revision 8 | Derselbe Plan erscheint ohne Dokumentnavigation oder neue Anmeldung. |
| Tatsächlich fehlende Plan-ID bei einem Leser mit einem anderen lesbaren Plan | HTTP 200, `requestedMissing`, `selected=null`, Katalog enthält den lesbaren Plan; kein Ersatz wird ausgewählt. |
| Interne Diagnose | `sharing_denied` mit Korrelation `page436-cold-denial`; `plan_missing` mit `page436-missing-plan`. |
| PostgreSQL-Abschlussbeobachtung | Revision 9, eine Karte, insgesamt null Planläufe; Outbox enthält `plan.catalog.changed` mit Objekt `catalog`. |

Lokale Bild-/Logbelege bleiben außerhalb des Quellbaums unter
`~/.pages/tmp/page-436/`: `final-two-tabs-current.png`, `final-conflict.png`,
`final-denied.png`, `final-access-diagnostics.jsonl`.

## Vorhandene gezielte Funktionstests

Ausgeführt mit `NODE_ENV=test pnpm exec vitest run --config <scope-config>
--coverage.enabled=false <ausgewählte Dateien>`:

- **Frontend: 12 Dateien, 70 Tests bestanden.** Entwurf, Save-Queue,
  Positionen während des Speicherns, Konfliktdialog, Live-Bündelung,
  Einstellungsdialoge, Canvas, atomare Editoränderungen, Lauf-Polling,
  Laufauswahl und Bedienung des Planpanels.
- **Backend: 7 Dateien, 98 Tests bestanden.** Planloader/-aktionen,
  Servicelesen, Katalog-/Workspacezugriff, Teamrechte einschließlich getrenntem
  UI-Rollenmodus/UI-Admin/MCP, Live-Kanal und Logging-Einstellungen.

Konkret verwendete Dateien: Frontend `use-plan-draft`,
`plan-revision-conflict`, `use-plan-save-position`, `use-plan-submission`,
`live-changes`, `page330-dialogs`, `plan-canvas`, `use-plan-editor-atomic`,
`use-plan-control`, `use-plan-run`, `plan-panel-controls`,
`plan-run-panel-collapsed`; Backend `agent-plans` und `agent-plans-actions`
unter `app/routes`, `agent-plan-service-reads`, `plan-access-summaries`,
`plan-teams`, `live-change-calendar`, `settings-logging-action`.

Die Anzeigeeffekte ändern ausschließlich Editor-/Cachezustand. Start-, Pause-,
Resume- und Stop-Kommandos sowie Runner wurden nicht geändert. Die vorhandenen
Lauf-/Steuerungstests sind grün; reale laufende oder pausierte Arbeitspläne wurden
für diese Sichtbarkeitsprüfung ausdrücklich nicht gestartet oder bedient.
MCP wurde an der bestehenden Policy-Grenze geprüft, ohne MCP-Prozess/-Transport.

Lint, Check, Typecheck, Build, vollständige Suites und Coverage:
**an die Abschluss-QA übergeben**. Kein Deployment, Push, Rebase oder Branchwechsel.
