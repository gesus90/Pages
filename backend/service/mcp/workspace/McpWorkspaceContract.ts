import type {
  RemoteAuthMethod,
  RemoteFailureCode,
  RemoteFailureDetail,
  RemoteSessionStatus,
  RemoteStoredSecrets,
  RemoteTestStage,
} from "@/definition/RemoteConnection";
import type { AgentWorkspaceUsageKind } from "@/definition/AgentWorkspace";

/** An object the interface names by identifier and name. */
export interface McpNamedReference {
  readonly id: string;
  readonly name: string;
}

/** The GitHub link of a project, as the registry shows it. */
export interface McpWorkspaceGitHub {
  readonly repoUrl: string;
  readonly repoName: string | null;
}

/** The last directory check of a remote workspace. */
export interface McpWorkspaceCheck {
  readonly checkedAt: string;
  readonly issue: RemoteFailureDetail | null;
}

/** A local or remote workspace as the workspace API answers (interface "Arbeitsbereich"). */
export interface McpWorkspaceResponse {
  readonly id: string;
  readonly kind: "local" | "remote";
  readonly name: string;
  readonly path: string;
  readonly project: McpNamedReference;
  readonly github: McpWorkspaceGitHub | null;
  readonly connection: McpNamedReference | null;
  readonly check: McpWorkspaceCheck | null;
  readonly isCheckOutdated: boolean;
  readonly isUsable: boolean;
  readonly reason: string | null;
  readonly revision: number;
  readonly canManage: boolean;
}

/** What still refers to a workspace; names only for administrators. */
export interface McpWorkspaceUsageResponse {
  readonly kind: AgentWorkspaceUsageKind;
  readonly id: string | null;
  readonly name: string | null;
}

/** One directory of the folder browser. */
export interface McpFolderResponse {
  readonly name: string;
  readonly path: string;
}

/** One level of the folder browser of the server. */
export interface McpFolderListingResponse {
  readonly path: string | null;
  readonly breadcrumbs: readonly McpFolderResponse[];
  readonly hasSeveralRoots: boolean;
  readonly folders: readonly McpFolderResponse[];
  readonly isTruncated: boolean;
  readonly selectionIssue: string | null;
}

/** The question before a workspace is removed. */
export interface McpWorkspaceRemovalQuestion {
  readonly confirmationRequired: true;
  readonly workspace: {
    readonly id: string;
    readonly name: string;
    readonly path: string;
  };
  readonly usages: readonly McpWorkspaceUsageResponse[];
}

/** The pinned host key without the key itself. */
export interface McpHostKeyResponse {
  readonly algorithm: string;
  readonly fingerprint: string;
}

/** The latest stored test or connect of a connection. */
export interface McpConnectionCheckResponse {
  readonly checkedAt: string;
  readonly stage: RemoteTestStage | null;
  readonly code: RemoteFailureCode | null;
}

/** The live logical connection. */
export interface McpConnectionSessionResponse {
  readonly status: RemoteSessionStatus;
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly cause: RemoteFailureCode | null;
  readonly connectedAt: string | null;
}

/** A remote connection as the workspace API answers (interface "Verbindung"); never with a secret. */
export interface McpConnectionResponse {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly department: {
    readonly id: string;
    readonly name: string | null;
  };
  readonly hostKey: McpHostKeyResponse | null;
  readonly allowedRoots: readonly string[];
  readonly effectiveRoots: readonly string[];
  readonly lastCheck: McpConnectionCheckResponse | null;
  readonly isChecking: boolean;
  readonly session: McpConnectionSessionResponse;
  readonly workspaceCount: number;
  readonly revision: number;
  readonly canManage: boolean;
  readonly storedSecrets: RemoteStoredSecrets | null;
}

/** One stage of a connection test. */
export interface McpTestStepResponse {
  readonly state: "passed" | "failed" | "skipped";
  readonly code: RemoteFailureCode | null;
}

/** What a connection test found, with the fingerprint of the key the machine showed. */
export interface McpConnectionTestResponse {
  readonly reachability: McpTestStepResponse;
  readonly hostKey: McpTestStepResponse;
  readonly authentication: McpTestStepResponse;
  readonly presentedHostKey: McpHostKeyResponse | null;
  readonly testedAt: string;
}

/** A workspace a change of a connection would affect. */
export interface McpAffectedWorkspaceResponse {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly project: McpNamedReference;
}

/** The risky part of a change to a connection. */
export type McpConnectionChangeKind = "allowed_roots" | "department";

/** The question before a connection is changed. */
export interface McpConnectionChangeQuestion {
  readonly confirmationRequired: true;
  readonly connection: McpNamedReference;
  readonly changes: readonly McpConnectionChangeKind[];
  readonly affectedWorkspaces: readonly McpAffectedWorkspaceResponse[];
}

/** The question before a connection is removed. */
export interface McpConnectionRemovalQuestion {
  readonly confirmationRequired: true;
  readonly connection: {
    readonly id: string;
    readonly name: string;
    readonly host: string;
  };
}
