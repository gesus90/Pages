# PAGE-304: Wiki-Entwurf für „Agents: Festlegungen“

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Der folgende Abschnitt wird als neuer Abschnitt nach „Laufsteuerung: Fortsetzen in jedem Zustand“ eingefügt.

---

## Agent-Chats: Sitzungen je Chat, Warteschlange und Grenzen (umgesetzt, 11.11.2026)

Ein Agent arbeitet gleichzeitig in mehreren Chats: im Direktchat, in Gruppenchats und weiteren. Eine Nachricht wird nie abgewiesen, nur weil der Agent woanders oder im selben Chat noch arbeitet.

**Ursache der früheren Sperre (PAGE-304)**

- Die Registry der laufenden Chat-Antworten ließ je Konto nur **eine** laufende Antwort zu (`ChatRequestRegistry.requireAdmission`, Prüfung „ein Eintrag je `userId`“). Ein Agent antwortet unter seinem eigenen Konto; lief seine Antwort im Direktchat, wurde jede Antwort in einem Gruppenchat mit `requestBusy` abgewiesen. Der Gruppenchat zeigte dann „… konnte nicht antworten, die Antwort ist fehlgeschlagen“, im Log stand `conversation.agent_reply.refused` mit `notice: agent_failed`.
- Die Sitzungen selbst waren bereits je Agent und Chat getrennt (eigene Chat-Sitzung, eigenes Arbeitsverzeichnis, eigener Verlauf). Pica behält die Regel „eine Antwort je Person“.

**Eine Sitzung je Chat und Agent**

- Jeder Chat eines Agents hat eine eigene Sitzung mit eigenem Sitzungsverzeichnis und eigenem Verlauf: der Direktchat je Person, jeder Gruppenchat je Gruppe. Sitzungen verschiedener Chats laufen parallel.
- Im Gruppenchat arbeitet jeder angesprochene Agent in seiner eigenen Sitzung dieses Chats; mehrere Agents antworten unabhängig voneinander.
- Gleichzeitige Pages-Aktionen derselben Agent-Identität aus mehreren Sitzungen bleiben über die bestehende Revisionsprüfung (`CONFLICT`) abgesichert.

**Warteschlange je Chat**

- Kommt im selben Chat eine neue Nachricht, während der Agent dort noch antwortet, wird sie eingereiht und direkt danach beantwortet. Im Direktchat geht sie in die laufende Antwort (Nachsteuern) oder als eigene Folgerunde; im Gruppenchat folgt sie als nächste Antwort desselben Agents.
- Der Chat zeigt an der Nachricht **„In Warteschlange“**, bis ihre Antwort beginnt.

**Grenzen**

- Unter **Einstellungen → Agents → Gleichzeitige Agent-Sitzungen** stellen Admins im aktiven Admin-Modus die Höchstzahl gleichzeitiger Sitzungen **je Agent** (Start 4) und **insgesamt** (Start 16) ein; erlaubt sind 1 bis 64, die Grenze je Agent höchstens so groß wie die Gesamtgrenze. Die Karte zeigt, wie viele Sitzungen gerade laufen und warten.
- Über einer Grenze wird eine Nachricht eingereiht, nie abgewiesen. Der Chat zeigt an ihr „In Warteschlange – die Höchstzahl gleichzeitiger Agent-Sitzungen ist erreicht …“. Ein frei werdender Platz geht an die älteste wartende Nachricht, deren Agent unter seiner Grenze liegt.
- Änderungen gelten sofort: Laufende Antworten laufen zu Ende, wartende beginnen, sobald Platz ist.

**Abbrechen**

- Im Direktchat stoppt „Stoppen“ die laufende Antwort und die wartenden Nachrichten dieses Chats.
- Im Gruppenchat hat jeder gerade antwortende Agent eine eigene Schaltfläche „‹Name› stoppen“. Sie stoppt nur dessen Antwort in diesem Chat; an ihrer Stelle steht „Die Antwort von ‹Name› wurde gestoppt.“
- Andere Chats und andere Agents arbeiten weiter.

**Aufräumen**

- Der Agent-Prozess einer Sitzung endet mit ihrer Antwort. Die nächste Nachricht setzt die gespeicherte Agent-Sitzung fort, oder sie beginnt mit dem gespeicherten Verlauf neu.
- Der Zustand einer ruhenden Sitzung im Speicher (ihre Warteschlange) wird nach 10 Minuten ohne Arbeit freigegeben. Verlauf und Arbeitsverzeichnis bleiben erhalten.

**Nachstellen ohne Modell**

- Mit der Agent-Simulation (`PAGES_AGENT_SIMULATION=1`, Szenario `slow`) laufen Gruppenchat-Antworten innerhalb derselben Grenzen und lassen sich stoppen. So lassen sich parallele Sitzungen, Warteschlange und Grenzen ohne Modellaufrufe und ohne Kosten prüfen.

Das gemeinsame Wissen zwischen Chats gehört zum Agent-Gedächtnis (MEMORY.md und DREAM.md), nicht zu diesem Abschnitt.
