Abteilungsfreigaben, Konsole, Runner-Setup und Remote-Laufzeit.

[Zur Übersicht](/wiki/93eb063a-a63c-4cac-8393-af182291a582)

# Umgesetzt

Im Ausgangstext nicht ausdrücklich als umgesetzt ausgewiesen.

# Entschieden (noch nicht umgesetzt)

Im Ausgangstext keine weitere Festlegung ausdrücklich als noch nicht umgesetzt ausgewiesen.

# Festlegungen ohne eindeutigen Umsetzungsstand

Die Quelle nennt diese Festlegungen als entschieden oder umgesetzt, ohne ihren Umsetzungsstand eindeutig zuzuordnen. Historische Zielverträge sind keine Auslieferungsnachweise; spätere datierte Präzisierungen bleiben maßgeblich.

**Remote-Verbindungen, Konsole und Runner – bestätigt am 21.10.2026, Zielvertrag**

- Remote-Verbindungen werden ausschließlich den ausgewählten **Abteilungen** freigegeben. Diese Auswahl steht direkt als suchbares Feld „Abteilung“ im Verbindungsdialog; kein zusätzlicher Freigabemodus und kein separates Freigabefenster.
- Remote-Arbeitsbereichsprofile besitzen eine eindeutige Verbindungs-/Maschinenreferenz und einen Pfad auf dieser Maschine; ein eingegebener host:pfad ersetzt das nicht. Projekt- und Workspace-Zugriff bleiben zusätzlich notwendig.
- Die Aktion **„Konsole“** im Kontextmenü eines berechtigten Remote-Arbeitsbereichs übernimmt **dieselbe Abteilungsfreigabe** der Verbindung. **Keine eigene Konsolenfreigabe**, keine zusätzliche Personen-/Gruppenauswahl und kein weiterer Konsolenfreigabedialog. Aktuelle Mitgliedschaft sowie Projekt-/Workspace-Zugriff werden serverseitig beim Öffnen und während der Sitzung geprüft. Hostverwaltung und Secretzugriff bleiben getrennt.
- Die Konsole ist eine interaktive SSH-PTY-Sitzung im gewählten Arbeitsverzeichnis. Das Startverzeichnis ist keine Isolation; tatsächliche Remote-OS-/Containergrenzen bleiben maßgeblich. Diese Regeln beschreiben den bestätigten Zielumfang, keine bereits verifizierte Implementierung.

**Runner-Setup und Remote-Anbindungen – Igors Korrektur vom 21.10.2026**

- **„Setup“ ist ein Ein-Klick-Einstieg:** Geprüftes Skript hochladen, Eigentümer-Ausführungsbit setzen, automatisch die zugehörige Konsole öffnen und den geführten Installer darin starten; Änderungen, Anmeldungen und finaler Dienststart folgen den Bestätigungsstufen unten. Mehrfachklicks starten keinen zweiten Vorgang.
- **Igors Gruppierungskorrektur vom 21.10.2026:** **Einstellungen → Agents** bleibt eine gemeinsame Übersicht mit den Gruppen/Karten **API**, **Lokal** und **Remote**, ähnlich den bisherigen API-/CLI-Karten; keine separaten Tabs oder Remote-Unterseite. API enthält vorhandene API-Anbindungen, Lokal die auf dem Pages-Host vorhandenen CLI-Anbindungen, Remote die tatsächlichen Runner-Anbindungen mit eindeutiger Hostzuordnung. Bestehende Verwaltung und passende Hinzufügen-Aktionen bleiben erhalten. **Kein eigener „Modelle“-Button in der Anbindungsübersicht** (Igors Korrektur vom 21.10.2026); Katalogabgleich und Modellauswahl für Plan/Pica bleiben davon unberührt. **Die Gruppe Remote** zeigt standardmäßig nur auf dem jeweiligen Runner tatsächlich vorhandene Provider-/CLI-/Account-Anbindungen. Keine pauschalen Platzhalter für alle unterstützten Anbieter. Vorhandene, aber offline/veraltete oder nicht authentifizierte Anbindungen bleiben mit ihrem tatsächlichen Zustand erkennbar.
- **„Anbindung hinzufügen“** ist Teil derselben Runner-/Remote-Verwaltung: Administratoren wählen Zielhost und unterstützten API-Key- bzw. CLI-Anmeldeweg. Nach Registrierung/Anmeldung wird der Bestand synchronisiert. Eine fehlende CLI wird nur nach bewusster Auswahl über den fortsetzbaren Konfigurator ergänzt; nicht alle möglichen CLIs ungefragt installieren. Es ist kein gesondertes Folgevorhaben allein für Hinzufügen nötig.

