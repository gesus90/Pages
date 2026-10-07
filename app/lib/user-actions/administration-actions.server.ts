import { randomUUID } from "node:crypto";
import { data } from "react-router";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { isCapability } from "@/definition/Authorization";
import { toActionError } from "./user-action-support.server";

import type {
  UsersActionContext,
  UsersActionData,
  UsersActionHandler,
  UsersIntent,
} from "./user-action-support.server";

function text(form: FormData, key: string): string {
  const entry = form.get(key);
  if (typeof entry !== "string") throw new AdministrationError("invalidInput");
  return entry.trim();
}

function strings(form: FormData, key: string): string[] {
  return form.getAll(key).map((entry) => {
    if (typeof entry !== "string")
      throw new AdministrationError("invalidInput");
    return entry;
  });
}

function handler(
  intent: Exclude<UsersIntent, "create-user" | "reset-password">,
  operation: (context: UsersActionContext) => Promise<void>,
): UsersActionHandler {
  return async (context) => {
    try {
      await operation(context);
      return data<UsersActionData>({ intent, ok: true });
    } catch (error: unknown) {
      return toActionError(error, intent);
    }
  };
}

/** Extra directory actions, each protected by the transactional service boundary. */
export const ADMINISTRATION_ACTION_HANDLERS = {
  "save-role": handler("save-role", async ({ actor, formData, services }) => {
    const rank = text(formData, "rank");
    if (!rank) throw new AdministrationError("invalidInput");
    const permissions = strings(formData, "permission").map((permission) => {
      if (!isCapability(permission))
        throw new AdministrationError("invalidInput");
      return permission;
    });
    await services.administrationService.saveRole(actor.id, {
      id: text(formData, "entityId") || randomUUID(),
      name: text(formData, "name"),
      rank: Number(rank),
      departmentBound: formData.get("departmentBound") === "true",
      permissions,
    });
  }),
  "delete-role": handler(
    "delete-role",
    async ({ actor, formData, services }) => {
      await services.administrationService.deleteRole(
        actor.id,
        text(formData, "entityId"),
      );
    },
  ),
  "save-department": handler(
    "save-department",
    async ({ actor, formData, services }) => {
      await services.administrationService.saveDepartment(actor.id, {
        id: text(formData, "entityId") || randomUUID(),
        name: text(formData, "name"),
      });
    },
  ),
  "delete-department": handler(
    "delete-department",
    async ({ actor, formData, services }) => {
      await services.administrationService.deleteDepartment(
        actor.id,
        text(formData, "entityId"),
      );
    },
  ),
  "save-group": handler("save-group", async ({ actor, formData, services }) => {
    await services.groupAdministrationService.saveGroup(actor.id, {
      id: text(formData, "entityId") || randomUUID(),
      memberIds: strings(formData, "member"),
      name: text(formData, "name"),
    });
  }),
  "delete-group": handler(
    "delete-group",
    async ({ actor, formData, services }) => {
      await services.groupAdministrationService.deleteGroup(
        actor.id,
        text(formData, "entityId"),
      );
    },
  ),
  "set-memberships": handler(
    "set-memberships",
    async ({ actor, formData, services }) => {
      await services.administrationService.setMemberships(
        actor.id,
        text(formData, "userId"),
        strings(formData, "department"),
      );
    },
  ),
  "set-scope": handler("set-scope", async ({ actor, formData, services }) => {
    await services.administrationService.setScope(
      actor.id,
      text(formData, "userId"),
      {
        managedDepartments: strings(formData, "department"),
        allDepartments: formData.get("allDepartments") === "true",
        allProjects: formData.get("allProjects") === "true",
      },
    );
  }),
  "set-admin": handler("set-admin", async ({ actor, formData, services }) => {
    await services.administrationService.setAdministrator(
      actor.id,
      text(formData, "userId"),
      formData.get("isAdmin") === "true",
    );
  }),
};
