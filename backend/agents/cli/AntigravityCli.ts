import { lstat } from "node:fs/promises";
import path from "node:path";

import { methods, RequestError } from "@agentclientprotocol/sdk";

import { requireManagedAntigravityConfiguration } from "@/backend/agents/acp/AntigravityConfiguration";
import {
  ANTIGRAVITY_APP_DATA_DIRECTORY,
  ANTIGRAVITY_EFFORT_OPTION,
  ANTIGRAVITY_TOKEN_FILE,
  antigravityAcpArguments,
} from "@/backend/agents/acp/AntigravityAcpLaunch";
import {
  isCatalogModelId,
  reasoningLevels,
  reasoningWithoutLevels,
} from "@/backend/agents/catalog/CatalogParsing";
import { findAcpSelectOption } from "@/backend/agents/acp/AcpConfigOptions";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import { AntigravityProtocol, antigravityFailure } from "./AntigravityProtocol";
import { readAntigravityUsage } from "./AntigravityUsageResult";
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
import type { AntigravityQuotaGroup } from "@/definition/AntigravityQuota";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** The largest number of models one ACP picker may offer. */
const PICKER_LIMIT = 1000;

/** One model of the ACP picker: its selector and its display name. */
interface PickerEntry {
  readonly value: string;
  readonly name: string;
}

/** Every entry of the session's `model` select, also those inside groups. */
function pickerEntries(
  options: readonly SessionConfigOption[],
): readonly PickerEntry[] {
  const picker = options.find(
    (option) => option.id === "model" && option.type === "select",
  );
  if (!picker || picker.type !== "select")
    throw new AgentError("cli_unexpected_output");
  const entries = picker.options.flatMap((entry) =>
    "group" in entry ? entry.options : [entry],
  );
  if (entries.length === 0 || entries.length > PICKER_LIMIT)
    throw new AgentError("cli_unexpected_output");
  return entries;
}

/** Logs why one offered model is not part of the catalog. */
function logSkippedModel(entry: PickerEntry, reason: string): void {
  logEvent({
    level: "warn",
    event: "antigravity.catalog.model_skipped",
    component: "AntigravityCli",
    message: `Antigravity model "${entry.value}" (${entry.name}) left out of the catalog`,
    metadata: { provider: "antigravity", reason },
  });
}

/** Whether a failure belongs to one model's selection rather than to the whole session. */
function isModelRefusal(error: unknown, signal: AbortSignal): boolean {
  return (
    !signal.aborted &&
    (error instanceof AgentError || error instanceof RequestError)
  );
}

/**
 * Selects one offered model and reads its own thinking levels.
 * @returns The catalog entry, or `null` when Pages cannot accept the
 * selector or the adapter refuses to select it; the reason is logged.
 * @throws The failure of the session itself, such as a closed connection or
 * an aborted listing.
 */
async function readCatalogModel(
  protocol: AntigravityProtocol,
  input: {
    readonly sessionId: string;
    readonly options: readonly SessionConfigOption[];
    readonly entry: PickerEntry;
    readonly signal: AbortSignal;
  },
): Promise<AgentCatalogModel | null> {
  const { entry } = input;
  if (!isCatalogModelId(entry.value)) {
    logSkippedModel(entry, "selector_invalid");
    return null;
  }
  let options: readonly SessionConfigOption[];
  try {
    options = await protocol.select(input.sessionId, input.options, {
      id: "model",
      value: entry.value,
      error: "plan_model_unavailable",
    });
  } catch (error: unknown) {
    if (!isModelRefusal(error, input.signal)) throw error;
    logSkippedModel(
      entry,
      error instanceof AgentError ? error.code : "selection_refused",
    );
    return null;
  }
  const thinking = findAcpSelectOption(options, ANTIGRAVITY_EFFORT_OPTION);
  return {
    id: entry.value,
    name: entry.name,
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    ...(thinking
      ? reasoningLevels(thinking.values, thinking.currentValue)
      : reasoningWithoutLevels("unknown")),
  };
}

/** Uses oauth-personal through `agy acp` in the connection's isolated context. */
export class AntigravityCli implements CliLoginAdapter {
  public readonly provider = "antigravity";
  private readonly execution: CliToolExecution;

  public constructor(execution: CliToolExecution) {
    this.execution = execution;
  }

  /** A handshake proves the installed CLI's ACP version without a login or model call. */
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