**Geführtes Remote-Setup und Runtime – bestätigt von Igor am 22.10.2026 (Zielvertrag, noch kein Implementierungsnachweis)**

- Unter **Agents → Arbeitsverzeichnis → Remote-Verbindungen** liegt **Setup** direkt unter **Konsole öffnen** im Host-Kontextmenü. Nach erfolgreicher SSH-/Rechte-/Installationsprüfung ist es bei fehlender Installation aktiv; nach bestätigter Installation bleibt es sichtbar, ist deaktiviert und erklärt **Bereits installiert**. Bei jeder erneuten Verbindung den tatsächlichen Hostbefund prüfen, kein reines Browserflag. Installiert und aktuell bereit sind unterschiedliche Zustände.
- Ein Klick überträgt das verifizierte **pages_setup.sh**, setzt das Ausführungsbit nur für den Eigentümer (**chmod +x** ohne fremde Zusatzrechte), öffnet automatisch dasselbe fokussierte Remote-Konsolenpanel und startet das Skript dort mit sichtbarer Ausgabe ab der ersten Zeile. Keine manuelle Zwischenstufe oder unsichtbare Hintergrundinstallation.
- **Begrüßung und durchgehende wahrheitsgemäße Fortschrittsanzeige** begleiten die Reihenfolge: Ubuntu erkennen/anzeigen → Paketquellen/Abhängigkeiten nach Bestätigung → Codex/Claude Code/OpenCode bewusst auswählen und installieren → nach real unterstütztem Verfahren anmelden/API-Key konfigurieren → Git-Identität und GitHub-/Repo-Zugang samt Workspace-Zuordnung verifizieren → Ergebnisübersicht und ausdrückliches **Weiter / Continue** → gegebenenfalls sudo-Abfrage, verwalteten Runner-Dienst registrieren/aktivieren/starten → echte authentifizierte Pages-Kopplung prüfen. Nur Ubuntu im aktuellen Umfang; erforderliche frühere sudo-Rechte bei Paketinstallation offen erklären. Geheimnisse bleiben verdeckt/geschützt, vorhandene Zugänge/Repos erhalten.
- Git-Commit-Identität, GitHub-Anmeldung und tatsächliche Repo-Lese-/Schreibrechte sind getrennte Prüfungen. Pull/Push/Init und weitere Git-Aktionen laufen im zugewiesenen Remote-Workspace nach den realen Rechten; keine automatische Repo-Veröffentlichung, ungefragten Produktiv-Schreibtests oder stillen Datenresets.
- Der dauerhafte authentifizierte WS/WSS-Dienst verwaltet die gewählten Remote-ACPs und meldet **echte** Anbindungen, Modelle und unterstützte Fast-/Thinking-/Reasoning-Fähigkeiten unter **Einstellungen → Agents → Remote**. Beim Remote-Workspace bietet Agent Plan passende Anbindungen des zugehörigen Hosts an; keine stille lokale/andere Host-/Modellsubstitution. Prompt, Workspace/cwd, Konfiguration und Rückkommunikation folgen dem lokalen semantischen Vertrag, mit erneuter serverseitiger Rechteprüfung.
- Usage, Quoten-/Reset-Fenster und native Session-/Resume-Metadaten nur soweit tatsächlich aus CLI/Provider verfügbar melden. Fünf-Stunden-/Wochenkontingent ist keine universelle Sessionlaufzeit; unbekannt bleibt unbekannt. Reconnect gleicht tatsächliche Prozesse/Ereignisse ab statt Aufträge doppelt zu starten oder Fortsetzung zu simulieren. Auth-, Berechtigungs-, Boot-/Container-Lifecycle- und Protokollgrenzen siehe [technischer Vertrag](/wiki/3301f98d-8727-4c7b-97dc-8a8262d4e440).

# Offen

Keine weitere offene Sachfrage im Ausgangstext ausdrücklich ausgewiesen.
