import { z } from "zod";

import { REMOTE_AUTH_METHODS } from "@/definition/RemoteConnection";

import { McpWorkspaceError } from "./McpWorkspaceError";

const MAXIMUM_IDENTIFIER_LENGTH = 100;
const MAXIMUM_NAME_LENGTH = 120;
const MAXIMUM_PATH_LENGTH = 4096;
const MAXIMUM_HOST_LENGTH = 253;
const MAXIMUM_USERNAME_LENGTH = 64;
const MAXIMUM_SECRET_LENGTH = 1024;
const MAXIMUM_KEY_LENGTH = 16 * 1024;

/** `SHA256:` and the 43 characters of an unpadded Base64 SHA-256 digest, as `ssh-keygen -l` prints it. */
const HOST_KEY_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/u;

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const nameField = z.string().trim().min(1).max(MAXIMUM_NAME_LENGTH);
const pathField = z.string().trim().min(1).max(MAXIMUM_PATH_LENGTH);
const revisionField = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const kindField = z.enum(["local", "remote"]);
const confirmedField = z.literal(true).optional();

const localCreateSchema = z
  .object({
    kind: z.literal("local"),
    name: nameField,
    path: pathField,
    projectId: identifierField,
  })
  .strict();

const remoteCreateSchema = z
  .object({
    kind: z.literal("remote"),
    name: nameField,
    path: pathField,
    projectId: identifierField,
    connectionId: identifierField,
  })
  .strict();

const workspaceCreateSchema = z.discriminatedUnion("kind", [
  localCreateSchema,
  remoteCreateSchema,
]);

const workspaceUpdateSchema = z
  .object({
    revision: revisionField,
    name: nameField.optional(),
    path: pathField.optional(),
    projectId: identifierField.optional(),
    connectionId: identifierField.optional(),
  })
  .strict();

const removeSchema = z
  .object({ revision: revisionField, confirmed: confirmedField })
  .strict();

const workspaceListSchema = z
  .object({
    projectId: identifierField.optional(),
    kind: kindField.optional(),
  })
  .strict();

const folderSchema = z
  .object({
    path: z.string().optional(),
    showHidden: z.literal("1").optional(),
  })
  .strict();

const secretFields = {
  password: z.string().max(MAXIMUM_SECRET_LENGTH).optional(),
  privateKey: z.string().max(MAXIMUM_KEY_LENGTH).optional(),
  passphrase: z.string().max(MAXIMUM_SECRET_LENGTH).optional(),
};

const endpointFields = {
  host: z.string().trim().min(1).max(MAXIMUM_HOST_LENGTH),
  port: z.number().int().min(1).max(65_535),
  username: z.string().trim().min(1).max(MAXIMUM_USERNAME_LENGTH),
  authMethod: z.enum(REMOTE_AUTH_METHODS),
};

const fingerprintField = z.string().regex(HOST_KEY_FINGERPRINT).optional();

const connectionCreateSchema = z
  .object({
    name: nameField,
    ...endpointFields,
    departmentId: identifierField,
    ...secretFields,
    hostKeyFingerprint: fingerprintField,
    allowedRoots: z.array(z.string()).optional(),
  })
  .strict();

const connectionUpdateSchema = z
  .object({
    revision: revisionField,
    confirmed: confirmedField,
    name: nameField.optional(),
    host: endpointFields.host.optional(),
    port: endpointFields.port.optional(),
    username: endpointFields.username.optional(),
    authMethod: endpointFields.authMethod.optional(),
    departmentId: identifierField.optional(),
    ...secretFields,
    hostKeyFingerprint: fingerprintField,
    allowedRoots: z.array(z.string()).optional(),
  })
  .strict();

const connectionTestSchema = z
  .object({
    connectionId: identifierField.optional(),
    ...endpointFields,
    ...secretFields,
    hostKeyFingerprint: fingerprintField,
  })
  .strict();

const emptySchema = z.object({}).strict();

/** Body of `POST /workspaces`; a local workspace names no connection, a remote one must. */
export type McpWorkspaceCreateRequest = z.infer<typeof workspaceCreateSchema>;
/** Body of `PATCH /workspaces/{id}`. */
export type McpWorkspaceUpdateRequest = z.infer<typeof workspaceUpdateSchema>;
/** Body of a removal, of a workspace or of a connection. */
export type McpRemovalRequest = z.infer<typeof removeSchema>;
/** Query of `GET /workspaces`. */
export type McpWorkspaceListRequest = z.infer<typeof workspaceListSchema>;
/** Query of `GET /workspaces/folders`. */
export type McpFolderRequest = z.infer<typeof folderSchema>;
/** Body of `POST /remote-connections`. */
export type McpConnectionCreateRequest = z.infer<typeof connectionCreateSchema>;
/** Body of `PATCH /remote-connections/{id}`. */
export type McpConnectionUpdateRequest = z.infer<typeof connectionUpdateSchema>;
/** Body of `POST /remote-connections/test`. */
export type McpConnectionTestRequest = z.infer<typeof connectionTestSchema>;

/** Parses untrusted input or rejects it with `invalid_request`; the input is never quoted. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpWorkspaceError("invalid_request");
  return result.data;
}

/** Rejects a change that names none of its fields. */
function requireSomeField(
  body: Readonly<Record<string, unknown>>,
  ignored: readonly string[],
): void {
  if (!Object.keys(body).some((key) => !ignored.includes(key)))
    throw new McpWorkspaceError("invalid_request");
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpWorkspaceError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name))
      throw new McpWorkspaceError("invalid_request");
    values[name] = value;
  }
  return values;
}

/**
 * Validators of every body and query the workspace API takes (PAGE-245).
 *
 * @remarks
 * Every body is a strict object: an unknown field is `invalid_request`, and a
 * rejected input is never quoted. The services apply the rest of the rules
 * of the interface to the values.
 */
export const McpWorkspaceRequest = {
  workspaceList: (query: URLSearchParams): McpWorkspaceListRequest =>
    parse(workspaceListSchema, queryObject(query)),
  workspaceCreate: (body: unknown): McpWorkspaceCreateRequest =>
    parse(workspaceCreateSchema, body),
  workspaceUpdate: (
    body: Readonly<Record<string, unknown>>,
  ): McpWorkspaceUpdateRequest => {
    requireSomeField(body, ["revision"]);
    return parse(workspaceUpdateSchema, body);
  },
  removal: (body: unknown): McpRemovalRequest => parse(removeSchema, body),
  folders: (query: URLSearchParams): McpFolderRequest =>
    parse(folderSchema, queryObject(query)),
  connectionCreate: (body: unknown): McpConnectionCreateRequest =>
    parse(connectionCreateSchema, body),
  connectionUpdate: (
    body: Readonly<Record<string, unknown>>,
  ): McpConnectionUpdateRequest => {
    requireSomeField(body, ["revision", "confirmed"]);
    return parse(connectionUpdateSchema, body);
  },
  connectionTest: (body: unknown): McpConnectionTestRequest =>
    parse(connectionTestSchema, body),
  empty: (body: unknown): void => {
    parse(emptySchema, body);
  },
} as const;
