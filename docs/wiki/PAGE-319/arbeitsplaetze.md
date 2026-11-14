Lokale Arbeitsplätze, Arbeitsverzeichnisse und ihre Rechte.

[Zur Übersicht](/wiki/93eb063a-a63c-4cac-8393-af182291a582)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden (noch nicht umgesetzt)

Im Ausgangstext keine weitere Festlegung ausdrücklich als noch nicht umgesetzt ausgewiesen.

# Festlegungen ohne eindeutigen Umsetzungsstand

Die Quelle nennt diese Festlegungen als entschieden oder umgesetzt, ohne ihren Umsetzungsstand eindeutig zuzuordnen. Historische Zielverträge sind keine Auslieferungsnachweise; spätere datierte Präzisierungen bleiben maßgeblich.

## Arbeitsplätze

- Das **Formular** enthält Name, lokales Verzeichnis, Projektzuweisung und bestehende Nutzungszuweisungen (Personen, Gruppen, Abteilungen). Ein **vorhandenes Verzeichnis** ist einbindbar, ohne zwingenden Klon.
- Die **GitHub-Verknüpfung des Projekts** erscheint automatisch beim Arbeitsplatz und wird im Plan ebenfalls übernommen; es gibt **keine zusätzliche manuelle GitHub-Eingabe** und keine zusätzliche Secret- oder Repository-Eingabe.
- Die **Arbeitsplatzansicht** führt die Navigation unter „Agents → Arbeitsplatz“; „Agents Liste“ verweist auf das zentrale Panel mit geschützter Verwaltung. Die Tabelle zeigt Name, Projekt, tatsächlichen Pfad, aktuelle GitHub-Verknüpfung und lesbare Nutzbarkeit; Nutzbarkeit und Fehlergründe stehen in Klartext, die Statusfarbe ergänzt nur.
- **Nicht berechtigte Registrierungen** erscheinen für normale Nutzer nicht; Admin-Verwaltung gewährt keine Nutzungsberechtigung. Verwaltung nur mit passenden Serverrechten.
- Änderungen werden vor dem Verwerfen bestätigt, Serverfehler stehen inline, veraltete Fassungen werden gesperrt.
- **Registrierung entfernen** nur nach Bestätigung mit konkreter Erklärung, dass **Fremddateien erhalten bleiben**; aktuelle Agent-Referenzen werden gezeigt und sperren die Aktion. Verzeichnis und Dateien bleiben erhalten.
- **Fehlende Wurzeln** blockieren die Neuanlage und erklären die Serverkonfiguration im Admin-Bereich.
- **Arbeitsplatz-Parameter** im zentralen Agent-Editor können berechtigte registrierte Kennungen als Standard auswählen oder löschen; nicht mehr zugängliche gespeicherte Werte bleiben sichtbar und werden nicht automatisch ersetzt.
- Name, Pfad und GitHub sind kopierbare Inhalte; der Pfad bricht als Festbreitentext um. Die Navigation führt „Arbeitsplätze“ vor „Agent-Verwaltung“. Es gibt keine zweite Auswahl-, Dialog- oder Zieh-Infrastruktur.

**Arbeitsverzeichnis (PAGE-25)**

- Unter **Agents → Arbeitsverzeichnis** gibt es eine Karte „Arbeitsbereiche“ mit Name, Projekt, lokalem Pfad, GitHub-Verknüpfung aus dem Projekt, Nutzbarkeit und — nur wenn etwas verwaltet werden darf — Aktionen. Leere, Lade- und Fehlerzustände (mit „Erneut versuchen“) sind vorhanden.
- Ein Arbeitsbereich wird mit Name, Lokalem Pfad und Projekt registriert oder bearbeitet. Nur Projekte mit gespeicherter **GitHub-Repository-Adresse** sind wählbar; andere Projekte sind sichtbar, aber nicht wählbar.
- Der bestehende **lokale** Vertrag akzeptiert absolute Verzeichnisse unterhalb der freigegebenen Wurzeln; URLs, host:pfad und Netzwerkfreigaben werden nicht als lokale Pfade interpretiert. Remote-Profile verwenden die unten beschriebene eigene Maschinenreferenz.
- **Sichtbarkeit und Nutzung lokaler Arbeitsbereiche:** Wer Zugriff auf das Projekt hat, sieht und wählt den Arbeitsbereich. Es gibt keine eigene Freigabe pro Arbeitsbereich. Bei Remote-Profilen gilt zusätzlich die Abteilungsfreigabe der Verbindung, wie unten präzisiert.
- **Verwalten** (anlegen, ändern, entfernen): Administrator im Admin-Modus oder Projektverantwortliche (Projektrolle Manager oder Projektrecht mit Geltungsbereich über das Projekt). Ein Projektwechsel braucht das Recht auf beiden Projekten.
- **Entfernen** ändert weder Verzeichnis noch Projekt noch GitHub-Verknüpfung. Es ist gesperrt, solange Pläne, Agent-Standardwerte oder aktive Ausführungen darauf verweisen; die Aktion wird bestätigt. Namen der Verweise sehen nur Administratoren, Manager sehen Art und Anzahl.
- Verliert ein Projekt seine GitHub-Verknüpfung, bleibt der Arbeitsbereich sichtbar, ist aber nicht wählbar und kann keinen Plan starten. Laufende Läufe bleiben lesbar und stoppbar.
- In der **Arbeitsplanung** zeigt die Auswahl „Arbeitsbereich“ nur Bereiche erreichbarer Projekte. Nicht verfügbare stehen gesperrt mit „(nicht verfügbar)“ in der Liste. Die Freigabe heißt „Personen mit Projektzugriff“.

# Offen

- **Offen zur Bestätigung:** die Lesart „Manager mit Verwaltungsrechten auf Projektebene“ (wer Projektdaten und GitHub-Anbindung ändern darf, einschließlich Co-Eigner mit Geltungsbereich), die Ausweitung der Sichtbarkeit früher eingeschränkter Registrierungen und die Pfadwahl durch Manager ohne Wurzeln je Projekt.

Die Präzisierung „Arbeitsverzeichnis (PAGE-25)“ stammt aus dem Nachtrag vom 2026-10-13. Remote-Maschinenreferenz und Abteilungsfreigabe: [Remote-Verbindungen und Runner](/wiki/45bc1de4-9c18-4851-8e62-fc516075ca19).
