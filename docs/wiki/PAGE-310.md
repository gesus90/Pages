# Wiki-Entwurf PAGE-310: Laufsteuerung (Starten, Pause, Fortsetzen, Stop)

Dieser Entwurf ist für zwei Seiten bestimmt. All Might überträgt ihn nach der Abnahme:

- [Agent-Definitionen, Arbeitsplätze und Arbeitspläne: technische Umsetzung](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440): Teil A ersetzt die beiden Sätze zu Unterbrechung und „nicht implementiert“ und wird als neuer Abschnitt angehängt.
- [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582): Teil B wird als neuer Abschnitt angehängt.

> Hinweis zum Ablauf: Im ersten Versuch dieses Laufs wurden beide Seiten vor dem Wiki-Vorbehalt dieses Tickets bereits direkt im Live-Wiki geändert (technische Seite Revisionen 13 bis 16, Festlegungen Revision 23, jeweils als Seitenversion erhalten). Der Inhalt entspricht diesem Entwurf. All Might entscheidet, ob er bleibt oder aus den Seitenversionen zurückgesetzt wird.

## Teil A: Technische Umsetzung

### Ersetzt in „Fehler, Abbruch und Unterbrechung“

Alter Satz: „**Unterbrochene Läufe** werden als fehlgeschlagen sichtbar; **unbekannte Reservierungen** bleiben konservativ zur Betreiberprüfung erhalten.“

Neu: **Unterbrochene Läufe** (Absturz, Neustart des Dienstes) werden beim Start mit den tatsächlichen Prozessen abgeglichen und als unterbrochen markiert (`failed` mit `recovery.state = interrupted`). Ihre eigenen Sitzungen und Reservierungen werden nach bestätigtem Prozessende automatisch freigegeben; nur ein Prozess, dessen Ende nicht bestätigt werden kann, hält die Reservierung weiter. Der Lauf ist danach mit **Fortsetzen** fortsetzbar.

### Ersetzt in „Offen und nicht implementiert“

Alter Satz: „**Nicht implementiert (Information):** Retry/Resume, Bedingungen und die **automatische Freigabe** unbekannter Reservierungen.“

Neu: **Umgesetzt seit PAGE-310 (Information):** Retry/Resume und die **automatische Freigabe** eigener Reservierungen nach bestätigtem Prozessende; ein Klick auf Fortsetzen setzt jeden fortsetzbaren Zustand fort. **Weiterhin nicht implementiert:** Bedingungen als eigener Knotentyp, die Fortsetzung von Plänen mit Decision oder Ereignis-Eingang (nur Neustart von vorn, Grund `branching_unsupported`) und die Freigabe von Reservierungen, deren Prozessende nicht bestätigt werden kann.

### Neuer Abschnitt: Laufsteuerung: Zustandsmodell, Fortsetzen und Freigabe nach Absturz (PAGE-310)

`read_plan_control` und die Oberfläche lesen dasselbe `AgentPlanControl`. Neben `status` und `canResume` liefert es `resumeKind` (der fortsetzbare Zustand) und, solange Fortsetzen gesperrt ist, `resumeBlock` mit Grund und Handlung. Bedienende unterscheiden nicht zwischen Resume, Recovery und Continue: der mittlere Button heißt **Fortsetzen**, der Server wählt den Weg.

