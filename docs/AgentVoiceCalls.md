# Sprachanrufe mit Agents im Direktchat

Das Kamerasymbol im Direktchat mit einem Agent startet einen Sprachanruf.
Anrufe zwischen Menschen laufen weiter über WebRTC (`chat-page-api/calls`,
`chat-page-api/call-media`); der Agent-Anruf nutzt dieselbe Anrufleiste, die
Gerätewahl der Audio-Einstellungen und die Stummschaltung.

Der Anruf hat zwei Wege. Der **Live-Weg** hält für den ganzen Anruf eine
WebSocket-Verbindung offen (`chat-page-api/agent-call/socket`): Der Browser
sendet den Redebeitrag schon während des Sprechens in kleinen Blöcken, der
Server meldet vorläufige Transkripte und gibt das Audio der Antwort Phrase für
Phrase weiter, während es noch synthetisiert wird. Der **gepufferte Weg**
sendet je Redebeitrag eine fertige Aufnahme und erhält das Audio ganzer
Sätze. Er läuft, wo die gewählte Spracherkennung keinen Live-Weg anbietet oder
die Verbindung nicht zustande kommt oder nicht wiederkommt.

## Ablauf auf dem Live-Weg

1. **Start.** Der Klick fragt `GET chat-page-api/agent-call?agentId=…` ab:
   Spracherkennung und Sprachausgabe müssen eingerichtet sein, sonst meldet
   die Leiste den fehlenden Schritt und öffnet kein Mikrofon. Die Antwort nennt
   je Schritt den Weg (`recognitionPath`, `synthesisPath`). Erst danach öffnet
   der Browser das gewählte Mikrofon und die Verbindung; der Server prüft
   Herkunft und Anmeldung, beim Aufbau und danach alle 20 Sekunden.
2. **Redebeitrag erkennen (VAD).** `speech-detector.ts` erkennt im Browser
   den Beginn eines Redebeitrags: Pegeldetektor mit lernendem Grundrauschen,
   300 ms Vorlauf. Stille, Hintergrundgeräusch unter der Sprechschwelle und ein
   stummgeschaltetes Mikrofon senden nichts. Ab dem Beginn geht jeder Block
   (16 kHz, 16 Bit, etwa 43 ms) sofort über die Verbindung. Nach 200 ms Pause
   meldet der Browser die Pause (`quiet`), nach 600 ms das Ende (`end`) mit der
   Zahl der Blöcke und der Blöcke mit Sprache. Ein Beitrag unter 300 ms
   Sprache (Klicken, Husten) wird verworfen (`cancel`).
3. **Erkennung während des Sprechens (`AgentCallRecognizer`).** Der Server
   hält die Blöcke geordnet im Speicher und erkennt die wachsende Äußerung in
   größer werdenden Abständen erneut (ab 0,7 s Audio, dann frühestens nach
   0,9 s und 60 % Zuwachs). Neue Texte gehen als `partial` an die Leiste. Die
   Pause startet sofort eine Erkennung der ganzen Sprache; deckt sie beim Ende
   alle Blöcke mit Sprache ab, ist sie das finale Transkript, und nach dem
   Ende folgt keine weitere Anfrage. Sonst erkennt der Server die ganze
   Aufnahme einmal.
4. **Genau ein Turn.** Zu wenig Ton, leere Texte, Geräuschbeschreibungen wie
   „[Musik]“ und Texte, die Erkenner bei Stille erfinden, ergeben `silent` und
   keinen Turn. Sonst sendet der Server `transcript` und ruft den Agent genau
   einmal im Chat-Kontext des Direktchats auf
   (`AgentEmployeeSessions.startVoiceTurn`).
