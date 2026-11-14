import { AGENT_PLAN_COMMAND_OPERATIONS } from "@/definition/AgentPlanOperations";
import { CHAT_AGENT_WRITE_OPERATIONS } from "@/definition/ChatAgentOperations";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";

import {
  CHAT_ADMIN_OPERATIONS,
  isChatAdminWriteOperation,
  requiresChatAdminConfirmation,
} from "./ChatAdministrationCatalog";
import { PICA_CALENDAR_WRITE_OPERATIONS } from "./PicaCalendarToolService";

import type {
  AgentAdminReadOperation,
  AgentAdminWriteOperation,
} from "@/definition/AgentAdministration";
import type { AgentExtensionReadOperation } from "@/definition/AgentExtensions";
import type { ChatInstanceOperation } from "@/definition/ChatInstanceAdministration";
import type { AgentProjectDeletionWriteOperation } from "@/definition/AgentProjectDeletion";
import type {
  AgentPlanCommandOperation,
  AgentPlanReadOperation,
  AgentPlanWriteOperation,
} from "@/definition/AgentPlanOperations";
import type { AgentTextRangeWriteOperation } from "@/definition/AgentTextRange";
import type { AgentWorkspaceWriteOperation } from "@/definition/AgentWorkspaceOperations";
import type { ChatAgentWriteOperation } from "@/definition/ChatAgentOperations";
import type {
  PageAgentReadOperation,
  PageAgentWriteOperation,
} from "@/definition/PageAgentOperations";
import type {
  PagesAgentCommentOperation,
  PagesAgentReadOperation,
  PagesAgentTicketReadOperation,
} from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteOperation } from "@/definition/PagesAgentWrites";
import type {
  AutomationReadOperation,
  AutomationWriteOperation,
} from "@/definition/AutomationOperations";
import type { PicaCalendarOperation } from "./PicaCalendarToolService";

/**
 * Operations of the agent API that the chat never offers: imports and uploads
 * need files and a credential; workspace registry and permanent project
 * deletion are not offered in chat. Range patches are excluded because chat
 * reads and writes whole texts.
 */
type ExcludedOperation =
  | "wiki.import.plan"
  | "wiki.import.apply"
  | "wiki.import.update"
  | "import.structured.apply"
  | "assets.upload.prepare"
  | "chat.sessions.delete"
  | AgentTextRangeWriteOperation
  | AgentWorkspaceWriteOperation
  | AgentProjectDeletionWriteOperation;

/** A Pages operation the chat agent may request (T6.12.5). */
export type ChatOperation = Exclude<
  | PagesAgentReadOperation
  | PagesAgentTicketReadOperation
  | PagesAgentCommentOperation
  | AgentExtensionReadOperation
  | PagesAgentWriteOperation
  | AgentAdminReadOperation
  | AgentAdminWriteOperation
  | ChatInstanceOperation
  | PageAgentReadOperation
  | PageAgentWriteOperation
  | AgentPlanReadOperation
  | AgentPlanWriteOperation
  | AgentPlanCommandOperation
  | ChatAgentWriteOperation
  | AutomationReadOperation
  | AutomationWriteOperation
  | PicaCalendarOperation
  | "ticket.archive"
  | "ticket.restore",
  ExcludedOperation
>;

const PAGE = "pageId, cursor?, limit?";
const PROJECT = "projectId, cursor?, limit?";
const WINDOW = "cursor?, limit?";
const CONFIRMED = "Bestätigung der Person nötig";
const PLAN_TARGET = "planId, expectedRevision";
const RUN =
  "runId | planId + select: latest|first; runId optional mit planId zur Prüfung";
const SCRIPT_FIELDS =
  "interpreterProfileId?, content?, inputs?: [{name, type: text, isRequired}], outputs?: [{name, type: text}], timeoutSeconds?, disabled?, disabledOutput?";