| Zustand (`resumeKind`)                                                          | Mittlerer Button | Weg des Servers                                                                                            |
| ------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| läuft                                                                           | Pause            | keine neuen Schritte, laufende laufen kontrolliert aus                                                     |
| `paused`                                                                        | Fortsetzen       | am Pausenpunkt weiter (Revision des gespeicherten Plans wird übernommen)                                   |
| `failed`                                                                        | Fortsetzen       | neuer, verknüpfter Lauf: fertige Schritte werden übernommen, der fehlgeschlagene Schritt wird neu versucht |
| `interrupted` (Absturz, Neustart)                                               | Fortsetzen       | wie `failed`, nachdem eigene Prozesse und Reservierungen freigegeben sind                                  |
| `blocked` (Ergebnis `blocked`, Fehlerklasse `harm`)                             | Fortsetzen       | wie `failed`; der blockierte Schritt läuft neu, seine Nachfolger werden wieder freigegeben                 |
| `closeout_open` (`work_done_closeout_open`)                                     | Fortsetzen       | nur der offene Abschluss-Schritt läuft erneut                                                              |
| `stopped` (abgebrochen, auch ein beendeter Lauf mit gesetzter Stop-Anforderung) | Fortsetzen       | wie `failed`, sofern ein sicherer Stand (mindestens ein bestätigter Checkpoint) gespeichert ist            |

- Fortsetzen nutzt den gespeicherten Plan in seiner aktuellen Revision. Erfolgreich abgeschlossene Schritte werden nie erneut ausgeführt: ein Ergebnis wird nur übernommen, wenn sein Checkpoint denselben Ausgabe-Digest nennt.
- **Starten** beginnt immer einen neuen Lauf von vorn. Gibt es einen offenen (aktiven) Lauf, fragt ein Dialog, ob er beendet und neu begonnen werden soll; ein beendeter Lauf nutzt den bestehenden Neustart-Dialog.
- **Stop** wirkt in jedem nicht abgeschlossenen Zustand. Ein beendeter, fehlgeschlagener Lauf wird `cancelled`, nachdem das Ende seiner eigenen Prozesse bestätigt ist, und gibt seine Reservierungen frei. Ein Lauf, der schon `stopping` ist oder von keiner Engine mehr getrieben wird, wird mit einem weiteren Stop erzwungen beendet: eigene Prozesse enden, Sitzungs- und Skriptreste werden abgeglichen. Bleibt ein Prozess unbestätigt, meldet Stop `cleanup_unconfirmed` und behält die Reservierung, statt Erfolg vorzutäuschen.

#### Absturz und Neustart des Dienstes

Beim Start gleicht `AgentPlanStartupRecovery` offene Läufe mit den tatsächlichen Prozessen ab. Lokale Läufe ohne lebende Engine werden als `failed` mit `recovery.state = interrupted` markiert, ihre Sitzungen beendet, MCP-Zugänge widerrufen. Neu: auch **bereits beendete Läufe, deren Sitzungen noch `closeout: pending|failed` tragen und die eine Arbeitskopie reservieren**, werden abgeglichen (eigene Prozesse beenden, Abschluss festhalten, Schleifen-Sitzungen abgleichen) und danach freigegeben. Vorher wurden sie nur geprüft, nie abgeschlossen; die Reservierung blieb bei jedem Start bestehen (Journal: `agent.recovery.startup_summary … "reservationsKept":3`).

#### Gesperrtes Fortsetzen: Gründe und nächste Handlung

Ist Fortsetzen nicht sicher möglich, ist der Button deaktiviert, und die Oberfläche zeigt unter den Laufbuttons den Grund und die nächste Handlung als sichtbaren Text. `resumeBlock.action` nennt die Handlung, die den Grund löst:

| `resumeBlock.code`                                                                                                                           | Grund                                                                                                                    | `action`                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `plan_script_permission_denied`                                                                                                              | Admin-Modus nötig: Der Plan enthält Skript-Schritte                                                                      | `admin_mode` (Schaltfläche wechselt in den Admin-Modus) |
| `cleanup_unconfirmed`                                                                                                                        | Ende der Prozesse des Laufs nicht bestätigt                                                                              | `release` (Schaltfläche „Freigeben“)                    |
| `no_safe_state`, `checkpoint_mismatch`, `plan_context_changed`, `plan_definition_changed`, `plan_completed_changed`, `branching_unsupported` | kein sicherer Stand beziehungsweise Plan oder Kontext geändert                                                           | `restart` (Neu starten)                                 |
| `plan_workspace_conflict`                                                                                                                    | Arbeitsplatz von einem anderen Lauf belegt (`holderRunId` nennt den eigenen Lauf)                                        | `none`                                                  |
| `run_active`, `plan_workspace_waiting`                                                                                                       | Lauf noch aktiv beziehungsweise wartet auf Arbeitsplatz                                                                  | `wait`                                                  |
| `plan_invalid`, `plan_continuation_deleted`, `plan_access_denied`, `workspace_not_found`, `superseded`, `already_continued`                  | Befund im Plan, gelöschter Fortsetzungspunkt, fehlende Rechte, fehlender Arbeitsplatz, neuerer Lauf, bereits fortgesetzt | `none`                                                  |

