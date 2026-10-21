import { isIP } from "node:net";
import { posix } from "node:path";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { RemoteError } from "@/backend/error/RemoteErrors";
import { parseHostKey } from "@/backend/remote/SshHostKey";
import {
  isRemoteAuthMethod,
  MAXIMUM_REMOTE_ROOTS,
} from "@/definition/RemoteConnection";

import type {
  RemoteAuthMethod,
  RemoteHostKey,
} from "@/definition/RemoteConnection";

/** The dialog's input after validation; empty secrets mean "keep the stored one". */
export interface ValidatedRemoteConnection {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authMethod: RemoteAuthMethod;
  readonly departmentId: string;
  readonly password: string;
  readonly privateKey: string;
  readonly passphrase: string;
  readonly hostKey: RemoteHostKey | null;
  /** Normalized absolute directories without duplicates; empty for a test. */
  readonly allowedRoots: readonly string[];
  readonly revision: number | null;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
// Labels of letters, digits, `_` and `-`, separated by dots; never an option.
const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*\.?$/u;
const USER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$/u;
const MAXIMUM_SECRET = 1024;
const MAXIMUM_KEY = 16 * 1024;

function readName(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const name = value.trim();
  if (!name || name.length > 120 || CONTROL_CHARACTERS.test(name))
    throw invalid();
  return name;
}

function invalid(): RemoteError {
  return new RemoteError("remote_connection_invalid");
}

function readHost(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const host = value.trim();
  if (isIP(host) !== 0 || HOST_NAME.test(host)) return host;
  throw invalid();
}

function readPort(value: unknown): number {
  const port = typeof value === "string" ? Number(value) : value;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  )
    throw invalid();
  return port;
}

function readUser(value: unknown): string {
  if (typeof value !== "string" || !USER_NAME.test(value.trim()))
    throw invalid();
  return value.trim();
}

/** Secrets are taken as typed; only their size and line structure are limited. */
function readSecret(value: unknown, maximum: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > maximum) throw invalid();
  return value;
}

function readPassword(value: unknown): string {
  const secret = readSecret(value, MAXIMUM_SECRET);
  if (CONTROL_CHARACTERS.test(secret)) throw invalid();
  return secret;
}

function readPrivateKey(value: unknown): string {
  const key = readSecret(value, MAXIMUM_KEY);
  if (key === "") return "";
  if (
    key.includes("\u0000") ||
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(key)
  )
    throw new RemoteError("remote_connection_invalid", "key_invalid");
  return key;
}

function readHostKey(value: unknown): RemoteHostKey | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 5000)
    throw new RemoteError("remote_host_key_invalid");
  const hostKey = parseHostKey(value);
  if (!hostKey) throw new RemoteError("remote_host_key_invalid");
  return hostKey;
}

function readRevision(value: unknown, error: () => RemoteError): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw error();
  return value;
}

function rootsInvalid(): RemoteError {
  return new RemoteError("remote_roots_invalid");
}

/**
 * An allowed directory as the check compares it: absolute, without `.` or
 * `..` steps, doubled or trailing slashes. Resolving symbolic links is left
 * to the machine, which alone knows them.
 */
function readRoot(value: unknown): string {
  if (typeof value !== "string") throw rootsInvalid();
  const root = value.trim();
  if (
    !root.startsWith("/") ||
    root.length > 4096 ||
    CONTROL_CHARACTERS.test(root) ||
    root.split("/").includes("..")
  )
    throw rootsInvalid();
  const normalized = posix.normalize(root);
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

/** Empty rows of the dialog are dropped; an empty list means the SSH user's home. */
function readAllowedRoots(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw rootsInvalid();
  const entries: unknown[] = value;
  const roots = new Set(
    entries
      .filter((entry) => typeof entry !== "string" || entry.trim() !== "")
      .map(readRoot),
  );
  if (roots.size > MAXIMUM_REMOTE_ROOTS) throw rootsInvalid();
  return [...roots];
}

function readDepartment(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100)
    throw new RemoteError("remote_department_invalid");
  return value.trim();
}

/**
 * Validates the connection dialog before anything is stored or contacted.
 *
 * @param input - The parsed JSON the browser sent.
 * @param purpose - A test needs no name and no department yet.
 * @returns The validated connection.
 * @throws {RemoteError} For any value outside its rules; the message never
 * repeats a secret.
 */
export function readRemoteConnectionInput(
  input: unknown,
  purpose: "save" | "test",
): ValidatedRemoteConnection {
  const fields = readAgentObject(input);
  const authMethod = fields.authMethod;
  if (!isRemoteAuthMethod(authMethod)) throw invalid();
  const isSave = purpose === "save";
  return {
    name: isSave ? readName(fields.name) : "",
    host: readHost(fields.host),
    port: readPort(fields.port),
    username: readUser(fields.username),
    authMethod,
    departmentId: isSave ? readDepartment(fields.departmentId) : "",
    password: readPassword(fields.password),
    privateKey: readPrivateKey(fields.privateKey),
    passphrase: readPassword(fields.passphrase),
    hostKey: readHostKey(fields.hostKey),
    allowedRoots: isSave ? readAllowedRoots(fields.allowedRoots) : [],
    revision: readRevision(fields.revision, invalid),
  };
}

/**
 * Validates a remote workspace profile before its directory is checked.
 *
 * @param input - The parsed JSON the browser sent.
 * @returns Name, connection, absolute path, project and revision.
 * @throws {RemoteError} `remote_workspace_invalid`; a `host:path` text is no
 * absolute path and is refused like any other.
 */
export function readRemoteWorkspaceInput(input: unknown): {
  readonly name: string;
  readonly connectionId: string;
  readonly path: string;
  readonly projectId: string;
  readonly revision: number | null;
} {
  const fields = readAgentObject(input);
  const texts = [
    fields.name,
    fields.connectionId,
    fields.path,
    fields.projectId,
  ].map((value) => (typeof value === "string" ? value.trim() : ""));
  const [name, connectionId, path, projectId] = texts;
  if (
    texts.some((text) => !text || CONTROL_CHARACTERS.test(text)) ||
    name.length > 120 ||
    connectionId.length > 100 ||
    projectId.length > 100 ||
    path.length > 4096 ||
    !path.startsWith("/")
  )
    throw new RemoteError("remote_workspace_invalid");
  const revision = readRevision(
    fields.revision,
    () => new RemoteError("remote_workspace_invalid"),
  );
  return { name, connectionId, path, projectId, revision };
}
