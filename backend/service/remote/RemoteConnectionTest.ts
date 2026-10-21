import { isSameHostKey } from "@/backend/remote/SshHostKey";

import type { SshClient } from "@/backend/remote/SshClient";
import type { SshCredentials } from "@/backend/remote/SshOptions";
import type {
  RemoteConnectionCheck,
  RemoteFailureCode,
  RemoteHostKey,
  RemoteTestResult,
  RemoteTestStage,
  RemoteTestStep,
} from "@/definition/RemoteConnection";

/** Everything a connection test needs; nothing of it is stored by the test. */
export interface RemoteTestSubject {
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly credentials: SshCredentials;
  /** The key a person confirmed; without one the sign-in is not attempted. */
  readonly pinnedHostKey: RemoteHostKey | null;
}

const PASSED: RemoteTestStep = { state: "passed", code: null };
const SKIPPED: RemoteTestStep = { state: "skipped", code: null };

function failed(code: RemoteFailureCode): RemoteTestStep {
  return { state: "failed", code };
}

const REACHABILITY_FAILURES: ReadonlySet<RemoteFailureCode> = new Set([
  "host_unknown",
  "unreachable_refused",
  "unreachable_timeout",
  "unreachable_network",
  "not_ssh",
  "transport_lost",
]);

/**
 * The stage a failure belongs to, for the status of a connection.
 *
 * @param failure - The classified failure, or `null` for success.
 * @returns The stage that failed, or `null`.
 */
export function remoteFailureStage(
  failure: RemoteFailureCode | null,
): RemoteTestStage | null {
  if (failure === null) return null;
  if (REACHABILITY_FAILURES.has(failure)) return "reachability";
  if (failure.startsWith("host_key_")) return "host_key";
  return "authentication";
}

/**
 * Tests a connection stage by stage: reachability, host key, sign-in.
 *
 * @remarks
 * The password or key is only sent to a machine that presented the key a
 * person confirmed. A first test therefore stops after showing the presented
 * key; the sign-in follows once the key is confirmed.
 *
 * @param client - The SSH client.
 * @param subject - Machine, account, credentials and pinned key.
 * @returns The result of each stage, with the presented key.
 */
export async function testRemoteConnection(
  client: Pick<SshClient, "probe" | "scanHostKey" | "authenticate">,
  subject: RemoteTestSubject,
): Promise<RemoteTestResult> {
  const testedAt = new Date().toISOString();
  const endpoint = { host: subject.host, port: subject.port };
  const unreachable = await client.probe(endpoint);
  if (unreachable)
    return {
      reachability: failed(unreachable),
      hostKey: SKIPPED,
      authentication: SKIPPED,
      presentedHostKey: null,
      testedAt,
    };
  const presented = await client.scanHostKey(endpoint);
  const base = { reachability: PASSED, testedAt };
  if (typeof presented === "string")
    return {
      ...base,
      hostKey: failed(presented),
      authentication: SKIPPED,
      presentedHostKey: null,
    };
  const pinned = subject.pinnedHostKey;
  if (!pinned || !isSameHostKey(pinned, presented))
    return {
      ...base,
      hostKey: failed(pinned ? "host_key_changed" : "host_key_unconfirmed"),
      authentication: SKIPPED,
      presentedHostKey: presented,
    };
  const refused = await client.authenticate({
    alias: subject.alias,
    host: subject.host,
    port: subject.port,
    username: subject.username,
    hostKey: pinned,
    credentials: subject.credentials,
  });
  return {
    ...base,
    hostKey: PASSED,
    authentication: refused ? failed(refused) : PASSED,
    presentedHostKey: presented,
  };
}

/**
 * Condenses a test into the status a connection keeps.
 *
 * @param result - The finished test.
 * @returns The first failed stage and its cause, or a passed check.
 */
export function remoteCheckOf(result: RemoteTestResult): RemoteConnectionCheck {
  const stages: readonly (readonly [RemoteTestStage, RemoteTestStep])[] = [
    ["reachability", result.reachability],
    ["host_key", result.hostKey],
    ["authentication", result.authentication],
  ];
  const failure = stages.find(([, step]) => step.state === "failed");
  return {
    checkedAt: result.testedAt,
    stage: failure ? failure[0] : null,
    code: failure ? failure[1].code : null,
  };
}
