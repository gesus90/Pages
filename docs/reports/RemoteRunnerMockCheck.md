# Remote-Runner: simulierte Stabilitätsprüfung mit temporären Mocks

Stand: 17.11.2026. Einmalige Prüfung auf dem vorbereiteten Session-Branch.

> **Alle Nachweise in diesem Protokoll sind simuliert.** Container, SSH-Verbindung,
> Remote-Runner-Prozess, PostgreSQL und Modell wurden durch temporäre Mocks ersetzt.
> Eine echte Remote-Verbindung, ein echtes Runner-Setup, ein echter Modellaufruf,
> eine echte cgroup-Suspendierung und ein echter WebSocket-Transport sind damit
> **nicht** nachgewiesen.

## Aufbau

Ein temporäres Prüfskript lief mit
`node --import tsx <prüfordner>/check.ts` aus dem Arbeitsbereich. Der
Prüfordner lag unter `~/.pages/tmp/remote-runner-mock-check/` des
Agent-Kontos. Das Skript hat den unveränderten Pages-Code direkt geladen und nur
die äußeren Grenzen ersetzt:

- **Plan-Ausführung:** echte `AgentPlanRunEngine` mit Start, Skript, Schleife,
  Agent, Abschluss, End, Pause, Fortsetzen und Stop. Ersetzt sind die
  Startfreigabe und die Schritt- und Skriptgrenze. Diese bildet den Claim nach
  der Regel von `RunnerPlanExecution.binding`: `managed`, und `ownerStepId` ist
  bei Schleifenmitgliedern die Schleife.
- **Runner-Transport:** echter `RunnerService` (`receive`, `attach`,
  `enqueue`, `ready`, `pauseExecution`, `cancel`, `overview`) und echter
  `RunnerManagedJobs`. Der Kanal ist ein Funktionsaufruf statt eines
  WebSockets; `RunnerChannel` und die Authentifizierung liefen nicht.
- **Runner-Prozess (Mock):** simulierter Runner 1.22.0 mit dem Wire-Protokoll
  `pages-runner.v1` aus `definition/RunnerProtocol.ts`. Er sendet `reconcile`
  mit Katalog und Fähigkeiten. Je Auftrag folgt `accepted` (mit Launch,
  `cgroup_v2`) → `running` → TODO-Ereignis → `usage`-Ereignis → TODO
  erledigt → `completed` mit Terminalbeleg. Auf Pause antwortet er mit
  `execution-state`, auf Stop mit `stop-result`. Er hält ein unbestätigtes
  Ereignis und sendet es nach einer Wiederverbindung erneut. Steuerbare
  Störungen: verworfenes Ack, Trennung, Prozessneustart mit überlebendem
  Worker, Hostverlust.
- **Persistenz:** echte `RunnerPlanEventService`, `projectManagedRunnerJob`,
  `persistRunnerStructuredProgress`, `mergeConfirmedRunnerJobs` und
  `requirePlanDispatchFence`. PostgreSQL ist durch einen Speicherstore
  ersetzt, der einen simulierten Pages-Neustart überlebt. Eine aufzeichnende
  Fake-Transaktion beantwortet nur die Statements der TODO- und
  Token-Tabellen. Die Historie wird beim Empfang in Reihenfolge projiziert statt
  über den Wiederherstellungsimport.
- **Modell (Mock):** deterministisches Modell `openrouter/mock/free-model:free`.
  Die Antwort ist ein Hash der Eingabe; es gibt keine Netzwerkanfrage und keine
  Kosten. Echt sind `chargeOpenRouterMessage`, `runnerTurnTokens` und
  `sumTurnUsage`.
- **Verbindung (Mock):** eine stabile, gekoppelte SSH-Verbindung mit
  Revision 1 und Admin-Bereich, ohne SSH.

Der isolierte Prüfplan existierte nur im Speicher des Prüfprozesses:
Start → Skript „Vorbereitung“ → Schleife „Prüfaufgaben“ (zwei Iterationen, je
eine Prüfaufgabe, ein Agent-Mitglied) → Agent „Abschluss“ → End. Die
Graphprüfung `planExecutionIssues` meldete keine Probleme. Es wurden kein Plan,
keine Aufgabe, keine Verbindung und kein Runner in Pages angelegt.

## Ergebnisse

Drei Szenarien mit 45 Prüfpunkten liefen nach der unten beschriebenen Korrektur
alle wie erwartet. Jeder Nachweis ist simuliert.

### Szenario A: Ablauf von Start bis End mit Störungen