  /**
   * Runs the official headless sign-in, `agy acp --login`, in the given context.
   * @remarks
   * The CLI prints Google's PKCE authorization URL and waits for the code of
   * Google's Antigravity page, which the administrator pastes into Pages. The
   * token lands in this context only; the caller moves it into the connection
   * after a confirmed status check.
   */
  public startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess {
    const [command, ...options] = antigravityAcpArguments(home);
    let running: CliRunningProcess | null = null;
    let cancelled: AgentErrorCode | null = null;
    const refused = (code: AgentErrorCode): CliProcessResult => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      errorCode: code,
    });
    const completed = requireManagedAntigravityConfiguration(home).then(
      () => {
        // A cancel that arrived during the configuration check starts nothing.
        if (cancelled) return refused(cancelled);
        running = this.execution.startLogin(home, {
          arguments: [command, "--login", ...options],
          parse: readAntigravityChallenge,
          onChallenge,
        });
        return running.completed;
      },
      (error: unknown) =>
        refused(error instanceof AgentError ? error.code : "login_failed"),
    );
    return {
      completed,
      cancel: (code) => {
        cancelled = code;
        running?.cancel(code);
      },
      write: (code) => running?.write(code) ?? false,
    };
  }

  /** Preserves cancellation/expiry and stable provider errors without raw diagnostics. */
  public loginError(result: CliProcessResult): AgentErrorCode {
    return result.errorCode ?? "login_failed";
  }

  /**
   * Reads model family selectors and their own thinking levels, without generating output.
   * @remarks
   * Every model the ACP picker offers is listed, whatever its family: Gemini,
   * Claude, GPT-OSS or an orchestrator. One model whose selector Pages cannot
   * accept or whose selection the adapter refuses is left out with its reason
   * in the server log, so it never discards the other models of the listing.
   * A listing without a single usable model fails as before.
   */
  public async listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    await this.requireLogin(home);
    return this.withProtocol(home, signal, async (protocol) => {
      await protocol.initialize();
      const session = await protocol.newSession(home);
      const entries = pickerEntries(session.configOptions ?? []);
      const models: AgentCatalogModel[] = [];
      for (const entry of entries) {
        const model = await readCatalogModel(protocol, {
          sessionId: session.sessionId,
          options: session.configOptions ?? [],
          entry,
          signal,
        });
        if (model) models.push(model);
      }
      if (models.length === 0) throw new AgentError("cli_unexpected_output");
      return models;
    });
  }

  /**
   * Reads the quota groups of the connection's account through the adapter's
   * `/usage` command, without a model answer.
   * @param home - The connection's isolated context.
   * @param signal - Deadline of the query.
   * @returns Every group and window the adapter reported.
   * @throws {AgentError} `cli_not_logged_in` without a confirmed sign-in, or
   * the failure code of the ACP session; a session that cannot run `/usage`
   * fails with `cli_unexpected_output` before any model is called.
   * @remarks
   * The query runs in the same isolated ACP context as every other
   * Antigravity operation, so it uses exactly the account of the connection
   * and never the sign-in of a terminal.
   */
  public async readUsage(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AntigravityQuotaGroup[]> {
    try {
      await this.requireLogin(home);
      return await this.withProtocol(home, signal, async (protocol) => {
        await protocol.initialize();
        const session = await protocol.newSession(home);
        return readAntigravityUsage(await protocol.usage(session.sessionId));
      });
    } catch (error: unknown) {
      throw new AgentError(antigravityFailure(error, signal));
    }
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
          id: ANTIGRAVITY_EFFORT_OPTION,
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
          findAcpSelectOption(options, ANTIGRAVITY_EFFORT_OPTION)
            ?.currentValue !== selection.reasoningEffort)
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
      path.join(
        home.config,
        ANTIGRAVITY_APP_DATA_DIRECTORY,
        ANTIGRAVITY_TOKEN_FILE,
      ),
    ).catch(() => null);
    if (!token?.isFile() || token.isSymbolicLink())
      throw new AgentError("cli_not_logged_in");
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
  ): Promise<T> {
    await requireManagedAntigravityConfiguration(home);
    const protocol = await AntigravityProtocol.open(this.execution, home, {
      signal,
    });
    try {
      return await operation(protocol);
    } finally {
      await protocol.close();
    }
  }
}