const CHANGES = `placeNode(nodeId, groupId|null, x, y), placeLoopNode(nodeId, loopId|null, x, y), ungroup(nodeId, positions), insertTemplate(templateId, x, y) und changes?: [{action: addNode, node: {type: start|end|agent|script|task|parameter|group|loop|stack|decision, id?, x?, y?, agentId?, personalAgentId?, executionTarget?, configuration?: {connectionId, model, reasoningEffort?, template?: {markdown?, parameters?, directoryParameter?, run?}}, instruction?, taskId?, name?, format?, value?, runs?, runsSource?, countMode?, sessionPolicy?, condition?, mode?, question?, model?, output?, cases?, input?, ${SCRIPT_FIELDS}}} | {action: updateNode, nodeId, fields: {x?, y?, agentId?, personalAgentId?, executionTarget?, configuration?: {connectionId, model, reasoningEffort?, template?: {markdown?, parameters?, directoryParameter?, run?}}, instruction?, taskId?, name?, format?, value?, runs?, runsSource?, countMode?, sessionPolicy?, condition?, mode?, question?, model?, output?, cases?, input?, ${SCRIPT_FIELDS}}} | {action: removeNode, nodeId} | {action: connect|disconnect, from, to, fromPort?, toPort?} (ohne Ports Ablaufkante; mit beiden Ports wie im Editor: true-out|false-out|case:<id> einer Entscheidung → flow-in, passed-out eines Agents → condition-in einer Entscheidung, value-out eines Boolean-Parameters, Tickets, Agents oder Scripts → condition-in einer Entscheidung (Dateneingang; Decision mode boolean|model, question, model, output boolean|classification, cases [{id, name}]), value-out → event-in eines Agents, value-out eines Ticket- oder Parameter-Nodes → flow-in eines Stacks als Eintrag, flow-out → flow-in; disconnect mit Ports entfernt genau diese Kante) | {action: bind, nodeId, parameter, binding: {kind: source, nodeId}|{kind: result|previous, stepId}|{kind: literal, value}} | {action: unbind, nodeId, parameter}]`;

const AUTOMATION_TARGET = "automationId, expectedRevision";

/** The automations of PAGE-297; every call uses the rights of the account itself. */
const CHAT_AUTOMATION_OPERATIONS: Readonly<
  Record<AutomationReadOperation | AutomationWriteOperation, string>
> = {
  "automations.options.read":
    "{} erlaubte Auslöser und Aktionen (Skript nur für Administratoren), JSON-Schemas, Grenzen, Zeitzonen, wählbare Agents, Pläne mit Schritten, Projekte mit Status und Freigabeziele lesen",
  "automations.list":
    "{cursor?, limit?, text?, isActive?} sichtbare Automationen mit Auslöser, Aktion, Freigabe, nächstem und letztem Lauf und permissions auflisten",
  "automations.read":
    "{automationId} sichtbare Automation mit revision lesen; Skript-Inhalt nur für Ersteller und Administratoren",
  "automations.runs.list":
    "{automationId, cursor?, limit?} Läufe einer Automation, neueste zuerst: status queued|accepted|delivered|completed|failed und result",
  "automations.runs.read":
    "{automationId, runId} einen Lauf mit Schlussantwort, Ausgabe, Fehler, Auslöserdaten und Zustellungen an Agents lesen",
  "automations.create":
    "{name, trigger, action, sharing?, isActive?, deleteAfterSuccess?, agentNotification?} Automation des eigenen Kontos anlegen; trigger manual|once{at, timeZone}|interval{every, unit, timeZone, weekdays?, window?}|weekly{weekdays, times, timeZone, window?}|event{eventType, planId?, stepId?, projectId?, statusId?}; action agent{agentId, instruction}|script{workspaceId, interpreterProfileId, content, timeoutSeconds, forward?}|plan{planId}",
  "automations.update": `{${AUTOMATION_TARGET}, name?, trigger?, action?, sharing?, isActive?, deleteAfterSuccess?, agentNotification?} Automation patchen; enthaltene Objekte werden ganz ersetzt`,
  "automations.setActive": `{${AUTOMATION_TARGET}, isActive} Automation ein- oder ausschalten; einmalige brauchen zum Einschalten eine künftige Zeit`,
  "automations.run": `{${AUTOMATION_TARGET}} jetzt ausführen; liefert nur den angenommenen oder vorgemerkten Lauf, nicht sein Ergebnis`,
  "automations.delete": `{${AUTOMATION_TARGET}} Automation samt Verlauf löschen; ein laufender oder vorgemerkter Lauf verhindert es, ${CONFIRMED}`,
};