| Nr. | Prüfpunkt                                                                                                                           | Ergebnis                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A0  | Runner nach `reconcile` gekoppelt und verbunden                                                                                     | bestanden                                    |
| A1  | Skriptschritt als verwalteter Runner-Auftrag abgeschlossen                                                                          | bestanden (`completed`)                      |
| A2  | Skript im Lauf `succeeded`                                                                                                          | bestanden                                    |
| A3  | Schleife `running`, Iteration 1 aktiv                                                                                               | bestanden                                    |
| A4  | TODOs live übernommen: erster Eintrag erledigt, zweiter in Arbeit                                                                   | bestanden (`done`, `active`)                 |
| A5  | Token live je Versuch gespeichert                                                                                                   | bestanden (Eingabe 17, Ausgabe 7, gesamt 24) |
| A6  | Pause zweimal während des Zugs: Lauf `paused`, Runner-Scope `frozen`                                                                | bestanden (2/2)                              |
| A7  | Fortsetzen zweimal: Lauf `running`, Runner-Scope `thawed`                                                                           | bestanden (2/2)                              |
| A8  | Verbindungsabbruch vor einem Ack: Pages meldet den Runner nicht mehr als verbunden                                                  | bestanden                                    |
| A9  | Nach Wiederverbindung das unbestätigte Ereignis erneut gesendet; genau einmal gespeichert, Sequenzen gleich                         | bestanden (Sequenz 9/9)                      |
| A10 | Runner-Neustart mit überlebendem Worker: laufender Auftrag bleibt `running`, kein `lost`                                            | bestanden                                    |
| A11 | Pages-Neustart: der neue Prozess kennt den Runner erst nach `reconcile` als verbunden                                               | bestanden                                    |
| A12 | Pages-Neustart: Journal mit Sequenz und Aufträgen erhalten, Abschlusszug weiter `running`                                           | bestanden (Sequenz 19 → 19)                  |
| A13 | Lauf endet `succeeded`                                                                                                              | bestanden                                    |
| A14 | Start, Skript, Schleife, Abschluss und End `succeeded`                                                                              | bestanden                                    |
| A15 | Genau zwei Iterationen, beide `succeeded`                                                                                           | bestanden                                    |
| A16 | Drei Agent-Versuche (zwei Aufgaben, Abschluss), vier Dispatches einschließlich Skript, kein doppelter Dispatch                      | bestanden                                    |
| A17 | TODOs je Versuch am Ende vollständig erledigt                                                                                       | bestanden                                    |
| A18 | Token je Versuch genau einmal gespeichert                                                                                           | bestanden (3 Züge, 67 Token)                 |
| A19 | Kostenberechnung bewertet das `:free`-Modell als kostenlos                                                                          | bestanden (`free`, 0)                        |
| A20 | Kostenstatus der Runner-Token-Zeilen                                                                                                | **Befund**, siehe unten                      |
| A21 | Alle Runner-Aufträge `completed`, Pages- und Runner-Sequenz gleich                                                                  | bestanden (21/21)                            |
| A22 | `runnerJobs` der Laufansicht: kein offener Eintrag, letzter Eintrag entspricht dem letzten Runner-Auftrag                           | bestanden; bestätigte Vorgänger werden planmäßig entfernt |
| A23 | Gespeichertes Lese-Modell der Laufansicht (`readPlanRun`) gleicht dem Engine-Zustand in Lauf-, Schritt- und Iterationsstatus        | bestanden                                    |
| A24 | Runner-Zeile der Einstellungen (`overview`): verbunden, Version 1.22.0, Pause mitten im Zug verfügbar                               | bestanden                                    |
| A25 | Heartbeat beantwortet, Zustand unverändert                                                                                          | bestanden                                    |
| A26 | Ereignis mit Sequenzlücke abgewiesen                                                                                                | bestanden (`Runner event out of sequence`)   |
| A27 | Nach End keine offene Schleifensitzung und kein aktiver Runner-Auftrag                                                              | bestanden (`cleanup=not_needed`)             |

### Szenario B: Stop während eines pausierten Agent-Zugs

| Nr. | Prüfpunkt                                                                       | Ergebnis                 |
| --- | ------------------------------------------------------------------------------- | ------------------------ |
| B1  | Pause vor Stop                                                                  | bestanden                |
| B2  | `cancel` an den Runner, `stop-result` mit `closeout: confirmed`                 | bestanden                |
| B3  | Lauf endet `cancelled`, `stopRequested` gesetzt                                 | bestanden                |
| B4  | Auftrag `interrupted`, kein weiterer Dispatch                                   | bestanden                |
| B5  | Nachfolgende Schritte nicht gestartet                                           | bestanden (`cancelled`)  |
| B6  | Bereinigung bestätigt: `runnerJobs` `interrupted/confirmed`, kein aktiver Auftrag | bestanden              |

