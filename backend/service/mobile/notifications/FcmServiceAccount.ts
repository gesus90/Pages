import { createPrivateKey } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";

/** The only endpoint a signed token assertion is ever sent to. */
export const FCM_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** The OAuth scope that allows sending messages through FCM HTTP v1. */
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const COMPONENT = "FcmServiceAccount";
// A real key file is about 2.4 KiB; anything far larger is not a key file.
const MAXIMUM_FILE_BYTES = 65_536;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,60}[a-z0-9]$/u;
const CLIENT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const OTHERS_PERMISSION_MASK = 0o077;

/** The parts of a Google service-account key that signing a token assertion needs. */
export interface FcmServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  /** The RSA private key as PEM text; it never reaches a log. */
  readonly privateKey: string;
}

type ServiceAccountProblem =
  | "file_unreadable"
  | "invalid_json"
  | "invalid_fields"
  | "invalid_key"
  | "file_permissions_open";

type ParsedServiceAccount =
  | { readonly account: FcmServiceAccount }
  | { readonly problem: ServiceAccountProblem };

interface ServiceAccountFile {
  readonly text: string;
  readonly mode: number;
}

const PROBLEM_MESSAGES: Readonly<Record<ServiceAccountProblem, string>> = {
  file_permissions_open:
    "FCM service account file is accessible by other users; restrict it to the owner",
  file_unreadable: "FCM service account file cannot be read; push stays off",
  invalid_fields:
    "FCM service account file lacks the expected fields; push stays off",
  invalid_json: "FCM service account file is not valid JSON; push stays off",
  invalid_key:
    "FCM service account file holds no usable RSA private key; push stays off",
};

function logProblem(problem: ServiceAccountProblem): void {
  logEvent({
    component: COMPONENT,
    event: "integration.fcm.service_account_problem",
    level: "warn",
    message: PROBLEM_MESSAGES[problem],
    metadata: { reason: problem },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closeQuietly(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch (caughtError: unknown) {
    logCaughtError(COMPONENT, caughtError);
  }
}

function readAccountFile(filePath: string): ServiceAccountFile | null {
  let descriptor: number | null = null;

  try {
    descriptor = openSync(filePath, "r");
    const facts = fstatSync(descriptor);

    if (!facts.isFile() || facts.size > MAXIMUM_FILE_BYTES) {
      return null;
    }

    return { mode: facts.mode, text: readFileSync(descriptor, "utf8") };
  } catch (caughtError: unknown) {
    // A file system error names the path and the errno, never the content.
    logCaughtError(COMPONENT, caughtError);

    return null;
  } finally {
    if (descriptor !== null) {
      closeQuietly(descriptor);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The error message of a failed parse can quote the file; only the fact is kept.
    return undefined;
  }
}

function readTextField(
  record: Readonly<Record<string, unknown>>,
  name: string,
): string | null {
  const field = record[name];

  return typeof field === "string" && field.length > 0 ? field : null;
}

function isRsaPrivateKey(pem: string): boolean {
  try {
    return (
      createPrivateKey({ format: "pem", key: pem }).asymmetricKeyType === "rsa"
    );
  } catch {
    // The error of the key parser is not logged: it is not needed and sits next to key text.
    return false;
  }
}

function readAccountFields(
  record: Readonly<Record<string, unknown>>,
): FcmServiceAccount | null {
  const projectId = readTextField(record, "project_id");
  const clientEmail = readTextField(record, "client_email");
  const privateKey = readTextField(record, "private_key");

  if (
    record["type"] !== "service_account" ||
    projectId === null ||
    clientEmail === null ||
    privateKey === null ||
    !PROJECT_ID_PATTERN.test(projectId) ||
    !CLIENT_EMAIL_PATTERN.test(clientEmail)
  ) {
    return null;
  }

  return { clientEmail, privateKey, projectId };
}

function parseServiceAccount(text: string): ParsedServiceAccount {
  const parsed = parseJson(text);

  if (!isRecord(parsed)) {
    return { problem: "invalid_json" };
  }

  // The endpoint is fixed: a key file must not redirect the signed assertion.
  const tokenUri = parsed["token_uri"];

  if (tokenUri !== undefined && tokenUri !== FCM_TOKEN_ENDPOINT) {
    return { problem: "invalid_fields" };
  }

  const account = readAccountFields(parsed);

  if (account === null) {
    return { problem: "invalid_fields" };
  }

  return isRsaPrivateKey(account.privateKey)
    ? { account }
    : { problem: "invalid_key" };
}

function isOpenToOthers(mode: number): boolean {
  return process.platform !== "win32" && (mode & OTHERS_PERMISSION_MASK) !== 0;
}

/**
 * Reads and validates a Google service-account key file for FCM.
 *
 * @remarks
 * Synchronous, meant for start-up. It never throws and never logs file content
 * or key material: a failure logs one warning with a short `reason` code. A key
 * file whose `token_uri` is not the fixed Google token endpoint is refused, so
 * the signed assertion cannot be sent elsewhere. A file that other users on a
 * POSIX system can access still loads, with a `file_permissions_open` warning.
 *
 * @param filePath - Path of the service-account JSON key file.
 * @returns The account, or `null` when the file is missing, unreadable, not a
 * service-account key, or holds no RSA private key.
 */
export function readFcmServiceAccount(
  filePath: string,
): FcmServiceAccount | null {
  const file = readAccountFile(filePath);

  if (file === null) {
    logProblem("file_unreadable");

    return null;
  }

  const parsed = parseServiceAccount(file.text);

  if ("problem" in parsed) {
    logProblem(parsed.problem);

    return null;
  }

  if (isOpenToOthers(file.mode)) {
    logProblem("file_permissions_open");
  }

  return parsed.account;
}
