import { join } from "node:path";

import { runnerEndpoint } from "./address.mjs";
import { readRecord, store } from "./journal.mjs";
import {
  confirmRunnerUpdate,
  decodeRunnerPackage,
  stageRunnerUpdate,
  updateDeferral,
} from "./update.mjs";

/** Serialized maintenance shares the transport journal and never interrupts a live claim. */
export class RunnerMaintenance {
  #context;
  #result = { status: "idle" };

  constructor(context) {
    this.#context = context;
  }

  /** Announces the real running version and confirms only a reconciled candidate. */
  async receipt() {
    const { directory, version, configuration } = this.#context;
    await confirmRunnerUpdate(directory, version);
    this.#result =
      (await readRecord(join(directory, "update-result.json"))) ?? this.#result;
    if (
      this.#result.targetVersion === version &&
      this.#result.status === "restarting"
    ) {
      this.#result = { status: "verified", targetVersion: version };
      await store(join(directory, "update-result.json"), this.#result);
    }
    const { status, reason, targetVersion } = this.#result;
    return {
      version: 1,
      type: "maintenance",
      sessionId: configuration.sessionId,
      runnerVersion: version,
      updateVersion: 1,
      status,
      reason,
      targetVersion,
    };
  }

  /** Applies validated address changes before reconnect and stages updates only at a safe boundary. */
  async receive(message) {
    const context = this.#context;
    if (message.sessionId !== context.configuration.sessionId)
      throw new Error("Runner maintenance session mismatch");
    if (message.endpoint && !context.isLocal) {
      const endpoint = runnerEndpoint(message.endpoint, {
        connectionId: context.connectionId,
        allowInsecureLan: message.allowInsecureLan,
      });
      const hasChanged = endpoint !== context.configuration.endpoint;
      context.configuration.endpoint = endpoint;
      context.configuration.allowInsecureLan =
        message.allowInsecureLan === true;
      await context.persist();
      if (hasChanged) {
        context.reconnect(endpoint);
        return;
      }
    }
    if (!message.update || message.update.version === context.version) return;
    const reason = updateDeferral(context.configuration);
    if (reason || process.env.PAGES_RUNNER_SUPERVISED !== "1") {
      this.#result = {
        status: "deferred",
        reason: reason ?? "restart_unavailable",
        targetVersion: message.update.version,
      };
      await store(join(context.directory, "update-result.json"), this.#result);
      return;
    }
    let reasonCode = "package_invalid";
    try {
      decodeRunnerPackage(message.update);
      reasonCode = "exchange_failed";
      await stageRunnerUpdate(context.directory, message.update);
      this.#result = {
        status: "restarting",
        targetVersion: message.update.version,
      };
      context.restart();
    } catch (error) {
      console.error("Runner update refused:", error.code ?? error.message);
      this.#result = {
        status: "failed",
        reason: reasonCode,
        targetVersion: message.update.version,
      };
      await store(join(context.directory, "update-result.json"), this.#result);
    }
  }
}
