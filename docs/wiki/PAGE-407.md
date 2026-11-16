# Agents – Festlegungen zur vollen Umgebung

Ziel-Seite: [Agents: Festlegungen](/wiki/93eb063a-a63c-4cac-8393-af182291a582).
Dieser Repository-Text beschreibt das Produkt; die Live-Wiki wird getrennt gepflegt.

## Volle Umgebung für einen Agent-Knoten

Ein aktiver menschlicher Administrator kann an einem lokalen Agent-Knoten
zusätzlich zu „Nur Lesen“ und „YOLO“ ausdrücklich „Volle Umgebung“ wählen.
Ohne diese Wahl bleibt die heutige Abschottung unverändert. Andere Benutzer
sehen die Auswahl nicht und dürfen einen solchen Knoten weder speichern noch
starten. Das prüft der Server auch für API-Aufrufe, importierte Vorlagen,
Kopien sowie Knoten innerhalb von Gruppen und Schleifen.

„Volle Umgebung – voller Zugriff mit den Rechten von <Besitzer>“ bedeutet:
keine Abschottung, keine geschützten Pfade und keine geschützten Dienste.
Der Schritt läuft im Workspace unter dem Linux-Konto des zugeordneten
Plan-Besitzers, mit echtem schreibbarem Home, Login-Shell-PATH, Benutzer-D-Bus
und allen verfügbaren CLIs, Konfigurationen und Anmeldungen. Dazu gehören
Claude Code, Codex, OpenCode, Antigravity/agy, gh, Git/SSH, der Benutzerdienstmanager,
Docker und das Netzwerk. Die Agent-CLI erlaubt alle Werkzeuge ohne Rückfrage.

Auch `~/.pages`, `/opt/pages`, `~/.openclaw`, `~/Agents`, Live-Datenbank und
Live-Dienst sind erreichbar. Der Schritt kann Daten löschen, Dienste ändern
und mit den Anmeldungen des Besitzers auf externe Konten zugreifen. Das ist
eine bewusste Freigabe sämtlicher Rechte dieses Kontos.

Pages-Konten sind keine Linux-Konten. Der Betreiber ordnet deshalb über
`PAGES_FULL_ENVIRONMENT_OWNER_ID` ausdrücklich den Plan-Besitzer dem Linux-Konto
zu, unter dem Pages bereits läuft. Ein fremder Besitzer wird abgewiesen;
Pages verwendet weder sudo noch eine automatische Kontoübernahme. Diese Stufe
benötigt einen lokalen Knoten und eine verfügbare systemd-Benutzer-Unit.

Knoten, Editor und Lauf-Panel nennen die Stufe und den Besitzer deutlich.
Jeder entsprechende Schritt wird im Laufjournal vermerkt. Laufzeitbegrenzung,
Pause, Fortsetzen und Stop verwenden die bestehende Laufsteuerung. Stop beendet
die Prozesse der Worker-Unit; fehlgeschlagene Bereinigung bleibt offen.
Bewusst über Host-Dienste ausgelagerte Prozesse und Container müssen vom Agent
selbst entfernt werden. Voller Host-Zugriff bietet dagegen keine Abschottung.

Zugangsdaten gehören niemals in Berichte, Logs oder Tickets. Die bestehende
Schwärzung bleibt aktiv und berücksichtigt zusätzlich geheime exportierte
Umgebungsvariablen. Sie kann nicht jedes beliebige Geheimnis des gesamten
Homes kennen und verhindert keine direkten Dateischreibzugriffe eines solchen
Schritts. Journal und Berichte enthalten keine Umgebungs- oder Anmeldedumps.

Der [Runner-Vertrag](../AgentPlanRunner.md#full-environment-full-host-owner-access)
beschreibt Zuordnung, Start und Laufsteuerung.
