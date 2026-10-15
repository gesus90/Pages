import { CHAT_AGENT_WRITE_OPERATIONS } from "@/definition/ChatAgentOperations";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";
import {
  CHAT_ADMIN_OPERATIONS,
  isChatAdminWriteOperation,
  requiresChatAdminConfirmation,
} from "./ChatAdministrationCatalog";

import type {
  AgentAdminReadOperation,
  AgentAdminWriteOperation,
} from "@/definition/AgentAdministration";
import type { AgentExtensionReadOperation } from "@/definition/AgentExtensions";
import type { AgentProjectDeletionWriteOperation } from "@/definition/AgentProjectDeletion";
import type {
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

/**
 * Operations of the agent API that the chat never offers: imports and uploads
 * need files and a credential, the workspace registry and the permanent
 * deletion of whole projects belong to MCP clients, and range patches exist to
 * spare an MCP client the transfer of whole texts, which the chat reads and
 * writes in full anyway.
 */
type ExcludedOperation =
  | "wiki.import.plan"
  | "wiki.import.apply"
  | "wiki.import.update"
  | "import.structured.apply"
  | "assets.upload.prepare"
  | AgentTextRangeWriteOperation
  | AgentWorkspaceWriteOperation
  | AgentProjectDeletionWriteOperation;

/** A Pages operation the chat agent may request; the same operations MCP clients use (T6.12.5). */
export type ChatOperation = Exclude<
  | PagesAgentReadOperation
  | PagesAgentTicketReadOperation
  | PagesAgentCommentOperation
  | AgentExtensionReadOperation
  | PagesAgentWriteOperation
  | AgentAdminReadOperation
  | AgentAdminWriteOperation
  | PageAgentReadOperation
  | PageAgentWriteOperation
  | AgentPlanReadOperation
  | AgentPlanWriteOperation
  | ChatAgentWriteOperation,
  ExcludedOperation
>;

const PAGE = "pageId, cursor?, limit?";
const PROJECT = "projectId, cursor?, limit?";
const WINDOW = "cursor?, limit?";
const CONFIRMED = "Bestätigung der Person nötig";
const PLAN_TARGET = "planId, expectedRevision";
const RUN =
  "runId | planId + select: latest|first; runId optional mit planId zur Prüfung";
const CHANGES =
  "changes?: [{action: addNode, node: {type: start|end|agent|task|parameter, id?, x?, y?, agentId?, personalAgentId?, instruction?, taskId?, name?, format?, value?}} | {action: updateNode, nodeId, fields: {x?, y?, agentId?, personalAgentId?, instruction?, taskId?, name?, format?, value?}} | {action: removeNode, nodeId} | {action: connect|disconnect, from, to} | {action: bind, nodeId, parameter, binding: {kind: source, nodeId}|{kind: result, stepId}|{kind: literal, value}} | {action: unbind, nodeId, parameter}]";

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
  "agents.list":
    "{cursor?, limit?} sichtbare Benutzer-Agents mit Anweisung, Parametern und Konfiguration auflisten",
  "agents.read":
    "{agentId} sichtbaren Benutzer-Agent mit instruction (AGENT.md-Anweisung), parameters, run, Modell, Freigabe, canEdit und revision lesen",
  "agents.models.list":
    "{} aktuell für die Person freigegebene Modelle, Standardmodell und Reasoning-Stufen lesen",
  "agents.create":
    "{name, instruction?, parameters?: [], directoryParameter?: null|Name, modelProfileId?, reasoningEffort?: null|Stufe, sharing?: {scope: private|global|restricted, operator?: and|or, groupIds?: [], departmentIds?: []}} Agent im Namen der Person erstellen (create_agent); ohne Modellangabe gilt das freigegebene Standardmodell",
  "agents.update":
    "{agentId, expectedRevision, name?, instruction?, parameterChanges?: [], parameters?: [], directoryParameter?, modelProfileId?, reasoningEffort?, sharing?} nur angegebene Felder ändern; parameterChanges und parameters schließen sich aus, alle anderen Felder bleiben erhalten",
  "agents.clone":
    "{agentId, expectedRevision, name?, instruction?, parameterChanges?: [], parameters?: [], directoryParameter?, modelProfileId?, reasoningEffort?, sharing?} gelesene Quelle als unabhängigen neuen Agent für die Person klonen; vollständige Konfiguration inklusive Laufzeit und Parameter kopieren, nur gewünschte Anpassungen übernehmen; Quelle bleibt erhalten",
  "agents.delete":
    "{agentId, expectedRevision} eigenen Benutzer-Agent entfernen; vorher lesen und ausdrücklich mit LÖSCHEN in der aktuellen Nachricht bestätigen",

  "plans.list": `{text?, projectId?, ${WINDOW}} sichtbare Ausführpläne nach Name mit Projekt, Freigabe, canEdit, revision, state (idle|running|paused) und latestRun; text sucht im Namen`,
  "plans.read":
    "{planId} Ausführplan mit nodes (label, Agent, Ticket, Parameter, bindings), edges (Ablauf from → to), Freigabe, revision und status (state, runCount, latestRun, isRunnable, issues) lesen",
  "plans.sources.read":
    "{workspaceId?} Arbeitsbereiche für neue Pläne; mit workspaceId auch die Agents mit ihren Parametern für Agent-Nodes",
  "plans.runs.list": `{planId, order?: newest|oldest, ${WINDOW}} eigene Runs eines Plans mit runId, planId, startedAt und status, seitenweise (Standard 20 pro Seite)`,
  "plans.run.read": `{${RUN}} einen eigenen Run mit Start, Ende, Status und Status jedes Nodes lesen`,
  "plans.run.reports.read": `{${RUN}, stepId?} Berichte eines eigenen Runs lesen: je Node runId, stepId, Ergebnis, Fehler, Abnahme, Kriterien und Todos`,
  "plans.create": `{name, workspaceId, sharing?: {scope: private|global|restricted, operator?, groupIds?, departmentIds?}, ${CHANGES}} Ausführplan anlegen, ohne Freigabe privat`,
  "plans.update": `{${PLAN_TARGET}, name?, sharing?, ${CHANGES}} Struktur, Name oder Freigabe eines eigenen Plans ändern; alle changes gelten zusammen oder gar nicht`,
  "plans.parameter.create": `{${PLAN_TARGET}, name, value: {type: text, text}|{type: number, number}|{type: ticket, ticketId}|{type: workspace, workspaceId}|{type: wiki, pageId}, format?: string|number|json, x?, y?} Parameter-Node anlegen`,
  "plans.parameter.update": `{${PLAN_TARGET}, parameterId, name?, value?, format?, x?, y?} Parameter-Node ändern`,
  "plans.parameter.remove": `{${PLAN_TARGET}, parameterId} Parameter-Node samt seinen Datenverbindungen entfernen`,

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
  "ticket.create":
    "{projectId?, type: initiative|epic|task|subtask, title, description, statusId|null, parentId|null, milestoneId?|null, departmentId?|null, assignee?: {targetType: person|group|none, targetId|null}} Ticket anlegen; Projekt, Meilenstein und Abteilung kommen vom Elternticket, Bearbeitung ist ohne Angabe die anlegende Person",
  "tickets.search": `{projectId, text?, type?: initiative|epic|task|subtask, statusId?, parentId?, milestoneId?, departmentId?, assigneeId?, assigneeGroupId?, tagIds?: [], ${WINDOW}} Tickets eines Projekts nach Schlüssel, Titel und Beschreibung suchen und filtern`,
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
  "tags.list": `{${WINDOW}} Tag-Katalog; nur diese Tags lassen sich zuweisen`,
  "ticket.setTags":
    "{ticketId, tagIds: [], expectedTagIds: []} Tags eines Tickets setzen, nur Tags des Katalogs",
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

/** Tells whether an operation changes something and therefore needs an operation ID. */
export function isChatWriteOperation(operation: ChatOperation): boolean {
  return (
    isChatAdminWriteOperation(operation) ||
    CHAT_AGENT_WRITE_OPERATIONS.some((write) => write === operation) ||
    COMMENT_WRITES.has(operation) ||
    PAGES_AGENT_WRITE_OPERATIONS.some((write) => write === operation)
  );
}

/** Tells whether an operation deletes and therefore needs the person's confirmation. */
export function isChatDeleteOperation(operation: ChatOperation): boolean {
  return DELETE_OPERATIONS.has(operation) || operation.endsWith(".delete");
}

/** Tells whether the action always requires the person's typed confirmation before dispatch. */
export function requiresChatConfirmation(operation: ChatOperation): boolean {
  return (
    isChatDeleteOperation(operation) || requiresChatAdminConfirmation(operation)
  );
}

/** Consumes a typed confirmation for one deletion or administrator mutation, including conditional revocations. */
export function isChatConfirmationOperation(operation: ChatOperation): boolean {
  return (
    isChatDeleteOperation(operation) || isChatAdminWriteOperation(operation)
  );
}

/** Lists every chat operation with its parameters for the agent instruction. */
export function describeChatOperations(): string {
  return Object.entries(CHAT_OPERATIONS)
    .map(([operation, description]) => `- \`${operation}\` ${description}`)
    .join("\n");
}