5. **Phrasen und Synthese.** Der Antworttext wird während des Entstehens an
   kurzen Phrasengrenzen geschnitten (`AgentCallSentences.ts`): die erste
   Phrase darf ab 36 Zeichen an einem Komma enden, spätere an Satzenden,
   Zeilenumbrüchen und ab 90 Zeichen an Kommas; ein Text ohne Grenze wird bei
   220 Zeichen an einem Leerzeichen geteilt, ein Codeblock nie. Jede Phrase
   geht an die Stimme und das Tempo des Agents (`AgentSpeechService.speakStream`);
   die PCM-Blöcke der Synthese gehen sofort als `phrase`, `audio` und
   `phraseEnd` an den Browser. Während eine Phrase spielt, wird die nächste
   synthetisiert; die übernächste wartet, bis der Browser die Wiedergabe der
   Phrase davor bestätigt (`played`), höchstens so lange, wie deren Audio dauert.
6. **Wiedergabe (`agent-stream-player.ts`).** Der Browser spielt die Blöcke
   geordnet nach Phrase und laufender Nummer über die Web-Audio-Schnittstelle
   auf dem gewählten Lautsprecher. Der erste Ton wartet auf 120 ms Vorlauf
   (höchstens 250 ms), danach liegen höchstens 1,5 s Audio im Voraus beim
   Audiosystem; der Rest wartet in der Phrase. Doppelte Blöcke werden
   übersprungen.
7. **Dazwischenreden.** Sobald der Browser während der Antwort 240 ms Sprache
   erkennt, verstummt die Wiedergabe sofort, der Puffer wird geleert und der
   nächste Beitrag beginnt (`speech`). Der Server stoppt den Agent-Job und die
   Synthese und sendet keine Blöcke der alten Antwort mehr; Blöcke, die schon
   unterwegs waren, verwirft der Browser, weil ihr Turn nicht mehr läuft. Der
   Browser meldet, wie viele Zeichen gehört wurden (`spoken`). Das Mikrofon
   bleibt offen.
8. **Auflegen.** `hangup` beendet sofort Aufnahme, Wiedergabe, Erkennung,
   Synthese und Agent-Job.

## Verbindungsabbruch und Wiederholung

Bricht die Verbindung ab, öffnet der Browser sie bis zu fünfmal mit wachsender
Wartezeit wieder und sendet den Beitrag, den der Server noch nicht beantwortet
hat, vollständig erneut. Der Server hält den Anruf 20 Sekunden für die
Rückkehr. Er kennt jeden Beitrag des Anrufs: Blöcke mit bekannter Nummer
zählen einmal, ein Beitrag in Bearbeitung läuft weiter und liefert an die neue
Verbindung, ein abgeschlossener Beitrag antwortet `duplicate`. Auch nach einem
Neustart des Servers verhindert die Nachrichten-ID `call-<Anruf>-<Beitrag>` im
Session-Verlauf einen zweiten Turn. Kommt die Verbindung nicht zurück, läuft der
Anruf gepuffert weiter.

## Gepufferter Weg

`POST chat-page-api/agent-call?agentId&callId&turn` trägt den Beitrag als
16-kHz-WAV. Die Antwort ist ein Strom von JSON-Zeilen (`definition/AgentCall.ts`):
`transcript`, je Satz `sentence` mit Audio, `done` mit Zeiten, oder `silent`,
`duplicate`, `failed`. `agent-voice-player.ts` spielt die Sätze nacheinander.
Beim Dazwischenreden schließt der Browser die Anfrage und meldet die gehörten
Zeichen (`{ intent: "spoken" }`).

## Speicherung

Roh-Audio wird nicht gespeichert: Die Blöcke liegen nur im Speicher des
laufenden Beitrags und werden danach geleert. Das erkannte Nutzertranskript ist
die Nachricht des Nutzers im Chat-Session-Verlauf des Direktchats, die Antwort
des Agents die Antwortnachricht derselben Session; beide erscheinen auch im
Chat. Die Session lehnt eine zweite Nachricht mit derselben ID ab, und der
Server prüft sie vorher. Wurde die Antwort unterbrochen, setzt der Server an
die Stelle, bis zu der gesprochen wurde, die Marke `[…Anruf unterbrochen…]`;
der restliche Text bleibt stehen. Eine zweite Meldung ändert nichts.