### Szenario C: Abrupter Runner-Verlust

Transport und Worker verschwinden gleichzeitig; danach meldet sich der Runner
mit seinem Journal, aber ohne den Worker.

| Nr. | Prüfpunkt                                                                                    | Ergebnis                  |
| --- | -------------------------------------------------------------------------------------------- | ------------------------- |
| C1  | Nach mehr als 45 s ohne Kontakt (Uhr verschoben) gilt der Runner als nicht verbunden         | bestanden                 |
| C2  | Vor dem Wiederabgleich bleibt der Auftrag unverändert `running`; Pages rät nichts            | bestanden                 |
| C3  | Wiederabgleich ohne Worker markiert den Auftrag `lost`                                       | bestanden                 |
| C4  | Lauf endet `failed`, der verlorene Auftrag wird nicht automatisch neu gestartet              | bestanden (2 Dispatches)  |
| C5  | Laufansicht zeigt den Auftrag als `lost`                                                     | bestanden                 |
| C6  | Iteration 1 `failed` mit Ursache                                                             | bestanden                 |
| C7  | Bereinigung bleibt ohne Nachweis offen (`closeout: pending`), keine geratene Freigabe        | bestanden                 |
| C8  | Erneute Wiederverbindung belebt den Auftrag nicht, kein neuer Dispatch                       | bestanden                 |
| C9  | Ursache ist `plan_runner_lost`, Blockerklasse `harm`                                         | bestanden nach Korrektur  |

## Befunde

### Verlorener verwalteter Auftrag meldete einen falschen Fehlercode (behoben)

- **Erwartet:** Ein Runner-Auftrag, der beim Wiederabgleich ohne Worker als
  `lost` gilt, beendet den Schritt mit `plan_runner_lost`. Die Meldung lautet
  „Remote-Prozess ohne Exit-Beleg verloren, kein automatischer Neustart“, die
  Blockerklasse ist `harm`. So verhält sich bereits die Projektion nicht
  verwalteter Aufträge in `RunnerPlanEvents`.
- **Tatsächlich vor der Korrektur:** `RunnerManagedJobs` behandelte `lost` wie
  jeden anderen Abschluss ohne Ergebnis und warf `plan_runner_incomplete`
  („Der Runner endete, ohne seinen Turn abzuschließen“, Blockerklasse
  `infrastructure`). Diese Klasse erlaubt grundsätzlich automatische
  Wiederholungen und kündigt sie als technischen Sitzungsfehler an. Ob die
  Sperre `closeout_unconfirmed` eine Wiederholung hier verhindert hätte, wurde
  nicht ausgeführt. Der erste Prüflauf zeigte
  `Pruefaufgaben=failed:plan_runner_incomplete`.
- **Korrektur:** `RunnerManagedJobs` meldet für `lost` jetzt
  `plan_runner_lost`; die übrigen Endzustände ohne Ergebnis bleiben
  `plan_runner_incomplete`. Danach zeigte der Lauf `failed:plan_runner_lost`
  (C9). Die vorhandene Sperre gegen unsichere Wiederholungen
  (`closeout_unconfirmed`) bleibt unverändert.

### Kosten von Remote-Zügen werden nicht ausgewiesen (offen)

- **Erwartet:** Für ein kostenloses Modell zeigt Pages die Kosten der
  Remote-Züge als kostenlos (0) an, wie die Preisberechnung es für
  `:free`-Modelle festlegt (A19).
- **Tatsächlich:** `persistRunnerStructuredProgress` und
  `persistRunnerSessionUsage` speichern Runner-Token ohne Kostenstatus. Die
  Summe `sumTurnUsage` der drei simulierten Züge hat deshalb weder `costState`
  noch einen Betrag (A20). Token werden korrekt gezählt; Kosten bleiben für
  Remote-Züge leer, auch bei einem kostenlosen Modell.
- Eine Korrektur braucht eine Preisanbindung für Runner-Züge mit einem
  festgelegten Preisstand und gehört nicht zu dieser Prüfung. Der Befund bleibt
  offen.

## Grenzen der simulierten Prüfung

