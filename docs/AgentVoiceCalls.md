# Sprachanrufe mit Agents im Direktchat

Das Kamerasymbol im Direktchat mit einem Agent startet einen Sprachanruf.
Anrufe zwischen Menschen laufen weiter über WebRTC (`chat-page-api/calls`,
`chat-page-api/call-media`); der Agent-Anruf nutzt dieselbe Anrufleiste, die
Gerätewahl der Audio-Einstellungen und die Stummschaltung.

## Ablauf

1. **Start.** Der Klick fragt `GET chat-page-api/agent-call?agentId=…` ab:
   Spracherkennung und Sprachausgabe müssen eingerichtet sein, sonst meldet
   die Leiste den fehlenden Schritt und öffnet kein Mikrofon. Erst danach
   öffnet der Browser das gewählte Mikrofon.
2. **Redebeitrag erkennen (VAD).** `speech-detector.ts` schneidet im Browser
   einen Redebeitrag aus: Pegeldetektor mit lernendem Grundrauschen, 300 ms
   Vorlauf, Ende nach 600 ms Pause, kürzere Beiträge als 300 ms (Klicken,
   Husten) und stumm geschaltete Mikrofone senden nichts. Spielt der Agent,
   braucht ein Dazwischenreden 240 ms Sprache.
3. **Ein Beitrag, eine Anfrage.** `POST chat-page-api/agent-call?agentId&callId&turn`
   trägt den Beitrag als 16-kHz-WAV. Die Antwort ist ein Strom von JSON-Zeilen
   (`definition/AgentCall.ts`): `transcript`, je Satz `sentence` mit Audio,
   `done` mit Zeiten, oder `silent`, `duplicate`, `failed`.
4. **Server (`AgentCallService`).** Der Server prüft die Aufnahme noch einmal
   (zu wenig Ton: kein Anbieteraufruf), erkennt den Text über die
   Spracherkennung der Instanz und verwirft leere Texte, Geräuschbeschreibungen
   wie „[Musik]“ und Texte, die Erkenner bei Stille erfinden. Nur sonst ruft er
   den Agent genau einmal im Chat-Kontext des Direktchats auf
   (`AgentEmployeeSessions.startVoiceTurn`). Der Antworttext wird
   während des Entstehens in Sätze geschnitten
   (`AgentCallSentences.ts`, der erste Satz darf an einem Komma enden); jeder
   fertige Satz geht an die Stimme des Agents (`AgentSpeechService`) und wird
   mit seinem Audio sofort gesendet.
5. **Wiedergabe.** `agent-voice-player.ts` spielt die Sätze nacheinander auf
   dem gewählten Lautsprecher, während der Rest noch entsteht.
6. **Dazwischenreden und Auflegen.** Sobald der Browser Sprache erkennt,
   stoppt er die Wiedergabe, schließt die Anfrage und verwirft ausstehende
   Sätze. Das Schließen stoppt den laufenden Agent-Job. Danach meldet der
   Browser, wie viele Zeichen er tatsächlich gespielt hat
   (`{ intent: "spoken" }`).

## Speicherung

Roh-Audio wird nicht gespeichert. Das erkannte Nutzertranskript ist die
Nachricht des Nutzers im Chat-Session-Verlauf des Direktchats, die Antwort des
Agents die Antwortnachricht derselben Session; beide erscheinen auch im Chat.
Die Nachricht trägt die ID `call-<Anruf>-<Beitrag>`: Die Session lehnt eine
zweite Nachricht mit derselben ID ab, und der Server prüft sie vorher. Eine
Wiederholung oder Wiederverbindung speichert den Beitrag deshalb nicht noch
einmal und ruft den Agent nicht noch einmal auf. Wurde die Antwort
unterbrochen, setzt der Server an die Stelle, bis zu der gesprochen wurde, die
Marke `[…Anruf unterbrochen…]`; der restliche Text bleibt stehen. Eine zweite
Meldung ändert nichts.

## Denkstufe und Antwortlänge

Im Anruf läuft der Agent mit der niedrigsten Stufe, die der Katalog seines
Modells nennt (`minimal`, sonst `low`); nennt das Modell keine, bleibt seine
Stufe. Die Anweisung des Anrufs verlangt ein bis drei gesprochene Sätze ohne
Markdown.

## Streaming je Verbindung

| Schritt   | Verbindung                         | Stand                                                                                            |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Erkennung | OpenRouter `/audio/transcriptions` | Pages sendet einen Beitrag und liest eine vollständige JSON-Antwort; kein Streaming              |
| Erkennung | Z.AI `glm-asr`                     | Pages sendet `stream=false`; kein Streaming                                                      |
| Synthese  | OpenRouter `/audio/speech`         | Der Client liest die Audioantwort eines Satzes vollständig; Streaming entsteht durch Satzgrenzen |
| Antwort   | ACP-Runner                         | Textstrom über das Journal, während die Antwort entsteht                                         |

Eine Teilerkennung während des Sprechens gibt es deshalb nicht; die
Erkennung beginnt, wenn die Endeerkennung den Beitrag schließt. Weil das
Ende erst nach 600 ms Pause feststeht, liegt die Untergrenze der Zeit bis zum
Ton bei dieser Pause plus Erkennung, Modell und Synthese des ersten Satzes.

## Messung

Der Browser misst je Antwort ab Sprechende (`data-call-latency` an der Leiste
und `console.info("[pages] agent call latency")`): Endeerkennung, Transkript,
erster sprechbarer Satz, erster hörbarer Ton. Der Server schreibt je Beitrag
`agent.call.turn` mit `transcriptMs`, `firstSentenceMs`, `firstAudioMs` und
`answerMs` ab vollständiger Aufnahme. Median und p95 warm und kalt über viele
Anrufe auf dem vorgesehenen Runner sind noch zu messen; das Ziel von unter
einer Sekunde im Median ist nicht vorausgesetzt.

## Offene Entscheidungen

- **Native Audio-zu-Audio-Modelle** (Realtime-Verfahren) unterbieten die Zeit,
  liefern aber ein eigenes Audio statt der Agent-Stimme und keine Chat-Session
  mit Werkzeugen; solange Stimme und Textspeicherung nicht kompatibel sind,
  bleibt der Weg Erkennung, Agent, Synthese.
- **Streaming-Synthese:** OpenRouter liefert Audio beim Entstehen; der Client
  puffert heute einen Satz. Chunked-PCM bis zum Browser würde die Zeit bis
  zum ersten Ton um die Synthesedauer des ersten Satzes senken.
- **Streaming-Erkennung:** Erst wenn eine Verbindung sie anbietet, kann die
  Erkennung während des Sprechens beginnen.
- **Echo:** Das Dazwischenreden stützt sich auf die Echounterdrückung des
  Browsers; Lautsprecher in Mikrofonnähe können den Agent selbst unterbrechen.
- **Speicherort:** Die Texte liegen im Session-Verlauf des Chats. Eine
  zusätzliche Datei im Storage-Bereich wäre eine eigene Entscheidung.
