# Bestandsaufnahme vor PAGE-157

Stand: `c766b0ae716c7f1a29dd610f73d5139b7e4f72c5`, 25.10.2026.
Diese Bestandsaufnahme beschreibt den unveränderten Ausgangsstand und die
vorgesehene Entfernung. Es wurde noch kein Anwendungscode geändert.

## Direkte Abhängigkeiten und Komposition

| Stelle                                      | Verwendung                                                                                               | Vorgesehene Behandlung                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`            | `@mastra/core` 1.74.0; transitive Provider-Verträge und Schema-Kompatibilität                            | Paket und ausschließlich dadurch benötigte Lockfile-Einträge entfernen. Gemeinsam benötigte Pakete bleiben.                                              |
| `backend/agents/providers/PicaApiModels.ts` | `ModelsDevGateway`, Provider-SDK-Modellauflösung, Credentials, Reasoning, Ausführungssperre              | Entfernen; nur der direkte Pica-API-Pfad verwendet diese Klasse.                                                                                         |
| `backend/service/chat/PicaApiService.ts`    | API-Modell, Agentenschleife, native Werkzeuge, Bilder und Antwortdateien                                 | Entfernen; ACP besitzt bereits eigene Ausführung, Inhalte und Antwortdateiverarbeitung.                                                                  |
| `app/lib/agent-services.server.ts`          | Erzeugt `PicaApiModels` und exportiert die Instanz                                                       | Diese Verdrahtung entfernen; übrige Verbindungs-, Katalog-, CLI- und Planservices erhalten.                                                              |
| `app/lib/chat-services.server.ts`           | Erzeugt API- und ACP-Service; setzt `mode: "native-api"`; API-Textausführung auch für Kontextverdichtung | API-Komposition entfernen; Pica über ACP. Kontextverdichtung nativer Sessions verständlich abweisen, keine direkte API als Ersatz.                       |
| `backend/service/chat/ChatService.ts`       | Gemeinsame Hülle mit `native-api`/`legacy-actions`; `submit` wählt API-Antwort oder ACP-Job; API-Bildtyp | API-Pfad und dessen Typen entfernen. ACP-Jobs, Wiederholungs-/Steering-Erkennung, Anhänge und Abbruch erhalten. Legacy-Pfad nicht als Ersatz aktivieren. |

Die direkten Imports von `@mastra/core` im Anwendungscode liegen vollständig in
`PicaApiModels.ts`, `PicaApiService.ts`, `RuntimeAgent.ts`,
`RuntimeToolRegistry.ts` und `RuntimeAcpModel.ts`. Kein Anwendungscode importiert
direkt ein Paket unter `@ai-sdk/`; der Gateway ist die SDK-Grenze. Die übrigen
API-Adapter sind eigene HTTP-Implementierungen, keine Gateway-SDK-Verwendung.

## Laufzeitschicht: nicht vollständig löschbar

| Datei unter `backend/agents/runtime/` | Tatsächliche Nutzer                                    | Vorgesehene Behandlung                                                                                                               |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `RuntimeAgent.ts`                     | `PicaApiService` und Runtime-Tests                     | Entfernen: Agentenschleife, RequestContext und SDK-Modelltypen gehören zum alten API-Pfad.                                           |
| `RuntimeAcpModel.ts`                  | Runtime-Tests                                          | Entfernen: ACP-Text als SDK-Modell ist kein produktiver Pica-ACP-Pfad.                                                               |
| `RuntimeAcpSession.ts`                | `RuntimeAcpModel` und Runtime-Tests                    | Entfernen: Hilfspfad für diesen Adapter; der produktive Scheduler bleibt.                                                            |
| `RuntimeApproval.ts`                  | Nur Runtime-Tests                                      | Entfernen: diese Hülle ist nicht der aktuelle Bestätigungsweg von Pica.                                                              |
| `RuntimeMemory.ts`                    | Nur Runtime-Tests                                      | Entfernen: kein produktiver Verwender; bestehende Chat-Repositories und `ChatContextService` bleiben.                                |
| `RuntimeExecutionContext.ts`          | API-Pfad, ACP, Planwerkzeuge, Adminwerkzeuge und Tests | Erhalten: serverseitige Identität, Eigentümerprüfung, Autorisierung und Abbruch. Kein Paketimport.                                   |
| `RuntimeToolRegistry.ts`              | API-Pfad sowie produktiver ACP-/MCP-Werkzeugpfad       | `describe`/`invoke`, Zod-Prüfung und Autorisierung erhalten; ausschließlich SDK-bezogene `bind`-/`createTool`-Verdrahtung entfernen. |
| `README.md`                           | Dokumentation von API-Runtime und ACP-Brücke           | Alten API-/SDK-Vertrag entfernen; verbleibende Werkzeug- und Kontextgrenzen zutreffend beschreiben.                                  |

Die produktiven Nutzer der zu erhaltenden Kontext-/Werkzeuggrenze sind:

- `backend/service/chat/acp/PicaAcpJob.ts`
- `backend/service/chat/acp/PicaAcpToolTurns.ts`
- `backend/service/chat/acp/PicaBridge.ts`
- `backend/service/chat/acp/PicaBridgeProtocol.ts`
- `backend/service/chat/PicaTools.ts`
- `backend/service/chat/PicaPlanTools.ts`
- `backend/service/chat/PicaPlanConfirmation.ts`
- `backend/service/chat/ChatToolExecutor.ts`
- `backend/service/chat/admin/PicaAdminTools.ts`
- `backend/service/chat/admin/PicaAdminService.ts`
- `backend/service/chat/admin/PicaAdminFiles.ts`
- `backend/service/chat/admin/PicaAdminBrowser.ts`
- `app/routes/pica-tools-api.ts`

`PicaAcpRunners.ts` unterstützt bereits `codex_cli`, `claude_code` und
`opencode`. `PicaAcpJob` verwendet den bestehenden Planexecutor, Scheduler,
Session- und Werkzeugpfad; die SDK-Textadaption ist dafür nicht erforderlich.
`PicaTools` und `PicaPlanConfirmation` enthalten weiterhin benötigte
Schreib-/Bestätigungsregeln. Sie dürfen nicht mit dem alten API-Dienst entfallen.

## API-Code, der andere Funktionen bedient

| Dateien / Bereich                                                                                                                             | Weitere Verwendung                                                                                          | Vorgesehene Behandlung                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ApiProviderRegistry.ts`, `OpenAiProvider.ts`, `AnthropicProvider.ts`, `GoogleAiStudioProvider.ts`, `OpenRouterProvider.ts`, `ZaiProvider.ts` | `AgentCheckService`: Zugangsprüfung und ausdrücklicher Modelltest                                           | Erhalten; z.ai-Endpunktwahl separat korrigieren.                                                                               |
| `ProviderContracts.ts`, `ProviderHttpClient.ts`, `ProviderResponses.ts`, `ProviderErrors.ts`                                                  | Prüfadapter; Header und Fehlerklassifikation zusätzlich im Modellkatalog                                    | Erhalten.                                                                                                                      |
| `ApiTextExecution.ts`, `TextProviderPayload.ts`, `TicketAssetPayload.ts`                                                                      | `AgentPlanExecution.run` und `agentChatExecution`; die bisherige Chat-Kontextverdichtung verwendet Letztere | Kein ausschließlich Pica gehörender Code. Nicht pauschal entfernen; bestehende API-Planknoten und deren Datenvertrag bewahren. |
| `ProviderReset.ts`                                                                                                                            | API-Ausführung sowie `AgentProviderFailure.ts` und damit CLI-/Plan-Fehlerauswertung                         | Erhalten.                                                                                                                      |
| `backend/agents/catalog/*`                                                                                                                    | Modellkatalog, Standardmodell und dessen Aktualisierung                                                     | Erhalten.                                                                                                                      |
| `AgentCredentialStore`, `OpenCodeCredentials`, `OpenCodeProviderKeys` und `OpenCodeProviderLinks`                                             | CLI-Umgebungen, Verknüpfung geprüfter API-Schlüssel, Katalog und Zugriffsprüfung für opencode               | Erhalten; z.ai-Providerwahl konsistent ergänzen.                                                                               |