Eine Sperre ohne Grund gibt es nicht: fehlt ein spezifischer Grund, nennt `resumeBlock` den Code des Plan-Befunds. Die eigene Reservierung des fortzusetzenden Laufs ist keine Sperre, weil Fortsetzen sie nach bestätigtem Prozessende selbst freigibt.

#### Pages-Schnittstelle

- `resume_plan` setzt in allen oben genannten Zuständen fort und wählt den Weg selbst; bei Sperre antwortet es mit demselben Grund wie `read_plan_control`.
- `read_plan_control` liefert `canResume`, `resumeKind`, `resumeBlock` und `blockers.resume`.
- `continue_plan_run`, `restart_plan_run` und `release_plan_run` bleiben erhalten (ausdrückliche Sitzungsart, geprüfte Schritte, reine Freigabe).

#### Befund der Ursachen vom 11.11.2026

- **Pages MCP (PMCP-13 blockiert):** Der Lauf 835bba8f endete `failed` mit `plan_acceptance_failed` (Fehlerklasse `harm`; Nachfolger `plan_dependency_failed`). Nach jedem „Starten“ aus einem beendeten Lauf legt `retireRestartSource` eine Bereinigungspflicht für den Vorgängerlauf an; `AgentWorkspaceCleanupService.settle` ruft daraufhin `engine.stop` auf, das bei einem beendeten Lauf nur `stopRequested: true` vermerkt (`AgentPlanRunCommands.stopDetached`). Das Journal zeigt `agent.run.stop_requested` jeweils zwei Sekunden nach dem Start des Folgelaufs (11:58:39 für Lauf 835bba8f nach dem Start um 11:58:37; ebenso 11:33:34 für Lauf 50018341). Die alten Prüfungen (`canControl = … && !run.stopRequested` in `planControl`, `resumeOption → cancelled_by_user`, `planRecoveryReason` ohne Wiederherstellungsgrund) machten einen so markierten Lauf endgültig unfortsetzbar: `status: failed`, `resumeAction: recovery`, `canResume: false`. Ein nachgestellter Lauf mit diesem Zustand ergab vorher `canResume: false` und `cancelled_by_user`, jetzt `resumeKind: stopped` und fortsetzbar. Nicht belegbar ist aus Code und Journal allein, welche Prüfung im Moment des Klicks vor 11:58 sperrte; Kandidaten sind der Befund der Startprüfung (siehe Session 2) und die Reservierungen.
- **Pages Session 2:** Der Lauf c3faf60d endete um 11:27:41 mit `cli_not_logged_in` (Journal: `agent.step.completed … "code":"cli_not_logged_in"`, danach `agent.run.completed … failed`); der Dienst ist nicht abgestürzt. Fortsetzen war gesperrt, weil `AgentPlanControlService.read` bei jedem Befund der Startprüfung (zum Beispiel `plan_script_permission_denied` außerhalb des Admin-Modus, dazu `planExecutionIssues`) `canResume` auf `false` setzte und den Grund nur als Tooltip zeigte.
- **Reservierungen:** Der Start hielt drei beendete Läufe dauerhaft (`AgentPlanStartupRecovery.releaseFinishedReservations` prüfte nur; Journal `reservationsKept: 3` bei jedem Start). Welche drei Läufe es sind, ist ohne Lesezugriff auf die Live-Datenbank nicht benannt.

