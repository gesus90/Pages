# Remote-Konsole (PAGE-140, PAGE-143)

Die Konsole öffnet eine interaktive SSH-Shell in einem zentrierten modalen
Fokus-Panel (1152 × 816 px auf dem Desktop, in kleineren Fenstern innerhalb
der sichtbaren Fläche). Es gibt zwei Einstiege mit derselben Technik:

- **Agents → Arbeitsverzeichnis → Remote-Verbindungen → … → Konsole öffnen**
  (PAGE-143): eine Shell auf dem Host der Verbindung. Sie startet als
  Login-Shell des SSH-Benutzers im Anmeldeverzeichnis; das Panel zeigt dieses
  Verzeichnis, sobald der Host es gemeldet hat.
- **Agents → Arbeitsverzeichnis → Arbeitsbereiche → … → Konsole öffnen**
  (PAGE-140): eine Shell im registrierten, erneut geprüften Arbeitsverzeichnis
  eines Remote-Arbeitsbereichs. Lokale Arbeitsbereiche bieten die Aktion nicht an.

Die Konsole öffnen nur Mitglieder der Abteilung, für die die Verbindung
freigegeben ist; die Administratorrolle allein genügt nicht. Für einen
Arbeitsbereich ist zusätzlich der Projektzugriff nötig.

