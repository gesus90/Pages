import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import type { StorageAccessRepository } from "@/backend/database/repositories/google/StorageAccessRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  StorageGrant,
  StorageActivity,
  StorageGrantTarget,
} from "@/definition/StorageAccess";
import type {
  StorageOperation,
  StorageResult,
} from "@/definition/GoogleDriveFiles";
import type { StorageConnection } from "./StorageFileSupport";
import type { StorageFileReader } from "./StorageFileReader";

/** Only these operations belong to the folder-scoped write right. */
export const STORAGE_GRANTED_OPERATIONS: readonly StorageOperation[] = [
  "capabilities",
  "list",
  "search",
  "stat",
  "resolve_path",
  "read",
  "download",
  "create_folder",
  "upload",
  "update",
  "confirm",
];

/** Persisted authorization and Google account of a single call; never serialized. */
export interface StorageAccessContext {
  readonly account: AccountAccess;
  readonly permissionId: string;
  readonly isAdministrator: boolean;
  readonly grants: readonly StorageGrant[];
}

/** Dependencies are injectable; all external reads are server-owned. */
export interface StorageAccessDependencies {
  readonly repository: Pick<
    StorageAccessRepository,
    "grants" | "targets" | "setGrant" | "record" | "history"
  >;
  readonly account: (userId: string) => Promise<AccountAccess | null>;
  readonly connection: StorageConnection;
  readonly reader: Pick<StorageFileReader, "stat">;
}

/** Authorizes Storage against current membership and real parent references. */
export class StorageAccessService {
  private readonly dependencies: StorageAccessDependencies;

  public constructor(dependencies: StorageAccessDependencies) {
    this.dependencies = dependencies;
  }

  /** Resolves current rights; failures and inactive accounts deny access. */
  public async context(userId: string): Promise<StorageAccessContext | null> {
    const account = await this.dependencies.account(userId);
    if (!account?.isActive || account.userId !== userId) return null;
    const isAdministrator = new UserPolicyService().isAdministrator(account);
    const access = await this.dependencies.connection.access();
    if (!access.ok)
      return isAdministrator
        ? { account, isAdministrator, permissionId: "", grants: [] }
        : null;
    const grants = await this.dependencies.repository.grants(
      isAdministrator ? null : userId,
      access.permissionId,
    );
    return {
      account,
      permissionId: access.permissionId,
      isAdministrator,
      grants,
    };
  }

  /** Checks an operation before content or mutation is handed to its caller. */
  public async allows(
    context: StorageAccessContext,
    operation: StorageOperation,
    input: {
      readonly ref?: string | null;
      readonly parentRef?: string;
      readonly folderRef?: string | null;
      readonly action?: string;
      readonly isTrash?: boolean;
    },
  ): Promise<boolean> {
    if (context.isAdministrator) return true;
    if (!STORAGE_GRANTED_OPERATIONS.includes(operation) || input.isTrash)
      return false;
    if (operation === "capabilities") return context.grants.length > 0;
    if (
      operation === "confirm" &&
      input.action !== "update" &&
      input.action !== "overwrite"
    )
      return false;
    let ref = input.ref;
    if (operation === "upload" || operation === "create_folder")
      ref = input.parentRef;
    if (operation === "search") ref = input.folderRef;
    return typeof ref === "string" && (await this.contains(context, ref));
  }

  /** Walks live ancestry with a cycle and depth bound; names never grant access. */
  public async contains(
    context: StorageAccessContext,
    ref: string,
  ): Promise<boolean> {
    if (context.isAdministrator) return true;
    const seen = new Set<string>();
    let current: string | null = ref;
    while (current !== null && seen.size < 128 && !seen.has(current)) {
      seen.add(current);
      const entry = await this.dependencies.reader.stat(current);
      if (!entry.ok || entry.value.entry.isTrashed) return false;
      if (
        context.grants.some(
          (grant) => grant.folderRef === entry.value.entry.ref,
        )
      )
        return true;
      current = entry.value.entry.parentRef;
    }
    return false;
  }

  /** Records every successful operation under the actual account name. */
  public async record(
    context: StorageAccessContext,
    operation: string,
    ref: string,
  ): Promise<void> {
    const actorName =
      `${context.account.firstName} ${context.account.lastName}`.trim() ||
      context.account.userId;
    await this.dependencies.repository.record(
      { actorId: context.account.userId, actorName, operation, ref },
      context.permissionId,
    );
  }

  /** Shows existing grants and selectable recipients only to an active administrator. */
  public async settings(userId: string): Promise<
    StorageResult<{
      readonly grants: readonly StorageGrant[];
      readonly targets: readonly StorageGrantTarget[];
    }>
  > {
    const context = await this.context(userId);
    if (!context?.isAdministrator)
      return { ok: false, error: { code: "forbidden" } };
    return {
      ok: true,
      value: {
        grants: context.grants,
        targets: await this.dependencies.repository.targets(),
      },
    };
  }

  /** Validates a real folder and existing recipient before adding or revoking a grant. */
  public async setGrant(
    userId: string,
    input: Omit<StorageGrant, "permissionId" | "folderName">,
    enabled: boolean,
  ): Promise<StorageResult<object>> {
    const context = await this.context(userId);
    if (!context?.isAdministrator)
      return { ok: false, error: { code: "forbidden" } };
    const targets = await this.dependencies.repository.targets();
    if (
      !targets.some(
        (target) =>
          target.kind === input.targetKind && target.id === input.targetId,
      )
    )
      return { ok: false, error: { code: "invalid_request" } };
    const folder = await this.dependencies.reader.stat(input.folderRef);
    if (!folder.ok) return folder;
    if (!folder.value.entry.isFolder || folder.value.entry.isTrashed)
      return { ok: false, error: { code: "not_folder" } };
    await this.dependencies.repository.setGrant(
      {
        ...input,
        permissionId: context.permissionId,
        folderName: folder.value.entry.name,
      },
      enabled,
    );
    await this.record(context, enabled ? "grant" : "revoke", input.folderRef);
    return { ok: true, value: {} };
  }

  /** Lists successful operations without exposing other accounts' activity to ordinary users. */
  public async history(
    userId: string,
  ): Promise<StorageResult<readonly StorageActivity[]>> {
    const context = await this.context(userId);
    if (!context || (!context.isAdministrator && context.grants.length === 0))
      return { ok: false, error: { code: "forbidden" } };
    return {
      ok: true,
      value: await this.dependencies.repository.history(
        context.isAdministrator ? null : userId,
        context.permissionId,
      ),
    };
  }
}
