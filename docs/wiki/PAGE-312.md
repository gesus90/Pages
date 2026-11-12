# PAGE-312: Deaktivierbare Script-Schritte

Script-Nodes können einzeln deaktiviert werden. Ein deaktivierter Script-Node
startet keinen Prozess, gilt im Lauf als erfolgreich und liefert eine
konfigurierbare Ersatzausgabe. Damit lassen sich Scripts vorübergehend
abschalten, ohne die Flow-Struktur oder Bindings zu ändern.

## Konfiguration

| Feld             | Typ                        | Bedeutung                                                                 |
| ---------------- | -------------------------- | ------------------------------------------------------------------------- |
| `disabled`       | `boolean`, Standard false  | Der Schritt wird übersprungen und nicht ausgeführt.                       |
| `disabledOutput` | Text, max. 100.000 Zeichen | Ergebnis des übersprungenen Schritts; leer erzeugt einen Standardhinweis. |

Ein deaktiviertes Script ohne deklarierte Ausgabe liefert `null`. Mit
Ausgabe gilt folgende Reihenfolge:

1. Eine nicht-leere `disabledOutput` wird unverändert zurückgegeben.
2. Bei `report` oder `gate` ohne Ersatzausgabe wird ein fester, bestandener
   Bericht geliefert: `status: passed`, `summary` und Check
   `Übersprungen (deaktiviert)`.
3. Bei einer reinen Textausgabe ist das Ergebnis ein leerer String.

Für `report` und `gate` muss eine gesetzte Ersatzausgabe ein gültiger,
bestandener Bericht sein. Die Prüfung erfolgt nur, solange das Script
deaktiviert ist; die Längenbegrenzung gilt immer.

## Lauf

- Der Node wird vor jedem Dispatch übersprungen, auch bei einem Remote-Ziel.
- Das Ergebnis hat `status: succeeded` und `skipped: true`; es ist kein Fehler
  und keine Entscheidungs-Verzweigung.
- Ein deaktiviertes Script braucht weder Administratormodus noch ein
  aufgelöstes Interpreter-Profil, und es erzeugt keine
  Script-Runtime-Abhängigkeit. Ein Plan, der nur deaktivierte Scripts enthält,
  bleibt startbar.
- Deaktivierte Scripts werden in der Vorschau, bei Remote-Zielprüfungen und in
  der Ausführungsplanung wie nicht ausführbare Nodes behandelt.
- Ein vorhandenes Closeout muss für ein deaktiviertes Script nicht bestätigt
  sein; die übrige Ergebnisprüfung (sensible Ausgabe, Berichtsschema) bleibt
  aktiv.

## Oberfläche und API

- Der Script-Dialog zeigt die Checkbox „Deaktivieren“ und, bei gesetzter
  Ausgabe, das Feld „Ersatzausgabe“ mit Hinweis und Validierung.
- Die Karte auf dem Canvas zeigt `Script · Deaktiviert` und wird gedimmt; der
  Lauf zeigt die grüne Notiz „Übersprungen (deaktiviert)“.
- MCP akzeptiert `disabled` und `disabledOutput` in Script-Feldern;
  `read_plan_run` kennzeichnet übersprungene Schritte mit `skipped`.
- Gespeichert wird im bestehenden `plan_json`; eine Datenbankmigration ist
  nicht nötig.

## Abgrenzung

Nur Script-Nodes sind deaktivierbar. Agent-Nodes und bestehende Pläne ohne die
neuen Felder verhalten sich unverändert; `disabled` fehlt dort und bedeutet
false.