const CALENDAR_TARGET =
  "id (Eintrags- oder Termin-ID), scope: this|following|all, occurrenceStart?";

/** The calendar of PAGE-301; every call uses the calendar rights of the account itself. */
const CHAT_CALENDAR_OPERATIONS: Readonly<
  Record<PicaCalendarOperation, string>
> = {
  "calendar.read":
    "{from, to} Kalendereinträge eines Zeitraums von höchstens 92 Tagen mit Zusagen und Zeitzone lesen",
  "calendar.invitees.search":
    "{query, limit?} einladbare Personen, Agents, Gruppen und Abteilungen suchen",
  "calendar.event.create":
    "{title, start, end, allDay, description?, calendarProjectId?, invitees?, recurrence?} Termin mit Wiederholung und Einladungen anlegen",
  "calendar.event.update": `{${CALENDAR_TARGET}, title?, description?, start?, end?, allDay?, calendarProjectId?, invitees?, recurrence?} Termin oder Teil einer Serie ändern`,
  "calendar.event.respond":
    "{id, response: accepted|declined} Einladung zusagen oder absagen",
  "calendar.event.delete": `{${CALENDAR_TARGET}, confirmed?} Termin oder Teil einer Serie löschen; ohne confirmed nur Vorschau, ${CONFIRMED}`,
};

/**
 * Parameters and purpose of every chat operation, as the agent reads them.
 *
 * @remarks
 * The record names every operation the type allows, so an operation added to
 * the agent API cannot reach the chat without a description here. Pages adds
 * `operationId` and the confirmation itself.
 */