## Teil B: Agents: Festlegungen

### Neuer Abschnitt: Laufsteuerung: Fortsetzen in jedem Zustand (umgesetzt, 11.11.2026)

Der mittlere Button entscheidet selbst, welcher technische Weg nötig ist; Bedienende müssen Resume, Recovery und Continue nicht unterscheiden. **Fortsetzen** ersetzt Pause, solange ein Lauf fortsetzbar ist, und genügt ein Klick:

| Zustand                                       | Mittlerer Button | Wirkung                                                                                                                                      |
| --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| läuft                                         | Pause            | keine neuen Schritte, laufende laufen kontrolliert aus                                                                                       |
| pausiert                                      | Fortsetzen       | am Pausenpunkt weiter                                                                                                                        |
| fehlgeschlagen                                | Fortsetzen       | fehlgeschlagenen Schritt neu versuchen, fertige Schritte übernehmen                                                                          |
| unterbrochen (Absturz, Neustart des Dienstes) | Fortsetzen       | nach Abgleich und Freigabe der eigenen Ressourcen am letzten sicheren Stand weiter                                                           |
| Schritt blockiert (Ergebnis `blocked`)        | Fortsetzen       | blockierten Schritt neu versuchen, nachdem die Ursache behoben ist, zum Beispiel ein geändertes Ticket; Nachfolger werden wieder freigegeben |
| nur Abschluss-Schritt offen                   | Fortsetzen       | nur diesen Schritt wiederholen                                                                                                               |
| gestoppt oder abgebrochen                     | Fortsetzen       | wie fehlgeschlagen, wenn ein sicherer Stand gespeichert ist                                                                                  |

- Fortsetzen nutzt den gespeicherten Plan in seiner aktuellen Revision; Änderungen an Plan oder Ticket dazwischen wirken beim Fortsetzen. Erfolgreich abgeschlossene Schritte laufen nie erneut.
- **Starten** beginnt immer einen neuen Lauf von vorn. Gibt es einen offenen Lauf, fragt ein Dialog, ob er beendet und neu begonnen werden soll.
- **Stop** funktioniert in jedem nicht abgeschlossenen Zustand, auch bei hängenden oder unbekannten Prozessen: eigene Prozesse enden, Ressourcen werden freigegeben, der Status wird `cancelled`. Ein zweiter Klick auf Stop beendet einen hängenden Stop erzwungen. Bleibt ein Prozess unbestätigt, sagt Pages das, statt Erfolg vorzutäuschen.
- **Nach Absturz oder Neustart** des Dienstes gleicht Pages offene Läufe mit den tatsächlichen Prozessen ab und markiert verlorene Läufe als unterbrochen. Ihre eigenen Sitzungen und Reservierungen werden nach bestätigtem Prozessende automatisch freigegeben; danach ist der Lauf ohne weiteren Schritt fortsetzbar.
- **Gesperrtes Fortsetzen** ist deaktiviert und zeigt sichtbar den konkreten Grund und die nächste Handlung, zum Beispiel „Admin-Modus nötig: Der Plan enthält Skript-Schritte“ (mit Schaltfläche zum Wechsel), „Arbeitsplatz von Lauf X belegt“, „Das Ende der Prozesse des Laufs ist nicht bestätigt“ (mit „Freigeben“) oder „Kein sicherer Stand gespeichert“ (mit „Neu starten“). Keine Sperre ohne Grund; eine lösbare Sperre bietet ihre Handlung direkt an. Die Liste der Gründe steht im technischen Planvertrag.
- Feste Breite und Höhe der Laufbuttons bleiben erhalten; die Beschriftung **Fortsetzen** bestimmt die Breite.
- Über die Pages-Schnittstelle gilt dasselbe: `resume_plan` setzt in allen genannten Zuständen fort, `read_plan_control` liefert `canResume`, `resumeKind` und bei Sperre `resumeBlock` passend zur Oberfläche.
