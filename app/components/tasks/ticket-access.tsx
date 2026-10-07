import { createContext, use } from "react";

import type { Department } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";
import type { TaskActionPermissions } from "@/definition/Task";
import type { GroupSummary } from "@/definition/UserGroup";

/** Server hints and department choices that decide which ticket controls appear. */
export interface TicketAccess extends TaskActionPermissions {
  readonly departments: readonly Department[];
  /** Groups a ticket can be assigned to instead of a person. */
  readonly assigneeGroups: readonly GroupSummary[];
  /** Per project id, the groups with a member who can work in the project. */
  readonly assigneeGroupIdsByProject: Readonly<
    Record<string, readonly string[]>
  >;
  /** Projects the visitor can open, which a ticket template can be shared with. */
  readonly projects: readonly Pick<Project, "id" | "name">[];
}

// Without a provider the controls stay hidden; the server checks every action anyway.
const READ_ONLY_ACCESS: TicketAccess = {
  assigneeGroupIdsByProject: {},
  assigneeGroups: [],
  canDelete: false,
  canWrite: false,
  departments: [],
  projects: [],
};

const TicketAccessContext = createContext<TicketAccess>(READ_ONLY_ACCESS);

/** Makes the access hints of the loader available to every ticket control below. */
export const TicketAccessProvider = TicketAccessContext.Provider;

/** Returns the access hints the surrounding route provided. */
export function useTicketAccess(): TicketAccess {
  return use(TicketAccessContext);
}