const CHAT_OPERATIONS: Readonly<Record<ChatOperation, string>> = {
  ...CHAT_ADMIN_OPERATIONS,
  ...CHAT_AUTOMATION_OPERATIONS,
  ...CHAT_CALENDAR_OPERATIONS,
  "agents.list":
    "{cursor?, limit?} sichtbare Benutzer-Agents mit Anweisung, Parametern und Konfiguration auflisten",
  "agents.read":
    "{agentId} sichtbaren Benutzer-Agent mit instruction (AGENT.md-Anweisung), parameters, run, Modell, Freigabe, canEdit und revision lesen",
  "agents.models.list":
    "{} aktuell für die Person freigegebene Modelle, Standardmodell und Reasoning-Stufen lesen",
  "agents.create":
    "Abgelöst: Modelle und Anweisungen direkt über plans.create/plans.update am Node konfigurieren.",
  "agents.update":
    "Abgelöst: bestehende Anweisungen bleiben lesbar, Änderungen gehören in den Plan-Node.",
  "agents.clone": "Abgelöst: einen Node oder eine Plan-Vorlage kopieren.",
  "agents.delete":
    "Abgelöst: Altbestände bleiben erhalten; Node-Entfernung erfolgt im Plan.",
  "plans.capabilities.read":
    "{} Planvertragsversion und implementierte persönliche Operationen lesen; keine Rechtefreigabe",
  "plans.run.recovery.read":
    "{planId, runId} Recovery-, Neustart- und Freigabemöglichkeiten sowie Sperrgründe eines Runs lesen (Aktionen bietet nur dem Starter an); Recovery-Fortsetzung ist kein Pause-Resume",
  "plans.run.diagnostics.read":
    "{planId, runId, stepId, loopId?, iteration?, cursor?, maxBytes?} berechtigte Diagnose eines eigenen Versuchs mit getrennten Ausgaben und Vollständigkeit lesen; große Ergebnisse mit Cursor zusammensetzen",
  "plans.run.session.events.read":
    "{planId, runId, stepId, attemptId, after?, before?, limit?, cursor?, maxBytes?} berechtigte gespeicherte ACP-Ereignisse des eigenen Versuchs lesen; keine Sitzungssteuerung",
  "plans.run.checkpoint.read":
    "{planId, runId, version?, cursor?, maxBytes?} berechtigten unveränderlichen Checkpoint des eigenen Runs lesen; große Ergebnisse mit Cursor zusammensetzen und checkpoint.content als JSON parsen",
  "plans.runs.search":
    "{projectId?, planId?, status?, stepId?, errorClass?, startedById?, from?, to?, cursor?, limit?} Läufe aller sichtbaren Pläne (egal wer sie gestartet hat) mit Starter, Fehlerklasse und Fehlercode filtern und seitenweise lesen",
  "plans.runs.failures":
    "{projectId?, planId?, from?, to?, groupBy?: errorClass|plan|step, limit?} fehlgeschlagene Schritte nach Fehlerklasse, Plan oder Schritt zählen, mit erstem und letztem Auftreten, Beispiel-Läufen und Hinweis",
  "plans.run.timeline.read":
    "{runId} Zeitachse eines Laufs je Schritt und Versuch (gestartet, wartend mit Grund, wiederholt, pausiert, beendet, Dauer) und Schritte ohne Fortschritt lesen",
  "plans.run.logs.read":
    "{runId, stepId?, attemptId?, level?: debug|info|warn|error, from?, to?, cursor?, limit?} Logs eines Laufs oder Schritts ohne Zugangsdaten lesen",
  "plans.run.recovery.release":
    "{planId, runId, expectedRecoveryRevision} auf ausdrücklichen Auftrag die Restprozesse des eigenen Runs bereinigen und bestätigte Reservierungen freigeben; startet keinen Lauf",
  "plans.run.recovery.restart":
    "{planId, runId, expectedRecoveryRevision, expectedPlanRevision, confirmRepeat} nach ausdrücklichem Auftrag und Hinweis auf alle wiederholten Schritte einen verknüpften neuen Lauf von Start beginnen",
  "plans.run.recovery.resume":
    "{planId, runId, expectedRecoveryRevision, expectedPlanRevision, mode, reviewedStepIds} nach ausdrücklichem Auftrag und Prüfung möglicher Nebenwirkungen einen verknüpften neuen Lauf am verifizierten Zustand fortsetzen",
  "plans.clone":
    "{planId, expectedRevision, name, workspaceId?, executionTarget?, oneShot?, ownerId?, teams?} jeden sichtbaren Plan in aktueller Revision kopieren; fremden Workspace ersetzen, nicht nutzbare Verweise leeren und alte Formen bereinigen. adjustments nennt die Anpassungen. Namen bekommen bei Bedarf eine Zahl. Personen in teams können nur lesen; ownerId setzt nur ein Admin. Ohne teams gilt die Vorgabe beim Anlegen. Keine zusätzlichen alten Freigaben, Historie, Dateien, Zugangsdaten oder Ausführung kopieren.",
  "plans.templates.list": "{workspaceId} sichtbare Node-Vorlagen lesen",
  "plans.templates.read":
    "{workspaceId, templateId} eine sichtbare Node-Vorlage lesen",
  "plans.control.read": "{planId} aktuell erlaubte Laufaktionen lesen",
  "plans.templates.save":
    "{planId, expectedRevision, nodeId, name} eine Node-Vorlage speichern, ohne Ausführung",
  "plans.templates.update":
    "{workspaceId, templateId, name?, planId?, nodeId?} eigene Node-Vorlage umbenennen (name) und/oder ihren Knoten durch den Knoten nodeId des gespeicherten Plans planId ersetzen (Recht zum Ändern des Plans nötig); Freigabe bleibt, eingefügte Kopien bleiben unverändert",
  "plans.templates.delete":
    "{workspaceId, templateId} eigene Node-Vorlage löschen; eingefügte Kopien in Plänen bleiben; exakte Vorlage lesen und nur auf ausdrückliche aktuelle Bitte löschen",
  "plans.delete":
    "{planId, expectedRevision} eigenen Plan löschen, wenn kein Run aktiv ist; exaktes Ziel lesen und nur auf ausdrückliche aktuelle Bitte löschen",
  "plans.keep":
    "{planId, expectedRevision} auf ausdrücklichen Auftrag einen Einmal-Plan behalten: geplantes Löschen abbrechen und oneShot entfernen",
  "plans.play":
    "{planId, expectedRevision} gespeicherte Revision ausdrücklich starten; einzige Ablaufbedingung Start→End verbunden, fehlende Werte nur Warnung, freie Knoten werden übersprungen",
  "plans.pause": "{planId, expectedRevision, runId} eigenen Run pausieren",
  "plans.resume":
    "{planId, expectedRevision, runId} eigenen pausierten Run fortsetzen",
  "plans.stop": "{planId, expectedRevision, runId} eigenen Run stoppen",
  "plans.list": `{text?, projectId?, ${WINDOW}} sichtbare Agent Plans nach Name mit Projekt, team (Abteilung des Plans), Freigabe, canEdit, revision, state (idle|running|pausing|paused|stopping) und latestRun, oneShot und scheduledDeletionAt (Einmal-Plan wird fünf Minuten nach einem erfolgreichen Lauf gelöscht); text sucht im Namen`,
  "plans.read":
    "{planId, cursor?, maxBytes?} Agent Plan lesen; über 64 KiB als chunk mit text, Byte-Offsets, SHA-256 und nextCursor (als cursor fortsetzen), höchstens 1 MiB insgesamt; nach Änderung neu lesen. Kleine Antworten mit nodes (label, Agent, Script, Ticket, Parameter, bindings), edges (Ablauf from → to), Freigabe, revision und status (state, runCount, latestRun, isRunnable, issues, warnings) lesen; warnings nennen Knoten und Feld und blockieren Starten nicht",
  "plans.sources.read":
    "{workspaceId?} Arbeitsbereiche für neue Pläne; mit workspaceId auch die Agents mit ihren Parametern für Agent-Nodes und die Interpreterprofile (id, name, status, version) für Script-Nodes",
  "plans.runs.list": `{planId, order?: newest|oldest, ${WINDOW}} eigene Runs eines Plans mit runId, planId, startedAt und status, seitenweise (Standard 20 pro Seite)`,
  "plans.run.read": `{${RUN}} einen eigenen Run mit Start, Ende, Status und Status jedes Nodes lesen`,
  "plans.run.reports.read": `{${RUN}, stepId?} Berichte eines eigenen Runs lesen: je Node runId, stepId, Ausführungsstatus, Ergebnis, Fehler, Fortschritt, Kriterien und Todos`,
  "plans.create": `{name, workspaceId, oneShot?, sharing?: {scope: private|global|restricted, operator?, groupIds?, departmentIds?}, ${CHANGES}} Agent Plan anlegen; gehört dem Team der Abteilung der Person (Mitglied oder Leiter, nur bei genau einer Abteilung), ohne Freigabe sonst privat`,
  "plans.update": `{${PLAN_TARGET}, name?, sharing?, workspaceId?, oneShot?, ${CHANGES}} Struktur, Name, Freigabe oder Arbeitsbereich eines Plans ändern (Eigentümer oder Mitglied/Leiter des Teams; ein anderer Arbeitsbereich nur im Projekt des Plans, ein anderes Projekt nur der Eigentümer); alle changes gelten zusammen oder gar nicht`,
  "plans.parameter.create": `{${PLAN_TARGET}, name, value: {type: text, text}|{type: number, number}|{type: ticket, ticketId}|{type: workspace, workspaceId}|{type: wiki, pageId}, format?: string|number|json|boolean, x?, y?} Parameter-Node anlegen`,
  "plans.parameter.update": `{${PLAN_TARGET}, parameterId, name?, value?, format?, x?, y?} Parameter-Node ändern`,
  "plans.parameter.remove": `{${PLAN_TARGET}, parameterId} Parameter-Node samt seinen Datenverbindungen entfernen`,

  "projects.list":
    "{} sichtbare Projekte mit ID, Name und Status, nach Namen sortiert",
  "projects.resolve": "{name} Projekt über den exakten Namen finden",
  "projects.read": "{projectId} Projekt lesen",
  "projects.members.read": `{${PROJECT}} Mitglieder und Abteilungen eines Projekts`,
  "projects.activity.read": `{${PROJECT}} Aktivitätsverlauf eines Projekts`,
  "projects.tickets.list": `{${PROJECT}} Tickets eines Projekts`,
  "projects.create":
    "{name, description, status: planned|active|paused|completed, departmentIds: []} Projekt anlegen",
  "projects.setName": "{projectId, name} Projekt umbenennen",
  "projects.setDescription":
    "{projectId, description} Projektbeschreibung setzen",
  "projects.setStatus":
    "{projectId, status: planned|active|paused|completed} Projektstatus setzen",
  "projects.setDates":
    "{projectId, startDate: YYYY-MM-DD|null, targetDate: YYYY-MM-DD|null} Projektzeitraum setzen",
  "projects.member.assign":
    "{projectId, targetType: person|group|department, targetId, role: manager|member|viewer} Projekt zuweisen",
  "projects.member.remove":
    "{projectId, targetType: person|group|department, targetId} Zuweisung entfernen",
  "departments.list": `{${WINDOW}} sichtbare Abteilungen`,
  "groups.list": `{${WINDOW}} sichtbare Gruppen`,
  "people.visible.list": `{${WINDOW}} sichtbare Personen mit Abteilung und Gruppe`,
  "wiki.tree.read": `{projectId?, ${WINDOW}} Seitenbaum des Wikis`,
  "wiki.search": `{text, projectId?, ${WINDOW}} Wiki durchsuchen`,
  "wiki.page.read":
    "{pageId} Seite mit Markdown, revision, icon, cover und anchors lesen",
  "wiki.outline.read": `{${PAGE}} Überschriften einer Seite`,
  "wiki.links.read": `{${PAGE}} Verweise und Rückverweise einer Seite`,
  "wiki.page.create":
    "{projectId|null, scope?: project|instance|private, parentId|null, title, content, icon|null, assetIds: []} Seite anlegen",
  "wiki.page.setTitle": "{pageId, expectedRevision, title} Seitentitel ändern",
  "wiki.page.setContent":
    "{pageId, expectedRevision, content} Seiteninhalt (Markdown) ersetzen",
  "wiki.page.setIcon":
    "{pageId, expectedRevision, icon|null} Seitensymbol setzen",
  "wiki.page.setCover":
    "{pageId, cover: {kind: preset, preset: sunrise|ocean|forest|dusk|slate|sand}|{kind: attachment, attachmentId}|null} Seitencover setzen oder entfernen, ohne Revision",
  "wiki.page.move":
    "{pageId, expectedRevision, projectId|null, scope?: project|instance|private, parentId|null, beforeId|null} Seite verschieben",
  "wiki.page.delete": `{pageId, expectedRevision} Seite samt Unterseiten in den Papierkorb, ${CONFIRMED}`,
  "wiki.comments.read": `{${PAGE}} Kommentare einer Seite`,
  "wiki.comment.add": "{pageId, body, parentId?, quote?} Kommentar anlegen",
  "wiki.comment.edit": "{commentId, body} Kommentar ändern",
  "wiki.comment.resolve":
    "{commentId, resolved: true|false} Kommentar auflösen",
  "wiki.comment.delete": `{commentId} Kommentar löschen, ${CONFIRMED}`,
  "ticket.read":
    "{ticketId} Ticket mit möglichen Status, Tags, Verknüpfungen und descendantCount lesen (ID oder Schlüssel)",
  "ticket.checklist.read":
    "{ticketId} Checkliste eines Tickets lesen: Abnahmekriterien und Aufgabenpunkte der Beschreibung mit ID, Text, checked, Reihenfolge, Ebene und Revision",
  "ticket.checklist.setItem":
    "{ticketId, itemId, checked: true|false, expectedRevision} einen Checklisteneintrag gezielt setzen; nur dieser Eintrag ändert sich",
  "ticket.checklist.setItems":
    "{ticketId, expectedRevision, items: [{itemId, checked: true|false}]} mehrere Checklisteneinträge gemeinsam und atomar setzen (die gelesene Liste dient als Vorlage); nur die genannten Einträge ändern sich, Ergebnis ist die vollständige Checkliste mit neuer Revision",
  "ticket.create":
    "{projectId?, type: initiative|epic|task|subtask, title, description, statusId|null, parentId|null, milestoneId?|null, departmentId?|null, assignee?: {targetType: person|group|none, targetId|null}} Ticket anlegen; Projekt, Meilenstein und Abteilung kommen vom Elternticket, Bearbeitung ist ohne Angabe die anlegende Person",
  "tickets.search": `{projectId, text?, type?: initiative|epic|task|subtask, statusId?, parentId?, milestoneId?, departmentId?, assigneeId?, assigneeGroupId?, tagIds?: [], archived?: boolean (Standard false; true nur archivierte), ${WINDOW}} Tickets eines Projekts nach Schlüssel, Titel und Beschreibung suchen und filtern`,
  "tickets.tree.read": `{projectId?, ticketId?, ${WINDOW}} Hierarchie eines Projekts oder Pfad und Unterbaum eines Tickets, nur sichtbare Tickets`,
  "tickets.links.read": `{ticketId, ${WINDOW}} Verknüpfungen blocks, relates_to und duplicates eines Tickets mit Richtung`,
  "assignment.targets.search": `{text?, targetType?: person|group|department, projectId?, ${WINDOW}} sichtbare Zuweisungsziele suchen; mehrdeutige Namen werden nie automatisch aufgelöst`,
  "tickets.link.add":
    "{ticketId, targetTicketId, linkType: blocks|relates_to|duplicates} Verknüpfung vom Ticket zum Zielticket anlegen",
  "tickets.link.remove":
    "{ticketId, linkId} Verknüpfung aus tickets.links.read entfernen",
  "ticket.setTitle": "{ticketId, expectedTitle, title} Tickettitel ändern",
  "ticket.setDescription":
    "{ticketId, expectedDescription, description} Ticketbeschreibung ändern",
  "ticket.setStatus":
    "{ticketId, expectedStatusId, statusId} Ticketstatus ändern",
  "ticket.setParent":
    "{ticketId, expectedParentId|null, parentId|null} Elternticket setzen",
  "ticket.setAssignee":
    "{ticketId, targetType: person|group|department|none, targetId|null, expectedAssigneeId|null, expectedAssigneeGroupId|null, expectedDepartmentId?} Bearbeitung zuweisen",
  "ticket.assignMilestone":
    "{ticketId, milestoneId|null, expectedMilestoneId|null} Meilenstein zuordnen",
  "ticket.delete": `{ticketId} Ticket samt Unterelementen in den Papierkorb (Anzahl vorher aus descendantCount), ${CONFIRMED}`,
  "ticket.archive":
    "{ticketId, children?: include|keep, confirmed?: boolean} erst ohne confirmed die betroffenen Schlüssel und Titel lesen, der Person zeigen und bestätigen lassen; dann mit confirmed: true archivieren. Standard include; keep ist für Aufgaben abgelehnt. Archivrecht des Projekts nötig",
  "ticket.restore":
    "{ticketId} archiviertes Ticket samt Unterelementen mit Archivrecht wiederherstellen; Workflowstatus bleibt",
  "tags.list": `{${WINDOW}} Tag-Katalog; nur diese Tags lassen sich zuweisen`,
  "ticket.setTags":
    "{ticketId, tagIds: [], expectedTagIds: []} Tags eines Tickets setzen, nur Tags des Katalogs",
  "ticket.setDepartments":
    "{ticketId, departmentIds: [], expectedDepartmentIds: []} Abteilungen eines Tickets setzen; leere Liste = sichtbar für das ganze Projekt",
  "milestone.initiative.add":
    "{projectId, milestoneId, initiativeId} Initiative mit Meilenstein verknüpfen",
  "milestone.initiative.remove":
    "{projectId, milestoneId, initiativeId} Verknüpfung entfernen, solange nichts unter der Initiative den Meilenstein nutzt",
  "wiki.page.setAnchors":
    "{pageId, anchors: [{kind: department|milestone|epic, targetId}], expectedAnchors: []} Seite mit Abteilungen, Meilensteinen oder Epics verknüpfen",
  "milestones.read": `{${PROJECT}} Meilensteine mit Abhängigkeiten, Initiativen und Wiki-Seiten`,
  "milestone.create":
    "{projectId, name, description, startAt|null, dueAt|null} Meilenstein anlegen",
  "milestone.setName":
    "{milestoneId, expectedName, name} Meilenstein umbenennen",
  "milestone.setDescription":
    "{milestoneId, expectedDescription, description} Meilensteinbeschreibung ändern",
  "milestone.setStatus":
    "{milestoneId, expectedStatus, status: open|completed|archived} Meilensteinstatus ändern",
  "milestone.setStartAt":
    "{milestoneId, expectedStartAt|null, startAt|null} Start setzen",
  "milestone.setDueAt":
    "{milestoneId, expectedDueAt|null, dueAt|null} Fälligkeit setzen",
  "milestone.dependency.add":
    "{projectId, sourceId, targetId, linkType: prerequisite|follows|blocks|relates_to} Abhängigkeit anlegen",
  "milestone.dependency.remove":
    "{projectId, dependencyId} Abhängigkeit entfernen",
  "milestone.delete": `{projectId, milestoneId} Meilenstein löschen, ${CONFIRMED}`,
};