Der Kopf zeigt Verbindungsname, SSH-Benutzer, Host, Port, Startverzeichnis und
Verbindungsstatus sowie Vergrößern und Schließen. Eingaben einschließlich
Strg+C und Änderungen der Terminalgröße werden über einen PTY an OpenSSH
weitergereicht. Strg+Umschalt+C kopiert die Auswahl, Strg+Umschalt+V fügt ein;
beides funktioniert auch ohne HTTPS. Escape fragt wie der Schließen-Knopf
nach, bevor eine aktive Sitzung endet, und erreicht die Shell deshalb nicht;
Strg+[ sendet ESC an die Shell. Ein Klick auf die abgedunkelte Fläche beendet
nichts. Beim Öffnen erhält das Panel den Fokus und, sobald die Shell bereit
ist, das Terminal; beim Schließen kehrt er zum Aktionsmenü der Zeile zurück.
Nachgefragt wird nur bei einer aktiven Sitzung (Verbindungsaufbau, verbunden,
Wiederverbindung); bei Navigation und beim Verlassen des Browser-Tabs ebenso.

Alle Zustände erscheinen im selben Panel: Verbindungsaufbau, verbunden,
unterbrochen mit Wiederverbindung, Wiederverbindung gescheitert,
Anmeldung fehlgeschlagen, Hostschlüssel geändert (ohne erneuten Versuch und
ohne automatische Schlüsselannahme), Host nicht erreichbar, Terminal nicht
verfügbar, Zugriff entzogen und regulär beendete Shell mit Exitstatus. Nach
dem Sitzungsende bleibt die Ausgabe lesbar; „Neue Sitzung starten“ öffnet
ausdrücklich eine neue Shell. „Verbindung prüfen“ schließt das Panel und
startet für Administratoren den Test der gespeicherten Verbindung, bei einem
Arbeitsbereich dessen Prüfung. Die Terminalfläche bleibt in beiden
Pages-Themes dunkel, mit eigenen semantischen Farb-Tokens.

## Transport und Zugriffsprüfung

Die Konsole öffnet einen eigenen Shell-Kanal über den bestehenden
PAGE-138-Control-Socket. Sie verwendet dessen isolierte SSH-Optionen und
fest bestätigten Hostschlüssel. Ohne Control-Socket sind sämtliche
Authentifizierungsmethoden des Kanalprozesses deaktiviert. OpenSSH-Escapes
sind deaktiviert, damit Terminaleingaben keinen lokalen Shell-Ausbruch
auslösen. Zugangsdaten gelangen weder in Kanalargumente noch in Antworten.

Die Shell startet über `/bin/sh`, damit die Login-Shell des Benutzers eine
beliebige Syntax haben darf. Ist auf dem Host weder `LC_ALL`, `LC_CTYPE` noch
`LANG` gesetzt und gibt es dort `C.UTF-8`, setzt dieser Start `LANG=C.UTF-8`,
weil das Browser-Terminal nur UTF-8 spricht. Einstellungen des Systems oder
der Startdateien des Benutzers gelten weiter; auf dem Host wird nichts
geändert. Lehnt der Host ein Terminal ab („PTY allocation request failed“),
beendet Pages den Kanal und meldet „Terminal nicht verfügbar“. Als verbunden
gilt eine Shell erst nach ihrer ersten Ausgabe.

Jeder Öffnungs- und Wiederverbindungsversuch prüft die aktuelle
Abteilungsmitgliedschaft, bei einem Arbeitsbereich auch Projektzugriff und das
kanonische Arbeitsverzeichnis. Eingabe, Resize und Ausgabestream prüfen
zusätzlich den Sitzungsbesitzer. Der Stream prüft Zugriffsrechte alle
15 Sekunden erneut. Ein Abteilungsentzug beendet die Shell beim nächsten
Aufruf oder dieser Prüfung. Direktaufrufe mit fremder Sitzung, fremder
Verbindung, ohne Mitgliedschaft oder ohne gleichen Ursprung werden abgelehnt.

Ausgaben laufen als gleichursprünglicher SSE-Stream, Eingaben und Resize als
gleichursprüngliche POST-Anfragen an
`/agents/workspaces/remote/connections/:connectionId/console` beziehungsweise
`/agents/workspaces/:workspaceId/console`. Eingaben werden geordnet übertragen
und nach einem Fehler niemals erneut gesendet. Ein kurzer Stream-Abbruch kann
anhand sequenzierter Ausgabeereignisse weitergeführt werden. Der Speicher
enthält höchstens 256 Ki Zeichen Ausgabe und Status; bei einer nicht mehr
rekonstruierbaren Lücke endet die Sitzung. Auf dem Server bleiben keine
Terminalprotokolle gespeichert.

Solange das Panel offen ist, pausiert das Hintergrund-Polling der
Verbindungstabelle. Die Konsole überwacht ihren Transport selbst, sodass ein
fehlgeschlagener Tabellen-Reload das Panel bei einer Netzstörung nicht ersetzt.
Jede Eingabe trägt außerdem die Nummer des aktuellen SSH-Verbindungsversuchs;
der Server weist verspätete Eingaben einer vorherigen Shell zurück.

## Wiederverbindung

Scheitert der Aufbau, bevor eine Shell lief, zeigt das Panel den Grund sofort
und wartet auf die Person. „Erneut verbinden“ und das Öffnen der Konsole
lösen genau einen sofortigen Versuch der gemeinsamen SSH-Verbindung aus, auch
mitten in deren eigener Wiederverbindungsserie; deren Obergrenze bleibt.

Ein verlorener SSH-Kanal einer laufenden Shell startet automatisch eine neue
Shell, keine Wiederaufnahme des vorherigen Programms. Pro Konsolensitzung sind
höchstens zehn Wiederverbindungsversuche im Abstand von drei Sekunden erlaubt,
auch bei manueller Wiederverbindung. Abweichende Hostschlüssel blockieren
sofort. Der Browser begrenzt auch Wiederverbindungen des Ausgabestreams auf
zehn. Ohne Lease-Erneuerung endet eine verlassene Konsole nach 60 bis
75 Sekunden. Pro Person sind drei, insgesamt 50 Konsolen gleichzeitig zulässig.

## Bibliotheken und Lizenz

- `@xterm/xterm` 6.0.0: etablierter VT-Terminalemulator mit Tastatur-,
  Steuerzeichen- und Screenreader-Unterstützung. Keine Interpretation von
  Remote-Ausgaben als HTML, keine Link- oder Clipboard-Erweiterung. Im
  Screenreader-Modus nimmt xterm reine Texteinfügungen ohne Tastenereignis
  (manche IME- und Emoji-Auswahlen) nicht an; Tastatur und Einfügen sind
  davon nicht betroffen.
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
