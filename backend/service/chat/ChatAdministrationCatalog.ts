import {
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
} from "@/definition/AgentAdministration";

import type {
  AgentAdminReadOperation,
  AgentAdminWriteOperation,
} from "@/definition/AgentAdministration";

/** The administration actions described to the chat; Pages still checks every action server-side. */
export const CHAT_ADMIN_OPERATIONS: Readonly<
  Record<AgentAdminReadOperation | AgentAdminWriteOperation, string>
> = {
  "admin.users.list":
    "{cursor?, limit?} Admin: Benutzer mit normalen Rollen, Admin-/Aktivstatus, Gruppen, Abteilungen und Verwaltungsbereich, keine Passwörter oder E-Mails",
  "admin.departments.list":
    "{cursor?, limit?} Admin: bestehende Abteilungen mit memberIds",
  "admin.groups.list":
    "{cursor?, limit?} Admin: bestehende Gruppen mit memberIds",
  "admin.roles.list":
    "{cursor?, limit?} Admin: normale Rollen mit Rang, departmentBound und permissions",
  "admin.permissions.list":
    "{} Admin: konfigurierbare Rechte; Lesen ist immer aktiv",
  "admin.projectMembers.read":
    "{projectId, cursor?, limit?} Admin: Projektmitglieder und Abteilungen",
  "admin.activity.read":
    "{cursor?, limit?} Admin: Verwaltungsprotokoll mit Akteur, Ziel und Quelle",
  "admin.roles.setPermissions":
    "{roleId, permissions: [], expectedPermissions: []} Admin: Rechte einer bestehenden Rolle für ALLE Träger ersetzen; bei Rechteentzug Bestätigung der Person nötig",
  "admin.roles.assign":
    "{targetType: person|group|department, targetId, roleId, expectedAssignments: [{userId, roleId|null}]} Admin: normale Rolle einer Person oder ALLER aktuellen Mitglieder ersetzen (maximal 100), keine Vererbung an zukünftige Mitglieder, Admin-Eigenschaft bleibt; bei Rechteentzug Bestätigung der Person nötig",
  "admin.users.setName":
    "{userId, firstName, lastName, expectedFirstName, expectedLastName} Admin: Namen ändern",
  "admin.users.setDepartments":
    "{userId, departmentIds: [], expectedDepartmentIds: []} Admin: Abteilungsmitgliedschaften ersetzen; beim Entfernen Bestätigung der Person nötig",
  "admin.users.setScope":
    "{userId, scope: {managedDepartments: [], allDepartments, allProjects}, expectedScope: {...}} Admin: Verwaltungsbereich setzen; beim Entziehen Bestätigung der Person nötig",
  "admin.groups.update":
    "{groupId, name, memberIds: [], expectedName, expectedMemberIds: []} Admin: bestehende Gruppe ändern; beim Entfernen von Mitgliedern Bestätigung der Person nötig",
  "admin.departments.rename":
    "{departmentId, name, expectedName} Admin: bestehende Abteilung umbenennen",
  "admin.users.create":
    "{username, firstName, lastName, email|null, roleId|null, isAdmin, departmentIds: []} Admin: Benutzer anlegen, zusätzliche Bestätigung der Person nötig. Das temporäre Passwort zeigt Pages der Person direkt, es kommt nie zum Modell",
  "admin.users.setAdministrator":
    "{userId, isAdmin, expectedIsAdmin} Admin-Eigenschaft ändern, zusätzliche Bestätigung der Person nötig",
  "admin.users.setActive":
    "{userId, isActive, expectedIsActive} Admin: Benutzer sperren/entsperren, Bestätigung der Person nötig",
  "admin.users.resetPassword":
    "{userId} Admin: temporäres Passwort erzeugen, Bestätigung der Person nötig. Pages zeigt es der Person direkt, nicht dem Modell",
  "admin.groups.create":
    "{name, memberIds: []} Admin: Gruppe anlegen, mindestens ein aktives Mitglied",
  "admin.groups.delete":
    "{groupId, expectedName, expectedMemberIds: []} Admin: Gruppe löschen, Bestätigung der Person nötig; bestehende Verwendungen sperren",
  "admin.departments.create": "{name} Admin: Abteilung anlegen",
  "admin.departments.delete":
    "{departmentId, expectedName, expectedMemberIds: []} Admin: Abteilung löschen, Bestätigung der Person nötig; bestehende Verwendungen sperren",
  "admin.roles.save":
    "{role: {id, name, rank, departmentBound, permissions: []}, expectedRole: {...}|null} Admin: normale Rolle anlegen/ändern, bei Rechteentzug Bestätigung der Person nötig. Neue ID ausdrücklich wählen, expectedRole=null nur für neue Rolle",
  "admin.roles.delete":
    "{roleId, expectedRole: {id, name, rank, departmentBound, permissions: []}} Admin: unbenutzte normale Rolle löschen, Bestätigung der Person nötig",
};

const CONFIRMED_OPERATIONS: ReadonlySet<string> = new Set([
  "admin.users.create",
  "admin.users.setAdministrator",
  "admin.users.setActive",
  "admin.users.resetPassword",
  "admin.groups.delete",
  "admin.departments.delete",
  "admin.roles.delete",
]);

/** These chat actions always require a typed confirmation before dispatch. */
export function requiresChatAdminConfirmation(operation: string): boolean {
  return CONFIRMED_OPERATIONS.has(operation);
}

/** A typed confirmation is available for at most one administration mutation in a turn. */
export function isChatAdminWriteOperation(operation: string): boolean {
  return [...AGENT_ADMIN_WRITE_OPERATIONS, ...CHAT_ADMIN_WRITE_OPERATIONS].some(
    (candidate) => candidate === operation,
  );
}