`AgentPlanExecution` importiert weder das Paket noch die API-Runtime und
verwendet für CLI-Knoten `CliSessionExecution`. Es besitzt daneben einen
bestehenden direkten API-Zweig. Die Entfernung des Pica-API-Modus erlaubt
nicht, diesen unabhängig genutzten Zweig oder gespeicherte API-Planknoten
beiläufig zu entfernen. Eine weitergehende Bedeutung von „ausschließlich ACP“
für solche bestehenden Planknoten müsste vor einer Vertragsänderung geklärt
werden; dieses Ticket verlangt zugleich deren unveränderte Nutzbarkeit.

## Auswahl, Texte und Dokumentation

- `PicaSettingsService.ts`: Auswahl/Aktivierung, Migration älterer Chatprofile,
  Revisionen und Runnerprüfung. Aktuell werden API-Zugänge zugelassen.
  Zukünftig verfügbare API-Auswahl nur eindeutig und sichtbar nach opencode
  übernehmen; sonst gespeicherte Auswahl erhalten und Neuwahl verlangen.
- `pica-model-options.ts` und `pica-settings-card.tsx`: Pica-Auswahl zeigt
  gegenwärtig auch API-Zugänge und freie Zen-Modelle. Nur für Pica filtern;
  gemeinsame Agent-Plan-Kataloge unverändert erhalten. Gespeicherte, danach
  unzulässige Auswahl benötigt eine sichtbare Erklärung.
