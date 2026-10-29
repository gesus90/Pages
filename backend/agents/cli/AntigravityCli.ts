import { lstat } from "node:fs/promises";
import path from "node:path";

import { methods } from "@agentclientprotocol/sdk";

import { requireManagedAntigravityConfiguration } from "@/backend/agents/acp/AntigravityConfiguration";
import {
  isCatalogModelId,
  reasoningLevels,
  reasoningWithoutLevels,
} from "@/backend/agents/catalog/CatalogParsing";
import { findAcpSelectOption } from "@/backend/agents/acp/AcpConfigOptions";
import { AgentError } from "@/backend/error/AgentErrors";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { AntigravityProtocol, antigravityFailure } from "./AntigravityProtocol";
import { readAntigravityChallenge } from "./CliLoginParser";

import type {
  CliHome,
  CliLoginAdapter,
  CliLoginChallenge,
  CliRunningProcess,
  CliProcessResult,
  CliModelSelection,
  CliStatusOutcome,
} from "./CliContracts";
import type { CliToolExecution } from "./CliToolExecution";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** Uses oauth-personal in the connection's isolated official ACP context. */
export class AntigravityCli implements CliLoginAdapter {
  public readonly provider = "antigravity";
  private readonly execution: CliToolExecution;

  public constructor(execution: CliToolExecution) {
    this.execution = execution;
  }