- WebSocket-Kanal (`RunnerChannel`), Registrierungsfreigabe, Token-Prüfung,
  Subprotokolle und Socket-Zeitgrenzen liefen nicht. Der Kanal endet laut Code
  nach mehr als 45 s Stille bei der nächsten 15-s-Prüfung, also spätestens nach
  60 s. Das stimmt mit der Runner-Dokumentation überein, ist aber nur gelesen,
  nicht ausgeführt.
- Der echte Runner (`scripts/runner/*.mjs`), cgroups, bwrap, Worker-Supervisor,
  Exit-Dateien und Lease-Überwachung wurden nicht ausgeführt. `frozen`/`thawed`
  sind Antworten des Mocks.
- `RunnerPlanExecution` (Zugriffsprüfungen, Befehlsaufbau, Sitzungsaufzeichnung)
  und `AgentPlanStepRunner` (Abnahme, Wiederholungen, Sitzungen) wurden durch
  eine Grenze ersetzt, die den Claim nach derselben Regel bildet. Die
  Wiederholungsentscheidung nach einem Verlust wurde nur über die
  Blockerklasse geprüft, nicht über einen Wiederholungslauf.
- Pages-Neustart bedeutet hier: neuer `RunnerService` und neuer
  `RunnerPlanEventService` über demselben dauerhaften Speicher, danach
  Wiederabgleich des Runners. Die Plan-Engine lief weiter, wie ein getrennter
  Plan-Prozess bei einem Neustart der API. Die Übernahme eines Laufs durch eine
  neu gestartete Plan-Engine wurde nicht simuliert.
- Die Laufhistorie wurde beim Empfang in Reihenfolge projiziert. Die
  verzögerte Übernahme über `RunnerHistoryRecovery` mit `history-deferred`
  wurde nicht geprüft.
- PostgreSQL-Transaktionen, Sperren und Migrationen wurden nicht ausgeführt.
  Die Fake-Transaktion beantwortet nur die Statements für TODO- und
  Token-Tabellen.
- Die Darstellung in Pages wurde über das Lese-Modell (`readPlanRun`) und die
  Runner-Zeile (`overview`) verglichen, nicht im Browser.

Lint, Check, Typecheck, Formatprüfung, Build, Testsuiten und Coverage:
**nicht ausgeführt (Vorgabe Igor)**.

## Bereinigung

Alle Testdaten lagen im Speicher des Prüfprozesses: Prüfplan, Lauf, zwei
Prüfaufgaben, Runner-Kopplung, Verbindung, Ereignisbelege, TODOs und Token.
Sie endeten mit dem Prozess. In Pages wurden weder Pläne, Aufgaben,
Verbindungen, Runner noch Tickets angelegt oder geändert. Der Logger wurde ohne
Logverzeichnis betrieben und schrieb keine Logdatei.

Der Prüfordner `~/.pages/tmp/remote-runner-mock-check/` enthielt am Ende die drei
Mock-Dateien `mocks.ts`, `runner.ts` und `check.ts` sowie die Laufprotokolle
`run1.log` bis `run3.log`. Er wurde mit `rm -rf` entfernt. Nachkontrolle am
17.11.2026:

| Kontrolle                                                                          | Ergebnis                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `test -e ~/.pages/tmp/remote-runner-mock-check`                                    | Prüfordner entfernt                                                 |
| `ls -la ~/.pages/tmp/`                                                             | leer; der schon vorhandene Ordner `tmp` blieb bestehen              |
| Dateien außerhalb des Prüfordners, die nach Prüfbeginn entstanden sind (`find -newer`) | keine                                                           |
| Laufende `node --import tsx`-Prüfprozesse (`ps`)                                   | keine                                                               |
| Mock-Bezeichner im Arbeitsbereich (`grep -rlnI`)                                   | nur dieses Protokoll                                                |
| `git status --short`                                                               | nur die Korrektur in `RunnerManagedJobs.ts`, dieses Protokoll und sein Verweis in `docs/README.md` |

Ein Schreibwerkzeug hatte die Mock-Dateien anfangs in einem zusätzlichen,
dabei neu angelegten Ordner `.pages/tmp` des Host-Kontos abgelegt (Entstehung
01:50:01, gleichzeitig mit dem Unterordner). Die Dateien wurden vor dem ersten
Lauf in den Prüfordner verschoben, und beide neu angelegten Ordner wurden
entfernt. Eine Nachkontrolle bestätigte: nicht vorhanden. Vorhandene, nicht für
diese Prüfung erzeugte Ressourcen blieben unverändert.
