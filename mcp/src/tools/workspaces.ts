import {
  CURSOR_SCHEMA,
  IDENTIFIER_SCHEMA,
  LIMIT_SCHEMA,
  READ_ANNOTATIONS,
  REVISION_SCHEMA,
  buildWriteTool,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentWorkspaceReadOperation,
  AgentWorkspaceWriteOperation,
} from "../../../definition/AgentWorkspaceOperations.js";

const NAME = { type: "string", minLength: 1, maxLength: 120 } as const;
const PATH = { type: "string", minLength: 1, maxLength: 4096 } as const;

const SEE_DESCRIPTION =
  "Returns only workspaces of projects the account can open now; hidden workspaces and their metadata are never mentioned, and a hidden one answers like a missing one. Pages checks the account rights on every call.";
const MANAGE_DESCRIPTION =
  "Only Pages administrators and managers of the project may change workspaces; project membership or ticket rights are not enough, and Pages checks this on every call. Only the registration is stored or changed: no file in the directory is read, written or deleted, and the GitHub link of the project is not changed. Reuse operationId with identical parameters after response loss. Pass the revision read last as expectedRevision; CONFLICT with details.currentRevision means it changed meanwhile.";
const PATH_DESCRIPTION =
  "path is an absolute path of an existing directory on the machine of the Pages server, readable, writable and traversable by its account. URLs, host:path notation and network shares are INVALID_REQUEST, as are the filesystem root, Pages instance folders and anything outside an area the server operator narrowed it to. The stored path is the canonical one.";

/** Reads of the workspace registry; Pages decides which workspaces an account sees. */
export const WORKSPACE_READ_TOOLS: readonly {
  readonly operation: AgentWorkspaceReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "workspaces.list",
    tool: {
      name: "list_workspaces",
      title: "List workspaces",
      description: `Lists the registered agent workspaces: stable id, name, canonical local path, project, GitHub repository of the project, revision, isUsable with unavailableReason, and canManage. Optional projectId narrows the list to one project and needs a project the account can open. Pass nextCursor with the same query to continue. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: {
          projectId: IDENTIFIER_SCHEMA,
          cursor: CURSOR_SCHEMA,
          limit: LIMIT_SCHEMA,
        },
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
  {
    operation: "workspaces.read",
    tool: {
      name: "read_workspace",
      title: "Read workspace",
      description: `Reads one registered agent workspace by its id, with the same fields as list_workspaces. ${SEE_DESCRIPTION}`,
      inputSchema: {
        type: "object",
        properties: { workspaceId: IDENTIFIER_SCHEMA },
        required: ["workspaceId"],
        additionalProperties: false,
      },
      annotations: READ_ANNOTATIONS,
    },
  },
];

/** Changes of the workspace registry; they never reach into a directory. */
export const WORKSPACE_WRITE_TOOLS: readonly {
  readonly operation: AgentWorkspaceWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "workspaces.create",
    tool: buildWriteTool({
      name: "create_workspace",
      title: "Create workspace",
      description: `${`Registers an existing local directory as an agent workspace of a project. The project must be visible to the account and linked to a GitHub repository, otherwise INVALID_REQUEST or NOT_FOUND; a directory that another workspace already registers or overlaps is CONFLICT. ${PATH_DESCRIPTION}`} ${MANAGE_DESCRIPTION}`,
      properties: { name: NAME, path: PATH, projectId: IDENTIFIER_SCHEMA },
      isDestructive: false,
    }),
  },
  {
    operation: "workspaces.update",
    tool: buildWriteTool({
      name: "update_workspace",
      title: "Update workspace",
      description: `${`Changes the name, the local path or the project of a registered workspace; pass only what changes. A workspace that plans or agents still refer to keeps its path and project (CONFLICT). ${PATH_DESCRIPTION}`} ${MANAGE_DESCRIPTION}`,
      properties: {
        workspaceId: IDENTIFIER_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        name: NAME,
        path: PATH,
        projectId: IDENTIFIER_SCHEMA,
      },
      optionalKeys: ["name", "path", "projectId"],
      isDestructive: true,
    }),
  },
  {
    operation: "workspaces.remove",
    tool: buildWriteTool({
      name: "remove_workspace",
      title: "Remove workspace",
      description: `Unregisters a workspace. The directory, its files, the project and its GitHub repository stay untouched; a workspace that plans, agents or runs still refer to is CONFLICT. ${MANAGE_DESCRIPTION}`,
      properties: {
        workspaceId: IDENTIFIER_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
      },
      isDestructive: true,
    }),
  },
];
