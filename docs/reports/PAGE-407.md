# PAGE-407: Produkt- und Risikokontext

„Volle Umgebung“ ist eine ausdrückliche Administratorfreigabe des vollständigen
Host-Kontos für einen lokalen Agent-Knoten. Der gespeicherte Zugriff lautet
`full_environment`; die native CLI läuft in YOLO. Die vorhandenen isolierten
Modi und ihre Voreinstellungen bleiben erhalten.

Der Betreiber bindet einen Pages-Besitzer über
`PAGES_FULL_ENVIRONMENT_OWNER_ID` an das Linux-Konto des Pages-Prozesses.
Serverseitige Prüfung bei Speichern, Kopieren, Vorlagenübernahme und Start
verhindert eine Freigabe durch andere Benutzer. Der Runner lädt die Login-Shell-
Umgebung und verwendet das echte Home ohne Bubblewrap oder Verbindungskonto-
Umleitung. Der Benutzer-D-Bus und Docker bleiben erreichbar.

Es gibt bewusst keine Schutzliste für Live-Daten oder Dienste. Die
Worker-Unit erhält die vorhandene Laufzeit- und Prozesssteuerung. Sie kann
Prozesse in ihrem cgroup beenden; an externe Host-Dienste delegierte Ressourcen
liegen außerhalb dieser Prozessgruppe und müssen ausdrücklich aufgeräumt
werden. Eine Abschottung oder vollständige Geheimnisinventur wird nicht
behauptet. Ausgabe-Schwärzung und das Verbot, Zugangsdaten zu veröffentlichen,
bleiben Teil des Vertrags.

Die verbindliche Produktbeschreibung steht in
[AgentPlanRunner.md](../AgentPlanRunner.md#full-environment-full-host-owner-access-page-407)
und im [Wiki-Text](../wiki/PAGE-407.md). Diese Datei enthält ausschließlich
Designkontext, keine Ausführungsprotokolle oder Abnahmenachweise.