- `language/locales/de/translation.json` und
  `language/locales/en/translation.json`: API-/ACP-Hinweise, Pica-Auswahl,
  nicht mehr benötigte API-Modus-Texte und z.ai-Zugangsprüfungsbeschreibung
  konsistent anpassen. Allgemeine API-Verbindungstexte bleiben erforderlich.
- `backend/error/ChatErrors.ts`: `apiModeRequired` wird auch bei der
  Kontextverdichtung verwendet; beim Entfernen dessen komplette Fehlerführung
  und Übersetzungen berücksichtigen.
- Alle bisherigen Dokumentations-/Kommentarreferenzen außerhalb der obigen
  Runtime-Dateien: `README.md`, `definition/AgentPlanRecovery.ts`,
  `backend/service/agents/recovery/README.md` und
  `backend/service/agents/sessions/PageAgentCliSessions.md`. Historische
  Integrationsannahmen durch den tatsächlichen ACP-Stand ersetzen.
- `backend/agents/acp/OpenCodeAcpCapabilities.md` beschreibt die
  Schlüsselverknüpfung einschließlich des bisher festen z.ai-Providers und
  muss bei dessen Änderung aktualisiert werden.

## z.ai im Ausgangsstand

`definition/AgentConnection.ts` setzt `OPENCODE_LINKED_PROVIDERS.zai` fest auf
`zai` und den direkten Endpunkt fest auf `https://api.z.ai/api/paas/v4`.
`ZaiProvider` schließt den Coding-Plan-Endpunkt ausdrücklich aus und prüft
`glm-4.7-flash`. `supportsModelCatalog` in `AgentModelCatalog.ts` schließt z.ai
vom direkten Katalog aus. `OpenCodeProviderKeys.read` übernimmt die feste
Provider-ID. Es gibt an diesen Grenzen noch keine Kontoartwahl.

Damit ist eine fehlende Coding-Plan-Unterscheidung im Code belegt. Ein
aktueller Anbieterfehler oder die Verfügbarkeit von `glm-5.3-flash` ist damit
ausdrücklich nicht live belegt. Die verlangte CLI-Katalogprüfung und der
freigegebene Modellaufruf wurden vor dem unten beschriebenen Blocker nicht
ausgeführt. Kein Schlüssel wurde gelesen, kopiert oder ausgegeben.

## Vorhandene Tests und echter Auftragskonflikt

