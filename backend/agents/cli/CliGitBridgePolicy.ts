import { timingSafeEqual } from "node:crypto";

/** The two Git services a bridge can run; nothing else reaches the host. */
export type GitBridgeService = "git-upload-pack" | "git-receive-pack";

/** What one bridge may do; fixed when its session starts. */
export interface GitBridgePolicy {
  readonly capability: string;
  readonly repository: string;
  readonly pushRefs: readonly string[];
}

/** The reading of the first bytes a session sends to its bridge. */
export type GitBridgeDecision =
  | { readonly isAllowed: true; readonly service: GitBridgeService }
  | { readonly isAllowed: false; readonly reason: string };

/** The reading of the update commands of a push. */
export type ReceiveCommands =
  | { readonly state: "incomplete" }
  | { readonly state: "refused"; readonly reason: string }
  | { readonly state: "complete"; readonly refs: readonly string[] };

const COMMAND_PATTERN = /^(git-upload-pack|git-receive-pack) '([^'\\]+)'$/u;
const UPDATE_PATTERN = /^[a-f\d]{40,64} ([a-f\d]{40,64}) (refs\/\S+)$/u;
const DELETED_OBJECT = /^0+$/u;
/** Update commands are small; anything larger is not a closeout. */
const MAXIMUM_COMMAND_BYTES = 1024 * 1024;

function isSameCapability(sent: unknown, capability: string): boolean {
  if (typeof sent !== "string") return false;
  const expected = Buffer.from(capability);
  const received = Buffer.from(sent);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function requestedRepository(path: string): string {
  return path.replace(/^\//u, "").replace(/\.git$/u, "");
}

function parseRequest(line: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : null;
  } catch {
    return null;
  }
}

/**
 * Decides a bridge request before anything reaches the host's SSH client.
 *
 * @param line - The request line of the session.
 * @param policy - The capability of this session.
 * @returns The service to run with the values of the policy, or the refusal.
 *
 * @remarks
 * The repository the bridge contacts always comes from the policy. The request
 * can only match it, so no text of the session reaches an argument vector.
 */
export function decideBridgeRequest(
  line: string,
  policy: GitBridgePolicy,
): GitBridgeDecision {
  const request = parseRequest(line);
  if (request === null) return { isAllowed: false, reason: "invalid request" };
  if (!isSameCapability(request.capability, policy.capability))
    return { isAllowed: false, reason: "not this session" };
  if (request.destination !== "git@github.com")
    return { isAllowed: false, reason: "destination not allowed" };
  const match =
    typeof request.command === "string"
      ? COMMAND_PATTERN.exec(request.command)
      : null;
  if (!match?.[1] || !match[2])
    return { isAllowed: false, reason: "only Git fetch and push are allowed" };
  if (requestedRepository(match[2]) !== policy.repository)
    return {
      isAllowed: false,
      reason: `only ${policy.repository} is allowed`,
    };
  if (match[1] === "git-upload-pack")
    return { isAllowed: true, service: "git-upload-pack" };
  return policy.pushRefs.length > 0
    ? { isAllowed: true, service: "git-receive-pack" }
    : { isAllowed: false, reason: "this session may only fetch" };
}

function readCommand(
  payload: string,
  pushRefs: readonly string[],
): { readonly ref: string | null; readonly reason: string | null } {
  const command = payload.split("\0", 1)[0]?.replace(/\n$/u, "") ?? "";
  if (command.startsWith("shallow ")) return { ref: null, reason: null };
  const match = UPDATE_PATTERN.exec(command);
  if (!match?.[1] || !match[2])
    return { ref: null, reason: "unsupported push command" };
  if (DELETED_OBJECT.test(match[1]))
    return { ref: null, reason: `deleting ${match[2]} is not allowed` };
  return pushRefs.includes(match[2])
    ? { ref: match[2], reason: null }
    : { ref: null, reason: `updating ${match[2]} is not allowed` };
}

/**
 * Reads the update commands at the start of a push, up to their flush packet.
 *
 * @param buffer - What the session sent so far.
 * @param pushRefs - The branches this session may update.
 * @returns The named branches once the list is complete, or a refusal.
 *
 * @remarks
 * Nothing is forwarded before this answers, so a refused update never reaches
 * GitHub. A dry run sends no command at all. Whether an update is a fast-forward
 * cannot be told here: that takes the objects, which only GitHub has.
 */
export function readReceiveCommands(
  buffer: Buffer,
  pushRefs: readonly string[],
): ReceiveCommands {
  const refs: string[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const header = buffer.toString("latin1", offset, offset + 4);
    const length = /^[a-f\d]{4}$/iu.test(header) ? parseInt(header, 16) : -1;
    if (length === 0) return { state: "complete", refs };
    if (length < 4) return { state: "refused", reason: "invalid push data" };
    if (offset + length > buffer.length) break;
    const payload = buffer.toString("utf8", offset + 4, offset + length);
    const { ref, reason } = readCommand(payload, pushRefs);
    if (reason !== null) return { state: "refused", reason };
    if (ref !== null) refs.push(ref);
    offset += length;
  }
  return buffer.length > MAXIMUM_COMMAND_BYTES
    ? { state: "refused", reason: "push commands too large" }
    : { state: "incomplete" };
}
