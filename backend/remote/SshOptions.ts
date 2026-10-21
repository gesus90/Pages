import { SSH_SECRET_VARIABLE } from "./SshRuntimeDirectory";
import { hostKeyAlgorithms } from "./SshHostKey";

import type {
  RemoteAuthMethod,
  RemoteHostKey,
} from "@/definition/RemoteConnection";

/** Where and as whom Pages connects; the pinned key is the only one accepted. */
export interface SshTarget {
  /** Name the pinned key is filed under, independent of host and port. */
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly hostKey: RemoteHostKey;
  readonly credentials: SshCredentials;
}

/** Decrypted credentials, held only for the duration of an SSH operation. */
export interface SshCredentials {
  readonly method: RemoteAuthMethod;
  readonly password: string | null;
  readonly privateKey: string | null;
  readonly passphrase: string | null;
}

/** Files of an SSH operation inside its private scope. */
export interface SshFiles {
  readonly knownHosts: string;
  /** The private key file, for the key methods only. */
  readonly key: string | null;
}

/** Seconds OpenSSH waits for the TCP and SSH handshake. */
export const SSH_CONNECT_TIMEOUT_SECONDS = 10;
/** Keepalive probes; three missed probes end a dead transport after about 30 seconds. */
const KEEPALIVE_INTERVAL_SECONDS = 10;
const KEEPALIVE_COUNT = 3;

function option(name: string, setting: string | number): string[] {
  return ["-o", `${name}=${setting}`];
}

/** Settings that make OpenSSH ignore the server account's own SSH setup. */
function isolationOptions(): string[] {
  return [
    "-F",
    "/dev/null",
    ...option("GlobalKnownHostsFile", "/dev/null"),
    ...option("IdentityAgent", "none"),
    ...option("IdentitiesOnly", "yes"),
    ...option("ForwardAgent", "no"),
    ...option("ForwardX11", "no"),
    ...option("ClearAllForwardings", "yes"),
    ...option("PermitLocalCommand", "no"),
    ...option("RequestTTY", "no"),
    ...option("UpdateHostKeys", "no"),
    ...option("CheckHostIP", "no"),
    ...option("VisualHostKey", "no"),
    ...option("LogLevel", "ERROR"),
  ];
}

/** Accepts only the pinned key, filed under the connection's own alias. */
function hostKeyOptions(target: SshTarget, files: SshFiles): string[] {
  return [
    ...option("StrictHostKeyChecking", "yes"),
    ...option("UserKnownHostsFile", files.knownHosts),
    ...option("HostKeyAlias", target.alias),
    ...option("HostKeyAlgorithms", hostKeyAlgorithms(target.hostKey)),
  ];
}

/** Only the configured method is tried, with one prompt for its secret. */
function authenticationOptions(
  method: RemoteAuthMethod,
  files: SshFiles,
): string[] {
  const prompts = option("NumberOfPasswordPrompts", 1);
  if (method === "password")
    return [
      ...option("PreferredAuthentications", "password,keyboard-interactive"),
      ...option("PubkeyAuthentication", "no"),
      ...prompts,
    ];
  return [
    ...(files.key === null ? [] : ["-i", files.key]),
    ...option("PreferredAuthentications", "publickey"),
    ...option("PasswordAuthentication", "no"),
    ...option("KbdInteractiveAuthentication", "no"),
    ...prompts,
  ];
}

/**
 * Arguments of a connecting `ssh` run up to the destination.
 *
 * @param target - Machine, account, pinned key and credentials.
 * @param files - The private `known_hosts` and key file of the operation.
 * @returns Options followed by `--` and the host.
 */
export function connectArguments(target: SshTarget, files: SshFiles): string[] {
  return [
    ...isolationOptions(),
    ...hostKeyOptions(target, files),
    ...authenticationOptions(target.credentials.method, files),
    ...option("BatchMode", "no"),
    ...option("ConnectTimeout", SSH_CONNECT_TIMEOUT_SECONDS),
    ...option("ServerAliveInterval", KEEPALIVE_INTERVAL_SECONDS),
    ...option("ServerAliveCountMax", KEEPALIVE_COUNT),
    "-p",
    String(target.port),
    "-l",
    target.username,
  ];
}

/**
 * Arguments of a command sent through an open control socket.
 *
 * @remarks
 * Should the socket be gone, OpenSSH would connect on its own; every
 * sign-in method is switched off for that case, so such an attempt fails
 * instead of prompting or using other credentials.
 *
 * @param target - The machine the socket belongs to.
 * @param files - The private `known_hosts` of the operation.
 * @param controlPath - The control socket of the open connection.
 * @returns Options up to, but without, `--` and the host.
 */
export function multiplexArguments(
  target: SshTarget,
  files: SshFiles,
  controlPath: string,
): string[] {
  return [
    ...isolationOptions(),
    ...hostKeyOptions(target, files),
    "-S",
    controlPath,
    ...option("ControlMaster", "no"),
    ...option("BatchMode", "yes"),
    ...option("PubkeyAuthentication", "no"),
    ...option("PasswordAuthentication", "no"),
    ...option("KbdInteractiveAuthentication", "no"),
    ...option("ConnectTimeout", SSH_CONNECT_TIMEOUT_SECONDS),
    "-p",
    String(target.port),
    "-l",
    target.username,
  ];
}

/**
 * The environment of an OpenSSH tool: no variable of the Pages process
 * except the search path, and at most the one secret the prompt needs.
 *
 * @param askpass - The helper OpenSSH asks instead of a terminal.
 * @param secret - The password or passphrase, or `null` for none.
 * @returns A fresh environment.
 */
export function sshEnvironment(
  askpass: string,
  secret: string | null,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LC_ALL: "C",
    LANG: "C",
    SSH_ASKPASS: askpass,
    SSH_ASKPASS_REQUIRE: "force",
    ...(secret === null ? {} : { [SSH_SECRET_VARIABLE]: secret }),
  };
}

/** The secret the askpass helper answers with for a sign-in method. */
export function promptSecret(credentials: SshCredentials): string | null {
  if (credentials.method === "password") return credentials.password;
  if (credentials.method === "key_passphrase") return credentials.passphrase;
  // An empty answer makes OpenSSH report an encrypted key instead of waiting.
  return "";
}

/**
 * Quotes a value as one word of a POSIX shell command line.
 *
 * @param text - Any text without NUL characters.
 * @returns The text in single quotes, with embedded quotes escaped.
 */
export function quoteShellWord(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
