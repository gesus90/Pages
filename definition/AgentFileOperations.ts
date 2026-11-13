/** Read operations available to a read-only plan session, still subject to folder/project rights. */
export const AGENT_FILE_READ_OPERATIONS = [
  "repository.log",
  "repository.diff",
  "repository.show",
  "repository.file",
  "storage.capabilities",
  "storage.list",
  "storage.search",
  "storage.stat",
  "storage.resolve_path",
  "storage.read",
] as const;

/** Folder-scoped writes require a full session and an operation receipt. */
export const AGENT_FILE_WRITE_OPERATIONS = [
  "storage.create_folder",
  "storage.upload",
  "storage.update",
] as const;

/** An operation of the existing plan bridge; never an external MCP server. */
export type AgentFileOperation =
  | (typeof AGENT_FILE_READ_OPERATIONS)[number]
  | (typeof AGENT_FILE_WRITE_OPERATIONS)[number];

/** Explicit wrappers keep external file results separate from Pages-owned entity projections. */
export type AgentFileResult =
  { readonly repository: object } | { readonly storage: object };
