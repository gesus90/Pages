# Remote-Konsole (PAGE-140)

Unter **Agents → Arbeitsbereiche → … → Konsole** öffnen Mitglieder der
freigegebenen Abteilung mit Projektzugriff eine interaktive Remote-Shell.
Administratoren benötigen für die Konsole ebenfalls diese Mitgliedschaft.
Lokale Arbeitsbereiche bieten die Aktion nicht an.

Die Shell startet im registrierten, erneut geprüften Arbeitsverzeichnis.
Eingaben einschließlich Strg+C und Änderungen der Terminalgröße werden über
einen PTY an OpenSSH weitergereicht. Das Panel zeigt Verbindungsstatus,
Wiederverbindungsversuche, klassifizierte Fehler und den Exit-Code beim
Sitzungsende. Schließen, Escape und Navigation fragen vor dem Beenden nach;
beim Verlassen des Browser-Tabs übernimmt der Browser die Bestätigung.
Das Panel lässt sich maximieren. Nach dem Sitzungsende bleibt die Ausgabe
lesbar; „Neue Sitzung starten“ öffnet ausdrücklich eine neue Shell.
Die Terminalfläche bleibt in beiden Pages-Themes dunkel, mit eigenen
semantischen Farb-Tokens.

## Transport und Zugriffsprüfung

Die Konsole öffnet einen eigenen Shell-Kanal über den bestehenden
PAGE-138-Control-Socket. Sie verwendet dessen isolierte SSH-Optionen und
fest bestätigten Hostschlüssel. Ohne Control-Socket sind sämtliche
Authentifizierungsmethoden des Kanalprozesses deaktiviert. OpenSSH-Escapes
sind deaktiviert, damit Terminaleingaben keinen lokalen Shell-Ausbruch
auslösen. Zugangsdaten gelangen weder in Kanalargumente noch in Antworten.

Jeder Öffnungs- und Wiederverbindungsversuch prüft aktuelle Mitgliedschaft,
Projektzugriff und das kanonische Arbeitsverzeichnis. Eingabe, Resize und
Ausgabestream prüfen zusätzlich den Sitzungsbesitzer. Der Stream prüft
Zugriffsrechte alle 15 Sekunden erneut. Ein Abteilungsentzug beendet die
Shell beim nächsten Aufruf oder dieser Prüfung.

Ausgaben laufen als gleichursprünglicher SSE-Stream, Eingaben und Resize als
gleichursprüngliche POST-Anfragen. Eingaben werden geordnet übertragen und
nach einem Fehler niemals erneut gesendet. Ein kurzer Stream-Abbruch kann
anhand sequenzierter Ausgabeereignisse weitergeführt werden. Der Speicher
enthält höchstens 256 Ki Zeichen Ausgabe und Status; bei einer nicht mehr
rekonstruierbaren Lücke endet die Sitzung. Auf dem Server bleiben keine
Terminalprotokolle gespeichert.

Solange das Panel offen ist, pausiert das Hintergrund-Polling der
Verbindungstabelle. Die Konsole überwacht ihren Transport selbst, sodass ein
fehlgeschlagener Tabellen-Reload das Panel bei einer Netzstörung nicht ersetzt.
Jede Eingabe trägt außerdem die Nummer des aktuellen SSH-Verbindungsversuchs;
der Server weist verspätete Eingaben einer vorherigen Shell zurück.

Ein verlorener SSH-Kanal startet eine neue Shell, keine Wiederaufnahme des
vorherigen Programms. Pro Konsolensitzung sind höchstens zehn
Wiederverbindungsversuche erlaubt, auch bei manueller Wiederverbindung.
Abweichende Hostschlüssel blockieren sofort. Der Browser begrenzt auch
Wiederverbindungen des Ausgabestreams auf zehn. Ohne Lease-Erneuerung
endet eine verlassene Konsole nach 60 bis 75 Sekunden. Pro Person sind drei,
insgesamt 50 Konsolen gleichzeitig zulässig.

## Bibliotheken und Lizenz

- `@xterm/xterm` 6.0.0: etablierter VT-Terminalemulator mit Tastatur-,
  Steuerzeichen- und Screenreader-Unterstützung. Keine Interpretation von
  Remote-Ausgaben als HTML, keine Link- oder Clipboard-Erweiterung.
- `@xterm/addon-fit` 0.11.0: misst Zeilen und Spalten bei Containeränderungen.
  Beide Pakete laden erst nach der Browser-Hydrierung; Farben stammen aus
  den Pages-Theme-Tokens, auch bei einem Theme-Wechsel.
- `@lydell/node-pty` 1.2.0-beta.15: kleinere Distribution von Microsofts
  node-pty mit vorgefertigten Plattformpaketen. Ermöglicht die direkte
  Wiederverwendung des OpenSSH-Masters und SIGWINCH, ohne zusätzliche
  Remote-Software oder Installationsskripte. Die Version ist vom Anbieter
  als Beta bezeichnet. Unterstützt werden dessen Linux-, macOS- und
  Windows-Pakete für x64 und ARM64; der bestehende Pages-SSH-Transport
  benötigt weiterhin eine unterstützte POSIX-Umgebung und OpenSSH.

Alle drei Pakete verwenden die MIT-Lizenz. Die vollständigen Hinweise liegen
in `assets/remote-console-LICENSE.txt`; die ursprünglichen Lizenzen bleiben
außerdem in den installierten Paketen erhalten.

Primärquellen: [xterm.js API](https://xtermjs.org/docs/api/terminal/classes/terminal/),
[FitAddon](https://xtermjs.org/docs/guides/using-addons/),
[xterm.js Security](https://xtermjs.org/docs/guides/security/),
[PTY-Distribution](https://github.com/lydell/node-pty).
