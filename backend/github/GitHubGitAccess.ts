import { logCaughtError } from "@/backend/logging/Logger";

/** What GitHub answers for a project token on the Git push endpoint of its repository. */
export type GitHubWriteAccess = "verified" | "rejected" | "denied" | "unknown";

/** The part of a fetch response the probe reads. */
interface GitAccessResponse {
  readonly status: number;
  readonly body?: { cancel(): Promise<void> } | null;
}

/** Sends the probe; injectable so no caller depends on the real network. */
type GitAccessRequest = (
  url: string,
  init: {
    readonly headers: Record<string, string>;
    readonly redirect: "error";
    readonly signal: AbortSignal;
  },
) => Promise<GitAccessResponse>;

const PROBE_TIMEOUT_MS = 10_000;

function readWriteAccess(status: number): GitHubWriteAccess {
  if (status === 200) return "verified";
  if (status === 401) return "rejected";
  return status === 403 || status === 404 ? "denied" : "unknown";
}

/**
 * Asks GitHub whether a token may push to a repository, without changing anything.
 *
 * @param repository - The validated `owner/name` of the project connection.
 * @param token - The token of that project; it only goes to github.com, never through a redirect.
 * @param request - Sends the request; defaults to the real network.
 * @returns The answer of GitHub, `unknown` when GitHub could not be asked.
 *
 * @remarks
 * This is the same reference advertisement `git push` starts with. It proves
 * the write permission of fine-grained tokens as well, which the `permissions`
 * of the REST API do not.
 */
export async function probeGitHubWriteAccess(
  repository: string,
  token: string,
  request: GitAccessRequest = fetch,
): Promise<GitHubWriteAccess> {
  try {
    const credential = Buffer.from(`x-access-token:${token}`).toString(
      "base64",
    );
    const response = await request(
      `https://github.com/${repository}.git/info/refs?service=git-receive-pack`,
      {
        headers: {
          Authorization: `Basic ${credential}`,
          "User-Agent": "git/pages-access-probe",
        },
        redirect: "error",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    await response.body?.cancel();
    return readWriteAccess(response.status);
  } catch (caughtError: unknown) {
    logCaughtError("GitHubGitAccess", caughtError);

    return "unknown";
  }
}