## Denkstufe und Antwortlänge

Im Anruf läuft der Agent mit der niedrigsten Stufe, die der Katalog seines
Modells nennt (`minimal`, sonst `low`); nennt das Modell keine, bleibt seine
Stufe. Die Anweisung des Anrufs verlangt ein bis drei gesprochene Sätze ohne
Markdown.

## Streaming je Verbindung

| Schritt   | Verbindung                         | Weg                                                                                                                                                                                                    |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Erkennung | OpenRouter `/audio/transcriptions` | Live: OpenRouter erkennt nur ganze Aufnahmen; Pages erkennt die wachsende Äußerung wiederholt und in der Pause. Jede Zwischenerkennung ist eine eigene Anfrage, insgesamt etwa die doppelte Audiodauer |
| Synthese  | OpenRouter `/audio/speech`         | Live mit `pcm`: Die Blöcke gehen beim Eintreffen weiter. Gepuffert bei MiniMax (PCM erst nach der ganzen Phrase) und wo ein Modell nur MP3 liefert; die Phrase spielt dann am Stück                    |
| Antwort   | ACP-Runner                         | Textstrom über das Journal, während die Antwort entsteht                                                                                                                                               |

Unter Einstellungen → Agents nennen die Karten der Spracherkennung und der
Sprachausgabe für das gewählte Modell, ob der Direktanruf live oder nur
gepuffert läuft. Im Anruf markiert die Leiste einen gepufferten Schritt mit
„Gepuffert“. Ein Modell, das das Tempo ablehnt, spricht im Live-Weg mit
Wiedergaberate; die Tonhöhe ändert sich dann mit.

## Messung

Der Browser misst je Antwort ab Sprechende (`data-call-latency` an der Leiste,
`console.info("[pages] agent call latency")`): erster gesendeter Block und
erstes vorläufiges Transkript (negativ: vor dem Sprechende), Endeerkennung,
finales Transkript, erste Phrase, erster Audioblock und erster hörbarer Ton,
dazu `isWarm` (ab dem zweiten Beitrag eines Anrufs). Stille Strecken innerhalb
einer Antwort stehen in `data-call-gaps`: `block` und `phrase` sind
Pufferlücken, `text` eine Pause, in der der Agent die nächste Phrase noch nicht
geschrieben hatte; natürliche Sprechpausen liegen im Audio selbst und zählen
nicht. `data-call-interruptions` nennt je Dazwischenreden die Zeit bis zum
letzten Ton einschließlich der Ausgabelatenz. Der Server schreibt je Beitrag
`agent.call.turn` mit `transcriptMs`, `firstSentenceMs`, `firstAudioMs`,
`answerMs`, `partials`, `isEarlyFinal` und `bufferedPhrases` ab bestätigtem
Ende. Median und p95 warm und kalt über viele Anrufe auf dem vorgesehenen
Runner sind auf der Testinstanz zu messen; das Ziel ist ein warmer Median unter
einer Sekunde bis zum ersten Ton.

## Offene Entscheidungen

- **Native Audio-zu-Audio-Modelle** (Realtime-Verfahren) unterbieten die Zeit,
  liefern aber ein eigenes Audio statt der Agent-Stimme und keine Chat-Session
  mit Werkzeugen; solange Stimme und Textspeicherung nicht kompatibel sind,
  bleibt der Weg Erkennung, Agent, Synthese.
- **Streaming-Erkennung eines Anbieters:** Bietet eine Verbindung echte
  Streaming-Erkennung, ersetzt sie die wiederholte Erkennung ohne Änderung am
  Browser.
- **Echo:** Das Dazwischenreden stützt sich auf die Echounterdrückung des
  Browsers; Lautsprecher in Mikrofonnähe können den Agent selbst unterbrechen.
- **Speicherort:** Die Texte liegen im Session-Verlauf des Chats. Eine
  zusätzliche Datei im Storage-Bereich wäre eine eigene Entscheidung.