const DELETE_OPERATIONS: ReadonlySet<string> = new Set([
  "wiki.page.delete",
  "wiki.comment.delete",
  "ticket.delete",
  "milestone.delete",
]);

const COMMENT_WRITES: ReadonlySet<string> = new Set([
  "wiki.comment.add",
  "wiki.comment.edit",
  "wiki.comment.resolve",
  "wiki.comment.delete",
]);

/** Narrows a requested operation to the chat catalog; everything else is refused. */
export function isChatOperation(value: unknown): value is ChatOperation {
  return typeof value === "string" && Object.hasOwn(CHAT_OPERATIONS, value);
}

/** Lists every operation of the chat catalog. */
export function listChatOperations(): readonly ChatOperation[] {
  return Object.keys(CHAT_OPERATIONS).filter(isChatOperation);
}

/** Tells whether an operation changes something and therefore needs an operation ID. */
export function isChatWriteOperation(operation: ChatOperation): boolean {
  return (
    isChatAdminWriteOperation(operation) ||
    AGENT_PLAN_COMMAND_OPERATIONS.some((write) => write === operation) ||
    CHAT_AGENT_WRITE_OPERATIONS.some((write) => write === operation) ||
    COMMENT_WRITES.has(operation) ||
    operation === "ticket.archive" ||
    operation === "ticket.restore" ||
    PICA_CALENDAR_WRITE_OPERATIONS.some((write) => write === operation) ||
    PAGES_AGENT_WRITE_OPERATIONS.some((write) => write === operation)
  );
}

/** Tells whether an operation deletes and therefore needs the person's confirmation. */
export function isChatDeleteOperation(operation: ChatOperation): boolean {
  return DELETE_OPERATIONS.has(operation) || operation.endsWith(".delete");
}

/** Tells whether a non-deletion administration action needs separate confirmation. */
export function requiresChatConfirmation(operation: ChatOperation): boolean {
  return (
    requiresChatAdminConfirmation(operation) &&
    !isChatDeleteOperation(operation)
  );
}

/** Consumes a legacy confirmation for one administration mutation. */
export function isChatConfirmationOperation(operation: ChatOperation): boolean {
  return (
    isChatAdminWriteOperation(operation) && !isChatDeleteOperation(operation)
  );
}

/** Lists every chat operation with its parameters for the agent instruction. */
export function describeChatOperations(): string {
  return Object.entries(CHAT_OPERATIONS)
    .filter(
      ([operation]) =>
        ![
          "agents.create",
          "agents.update",
          "agents.clone",
          "agents.delete",
        ].includes(operation),
    )
    .map(([operation, description]) => `- \`${operation}\` ${description}`)
    .join("\n");
}
