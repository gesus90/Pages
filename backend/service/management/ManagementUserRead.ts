import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { ManagementRepository } from "@/backend/database/repositories/ManagementRepository";

import { parseManagement, managementListSchema } from "./ManagementRequest";
import { managementRevision } from "./ManagementRevision";

import type { ManagementContext } from "./ManagementContext";
import type {
  ManagementUser,
  ManagementUserRow,
  ManagementUserQuery,
} from "@/definition/Management";

/** Reads the contract's explicit safe projection; password and token stores are never serialized. */
export class ManagementUserRead {
  private readonly context: ManagementContext;
  /** Uses the current account facts of the shared call. */
  public constructor(context: ManagementContext) {
    this.context = context;
  }

  /** Reads current account state and a revision covering all editable memberships and agent fields. */
  public async user(userId: string): Promise<ManagementUser> {
    const { authorization, actor, agents, database, channel } = this.context;
    const snapshot = await authorization.snapshot();
    const target = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    const identity = await authorization.users().findById(userId);
    if (
      !target ||
      !identity ||
      !new UserPolicyService(channel).canSee(actor, target)
    )
      throw new AgentOperationError("NOT_FOUND");
    const groups = (await authorization.groups().findAll())
      .filter((group) => group.memberIds.includes(userId))
      .map(({ id, name }) => ({ id, name }));
    const emails = await authorization.users().findEmailsByUserIds([userId]);
    const employee = target.isAgent
      ? (await agents.detail(actor.userId, userId)).agent
      : null;
    const state = {
      id: userId,
      displayName: identity.displayName,
      username: identity.username,
      email: emails.get(userId) ?? null,
      kind: target.isAgent ? ("agent" as const) : ("human" as const),
      role: target.role?.id ?? null,
      status: target.isActive ? ("active" as const) : ("deactivated" as const),
      departments: snapshot.departments.filter((department) =>
        target.departments.includes(department.id),
      ),
      groups,
      projects: (await new ManagementRepository(database).projects(userId)).map(
        (project) => ({
          ...project,
          role: project.role === "manager" ? "projectmanager" : project.role,
        }),
      ),
      agent: employee
        ? {
            agentMd: employee.documents.instructions,
            soulMd: employee.documents.soul,
            connectionId: employee.settings.connectionId,
            model: employee.settings.model,
            reasoningEffort: employee.settings.reasoningEffort,
            avatarUrl: employee.avatarImageUrl,
          }
        : null,
    };
    return {
      ...state,
      revision: managementRevision({
        ...state,
        employeeRevision: employee?.revision,
        avatarUrl: identity.avatarImageUrl,
        avatarColor: identity.avatarColor,
        isAdmin: target.isAdmin,
      }),
    };
  }

  /** Lists every visible account, with kind, status, department and group filters and opaque paging. */
  public async list(input: unknown): Promise<{
    readonly users: readonly ManagementUserRow[];
    readonly total: number;
    readonly nextCursor: string | null;
  }> {
    const query = parseManagement(managementListSchema, input);
    const snapshot = await this.context.authorization.snapshot();
    const policy = new UserPolicyService(this.context.channel);
    const candidates = snapshot.accounts.filter((account) =>
      policy.canSee(this.context.actor, account),
    );
    const users: ManagementUserRow[] = [];
    for (const account of candidates) {
      const user = await this.user(account.userId);
      if (!this.matches(user, query)) continue;
      users.push(this.row(user));
    }
    users.sort((left, right) => left.id.localeCompare(right.id));
    const fingerprint = managementRevision({
      ...query,
      cursor: undefined,
      limit: undefined,
    });
    const offset = this.offset(query.cursor, fingerprint, users);
    const page = users.slice(offset, offset + query.limit);
    const last = page.at(-1);
    return {
      users: page,
      total: users.length,
      nextCursor:
        offset + page.length < users.length && last
          ? Buffer.from(
              JSON.stringify({ fingerprint, after: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  private matches(user: ManagementUser, query: ManagementUserQuery): boolean {
    if (query.kind && user.kind !== query.kind) return false;
    if (query.status && user.status !== query.status) return false;
    if (
      query.departmentId &&
      !user.departments.some(
        (department) => department.id === query.departmentId,
      )
    )
      return false;
    if (
      query.groupId &&
      !user.groups.some((group) => group.id === query.groupId)
    )
      return false;
    return (
      !query.query ||
      `${user.displayName} ${user.username}`
        .toLocaleLowerCase()
        .includes(query.query.toLocaleLowerCase())
    );
  }

  private row(user: ManagementUser): ManagementUserRow {
    const {
      id,
      displayName,
      username,
      kind,
      role,
      status,
      departments,
      groups,
    } = user;
    return {
      id,
      displayName,
      username,
      kind,
      role,
      status,
      departments,
      groups,
    };
  }

  private offset(
    cursor: string | null | undefined,
    fingerprint: string,
    users: readonly ManagementUserRow[],
  ): number {
    if (!cursor) return 0;
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(cursor, "base64url").toString(),
      );
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("fingerprint" in parsed) ||
        parsed.fingerprint !== fingerprint ||
        !("after" in parsed) ||
        typeof parsed.after !== "string"
      )
        throw new Error("Invalid cursor");
      const position = users.findIndex((user) => user.id === parsed.after);
      if (position < 0) throw new Error("Invalid cursor");
      return position + 1;
    } catch {
      throw new AgentOperationError("INVALID_REQUEST", { reason: "cursor" });
    }
  }
}
