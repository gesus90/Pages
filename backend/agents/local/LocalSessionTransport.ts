import { request } from "node:http";
import { createHash } from "node:crypto";

import { logEvent } from "@/backend/logging/Logger";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";

import type {
  LocalSessionCommand,
  LocalOwnerManifest,
} from "./LocalSessionContracts";

/** Short socket names remain private even when the instance path is longer than a Unix socket limit. */
export function localSessionSocket(manifest: LocalOwnerManifest): string {
  const suffix = createHash("sha256")
    .update(`${manifest.instanceKey}:${manifest.launch.instanceId}`)
    .digest("hex")
    .slice(0, 32);
  return `/run/user/${process.getuid?.()}/pages-local-${suffix}.sock`;
}

/** Sends a bounded authenticated request; credentials and response bodies are never logged. */
export function sendLocalCommand(
  manifest: LocalOwnerManifest,
  command: LocalSessionCommand,
  attachment?: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(command);
    const outgoing = request(
      {
        socketPath: localSessionSocket(manifest),
        method: "POST",
        path: "/",
        headers: {
          authorization: `Bearer ${manifest.capability}`,
          "x-pages-attachment": attachment ?? "",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let received = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          received += chunk;
          if (Buffer.byteLength(received) > 2 * 1024 * 1024)
            outgoing.destroy(new Error("Local control response is too large"));
        });
        response.on("error", () =>
          reject(localCommandFailure(command, response.statusCode, "")),
        );
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(localCommandFailure(command, response.statusCode, received));
            return;
          }
          try {
            const result: unknown = JSON.parse(received);
            resolve(result);
          } catch {
            reject(new Error("Invalid local session control response"));
          }
        });
      },
    );
    outgoing.setTimeout(35_000, () =>
      outgoing.destroy(new Error("Local session control timed out")),
    );
    outgoing.on("error", () =>
      reject(localCommandFailure(command, undefined, "")),
    );
    outgoing.end(body);
  });
}

/** Maps only known codes; owner payloads and exception messages never enter diagnostics. */
function localCommandFailure(
  command: LocalSessionCommand,
  statusCode: number | undefined,
  body: string,
): AgentError {
  let code = "plan_local_control_failed";
  try {
    const result: unknown = JSON.parse(body);
    if (typeof result === "object" && result !== null) {
      const receivedCode: unknown = Reflect.get(result, "error");
      if (isAgentErrorCode(receivedCode)) code = receivedCode;
    }
  } catch {
    // An empty or malformed response carries no safe owner diagnosis.
  }
  logEvent({
    level: "warn",
    event: "local.session.control_failed",
    component: "LocalSessionTransport",
    message: "Local owner control command failed",
    metadata: { operation: command.kind, statusCode, code },
  });
  return new AgentError(
    statusCode === 403
      ? "plan_local_owner_unverified"
      : "plan_local_control_failed",
  );
}