  /** A handshake proves the installed adapter version without a login or model call. */
  public async version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.check(home, signal, async (protocol) => ({
      ok: true,
      detail: { cliVersion: (await protocol.initialize()).agentInfo?.version },
    }));
  }

  /** Checks the actual ACP context; never claims that an agy terminal login is sufficient. */
  public async readStatus(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<CliStatusOutcome> {
    const outcome = await this.check(home, signal, async (protocol) => {
      await this.requireLogin(home);
      await protocol.initialize();
      await protocol.newSession(home);
      return { ok: true, detail: { authMethod: "oauth-personal" } };
    });
    return { outcome, accountLabel: null };
  }

  /** Exposes only the provider's HTTPS challenge; the adapter owns the loopback callback. */
  public startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess {
    const controller = new AbortController();
    const handshake = setTimeout(
      () => controller.abort(new AgentError("cli_unexpected_output")),
      20_000,
    );
    const completed = this.login(home, controller.signal, (challenge) => {
      clearTimeout(handshake);
      onChallenge(challenge);
    });
    void completed.then(() => clearTimeout(handshake));
    return {
      completed,
      cancel: (code) => controller.abort(new AgentError(code)),
      write: () => false,
    };
  }

  /** Preserves cancellation/expiry and stable provider errors without raw diagnostics. */
  public loginError(result: CliProcessResult): AgentErrorCode {
    return result.errorCode ?? "login_failed";
  }

  /** Reads model family selectors and their own thinking levels, without generating output. */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    await this.requireLogin(home);
    return this.withProtocol(home, signal, async (protocol) => {
      await protocol.initialize();
      const session = await protocol.newSession(home);
      const picker = session.configOptions?.find(
        (option) => option.id === "model" && option.type === "select",
      );
      if (!picker || picker.type !== "select")
        throw new AgentError("cli_unexpected_output");
      const entries = picker.options.flatMap((entry) =>
        "group" in entry ? entry.options : [entry],
      );
      if (entries.length === 0 || entries.length > 1000)
        throw new AgentError("cli_unexpected_output");
      const models: AgentCatalogModel[] = [];
      for (const entry of entries) {
        if (!isCatalogModelId(entry.value))
          throw new AgentError("cli_unexpected_output");
        const options = await protocol.select(
          session.sessionId,
          session.configOptions ?? [],
          { id: "model", value: entry.value, error: "plan_model_unavailable" },
        );
        const thinking = findAcpSelectOption(options, "thinking_level");
        models.push({
          id: entry.value,
          name: entry.name,
          contextWindow: null,
          promptPrice: null,
          completionPrice: null,
          isFree: false,
          ...(thinking
            ? reasoningLevels(thinking.values, thinking.currentValue)
            : reasoningWithoutLevels("unknown")),
        });
      }
      return models;
    });
  }

  /** An explicit check requires the saved exact model and effort; no default model fallback. */
  public async runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.check(home, signal, async (protocol) => {
      await this.requireLogin(home);
      if (!selection.model) throw new AgentError("plan_model_unavailable");
      await protocol.initialize();
      const session = await protocol.newSession(home);
      let options = await protocol.select(
        session.sessionId,
        session.configOptions ?? [],
        {
          id: "model",
          value: selection.model,
          error: "plan_model_unavailable",
        },
      );
      if (selection.reasoningEffort !== null)
        options = await protocol.select(session.sessionId, options, {
          id: "thinking_level",
          value: selection.reasoningEffort,
          error: "plan_reasoning_unsupported",
        });
      options = await protocol.select(session.sessionId, options, {
        id: "mode",
        value: "default",
        error: "plan_permission_mode_unenforceable",
      });
      if (
        findAcpSelectOption(options, "model")?.currentValue !==
          selection.model ||
        (selection.reasoningEffort !== null &&
          findAcpSelectOption(options, "thinking_level")?.currentValue !==
            selection.reasoningEffort)
      )
        throw new AgentError("plan_context_changed");
      if (!(await protocol.test(session.sessionId, MODEL_TEST_PROMPT)))
        throw new AgentError("cli_check_failed");
      return {
        ok: true,
        detail: {
          model: selection.model,
          ...(selection.reasoningEffort
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
        },
      };
    });
  }

  /** Revokes only the isolated ACP account, and only when logout is advertised. */
  public async logout(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    return this.check(home, signal, async (protocol) => {
      const initialized = await protocol.initialize();
      if (!initialized.agentCapabilities?.auth?.logout)
        throw new AgentError("antigravity_acp_unsupported");
      await protocol.connection.agent.request(methods.agent.logout, {});
      return { ok: true, detail: {} };
    });
  }

  private async requireLogin(home: CliHome): Promise<void> {
    // Metadata only: the adapter alone reads or refreshes its private token.
    const token = await lstat(
      path.join(home.config, "antigravity-acp", "acp_token.json"),
    ).catch(() => null);
    if (!token?.isFile() || token.isSymbolicLink())
      throw new AgentError("cli_not_logged_in");
  }

  private async login(
    home: CliHome,
    signal: AbortSignal,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): Promise<CliProcessResult> {
    try {
      await this.withProtocol(
        home,
        signal,
        async (protocol) => {
          await protocol.initialize();
          await protocol.connection.agent.request(methods.agent.authenticate, {
            methodId: "oauth-personal",
          });
        },
        (tail) => {
          const challenge = readAntigravityChallenge(tail);
          if (challenge) onChallenge(challenge);
        },
      );
      return { exitCode: 0, stdout: "", stderr: "", errorCode: null };
    } catch (error: unknown) {
      const errorCode = antigravityFailure(error, signal);
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        errorCode:
          signal.aborted && signal.reason instanceof AgentError
            ? signal.reason.code
            : errorCode,
      };
    }
  }

  private async check(
    home: CliHome,
    signal: AbortSignal,
    operation: (protocol: AntigravityProtocol) => Promise<ProviderCheckOutcome>,
  ): Promise<ProviderCheckOutcome> {
    try {
      return await this.withProtocol(home, signal, operation);
    } catch (error: unknown) {
      return {
        ok: false,
        errorCode: antigravityFailure(error, signal),
        detail: {},
      };
    }
  }

  private async withProtocol<T>(
    home: CliHome,
    signal: AbortSignal,
    operation: (protocol: AntigravityProtocol) => Promise<T>,
    onStderr?: (tail: string) => void,
  ): Promise<T> {
    await requireManagedAntigravityConfiguration(home);
    const protocol = await AntigravityProtocol.open(this.execution, home, {
      signal,
      onStderr,
    });
    try {
      return await operation(protocol);
    } finally {
      await protocol.close();
    }
  }
}