Der Auftrag verbietet neue oder geänderte automatisierte Tests, Fixtures,
Mocks und Harnesses und erlaubt lediglich eine zwingend erforderliche minimale
Anpassung einer bestehenden Assertion. Gleichzeitig fordert er vollständiges
Löschen von Paket und ausschließlich dafür vorhandenem Code sowie einen
grünen TypeScript-Check. Folgende vorhandenen Dateien sind davon betroffen:

- `tests/backend/backend/agents/runtime/runtime-agent.unit.test.ts` importiert
  in Zeile 1 `RequestContext` direkt aus `@mastra/core/request-context` und
  prüft tatsächliche `generate`-/`stream`- und Approval-Semantik des Pakets.
- `tests/backend/backend/agents/runtime/runtime-acp.unit.test.ts` importiert
  `RuntimeAcpModel`, `RuntimeAcpSession` und `RuntimeAgent`.
- `tests/backend/backend/agents/runtime/runtime-context-memory.unit.test.ts`
  prüft den ausschließlich dort verwendeten `RuntimeMemory` neben dem weiter
  benötigten Ausführungskontext.
- `tests/backend/backend/agents/runtime/runtime-approval.unit.test.ts`
  instanziiert den ausschließlich dort verwendeten `RuntimeApproval`.
- `tests/backend/backend/agents/runtime/runtime-fixture.ts` verwendet den
  Modellvertrag der zu entfernenden SDK-Adaption.
- `tests/backend/backend/agents/providers/page83-pica-models.unit.test.ts`
  instanziiert `PicaApiModels`.
- `tests/backend/backend/service/chat/page83-pica-fixture.ts` importiert und
  instanziiert `PicaApiService`, dessen Eingabetyp und `PicaApiModels`.
- `tests/backend/backend/service/chat/page83-pica-native.unit.test.ts` nutzt
  diese API-Fixture und den SDK-Modellstrom.
- `tests/backend/backend/service/chat/page83-pica-chat.unit.test.ts` nutzt
  dieselben Grenzen und konstruiert `mode: "native-api"`.
- `tests/backend/backend/service/chat/page83-pica-composition.unit.test.ts`
  injiziert `PicaApiModels` und verlangt ausdrücklich den alten produktiven
  API-Pfad. Der zweite Test verlangt die Ablehnung von ACP im synchronen
  API-Pfad, nicht einen live geprüften produktiven ACP-Job.
- `tests/backend/backend/service/chat/page103-execution-limits.unit.test.ts`
  hängt ebenfalls an der API-Fixture und deren SDK-Modellstrom.
- `tests/backend/backend/service/chat/acp/page68-pica-bridge.unit.test.ts`
  verwendet den weiterhin erforderlichen Kontexttyp; dieser Nutzer allein
  verhindert keine Entfernung der SDK-Abhängigkeit.

`tsconfig.json` schließt das gesamte Verzeichnis `tests` ein. Unveränderte
Imports auf gelöschte Module erzeugen daher Compilerfehler. Auch wenn eine
zufällig noch installierte Paketkopie einen Paketimport lokal auflösen könnte,
wäre das kein gültiger Ersatz für ein korrektes Manifest und Lockfile und
würde die Forderung nach keinerlei verbleibenden Referenzen verletzen.

Das ist keine durch eine einzelne Assertion lösbare Anpassung. Tests
auszuschließen, Dummy-Kompatibilitätsmodule anzulegen, die alte Bibliothek nur
für Tests zu behalten oder den Agentenloop nachzubauen würde jeweils andere
verbindliche Regeln verletzen. Deshalb bleibt Anwendungscode unverändert und
die Ausführung endet nach Bestandsaufnahme, Sicherung und Abschluss-Gates
mit dokumentiertem Blocker.

Erforderliche Auftragsklärung für eine Fortsetzung: gezielte Entfernung der
Tests für tatsächlich entfernte API-/SDK-Verträge und gezielte Anpassung
gemeinsam genutzter Tests/Fixtures an die verbleibende ACP-Grenze ausdrücklich
zulassen, oder den Umfang der Entfernung ausdrücklich einschränken. Das ist
keine Freigabe, bestehende Tests lediglich zum Bestehen zu schwächen.
