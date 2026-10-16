import type {
  Implementation,
  RequestPermissionOutcome,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type {
  AcpPermissionMode,
  NativeAcpProviderId,
} from "@/definition/AgentConfiguration";
import type { AcpLaunch } from "./AcpLaunch";

/** What Pages answers a permission request of the adapter. */
export interface AcpPermissionDecision {
  readonly outcome: RequestPermissionOutcome;
  /** The request was refused; the run counts it as a permission denial. */
  readonly isDenied: boolean;
}

/** One configuration option the session must take exactly before the prompt. */
export interface AcpConfigStep {
  /** The identifier of the select option, such as `model`. */
  readonly id: string;
  readonly value: string;
  /** Why the node fails when the adapter does not offer or confirm the value. */
  readonly refusal: AgentErrorCode;
  /**
   * The adapter maps the value to a choice of its own, such as a model
   * alias, instead of listing the value itself; the session then confirms
   * only that the adapter accepted it.
   */
  readonly isResolvedByAdapter?: boolean;
  /** A default reset may be absent for a model with no effort selector. */
  readonly isOptional?: boolean;
}

/** The fields of the run record and the identifier of the option each one is read from. */
export type AcpReportedOptions = Readonly<Record<string, string>>;

/** What the stored model and effort of a node are, as the steps are derived from them. */
export interface AcpModelRequest {
  readonly model: string;
  /** `null` leaves the effort to the model's default, as the agent stores it. */
  readonly reasoningEffort: string | null;
}

/**
 * How one Pages mode runs in the ACP adapter of a runner.
 *
 * @remarks
 * The mode decides everything the session may do: the options the adapter
 * confirms before the prompt, the answer to each permission request and the
 * permissions the run records. Nothing of it is free user input.
 */
export interface AcpSessionProfile {
  readonly mode: AcpPermissionMode;
  /** How the session works without anybody approving, as the run records it. */
  readonly unattended: string;
  /** What the session may do, as the run records it. */
  readonly permissions: Readonly<Record<string, string>>;
  /** Where the run record reads the session mode, model and effort from. */
  readonly reportedOptions: AcpReportedOptions;
  /**
   * Whether the model an adapter reports with its first usage update is the
   * stored one; `null` for an adapter that does not report its model.
   */
  readonly matchesReportedModel:
    ((stored: string, reported: string) => boolean) | null;
  /** Whether the Pages MCP server can be checked with the local `/mcp` command. */
  readonly hasMcpStatusCommand: boolean;
  /**
   * Whether a further prompt may continue the session after its turn ended:
   * the Codex sessions and Pica's Claude conversation; a Claude plan node
   * runs one turn.
   */
  readonly isContinuable: boolean;
  /** The options to confirm, in order; a model change resets the effort. */
  steps(request: AcpModelRequest): readonly AcpConfigStep[];
  /** Answers one permission request of the adapter. */
  decide(request: RequestPermissionRequest): AcpPermissionDecision;
}

/** Codes of the failures that name the adapter or the mode of one runner. */
export interface AcpDriverErrors {
  readonly modeRequired: AgentErrorCode;
  readonly adapterMissing: AgentErrorCode;
  readonly adapterUnsupported: AgentErrorCode;
  readonly sessionFailed: AgentErrorCode;
}

/** What a session serves: a plan node, or a conversation with Pica. */
export type AcpSessionPurpose = "plan" | "chat";

/** What starting the adapter for one session needs; nothing of it is free user input. */
export interface AcpLaunchSpecification {
  readonly instanceId: string;
  /** The CLI of the connection, which holds its sign-in. */
  readonly runnerFile: string;
  readonly profile: AcpSessionProfile;
  readonly mcp: CliSessionMcp | null;
  /** A chat session takes the chat profile of the runner; plan nodes are the default. */
  readonly purpose?: AcpSessionPurpose;
  /** Exact assignment, also used to pin a native runner's internal helper models. */
  readonly model?: AcpModelRequest;
}

/**
 * Everything that differs between the ACP adapters of the runners.
 *
 * @remarks
 * The session, its closing and the isolation are shared; a driver supplies the
 * adapter's identity, its start, its modes and the configuration files that
 * could widen a session.
 */
export interface AcpDriver {
  readonly provider: NativeAcpProviderId;
  /** The executable of the adapter, installed next to the runner CLI. */
  readonly binary: string;
  /** Native runners have their own subcommand; external adapters need no arguments. */
  readonly arguments?: readonly string[];
  /** The adapter versions Pages verified, as the run record names them. */
  readonly supportedVersions: string;
  readonly errors: AcpDriverErrors;
  /**
   * The `_meta` of a steering request, or `null` for none.
   *
   * @remarks
   * claude-agent-acp takes `steering.idleBehavior: "promptRequired"`: a steer
   * that finds the turn already ended comes back to Pages instead of starting
   * a turn whose end the client never learns. codex-acp has no such option.
   */
  readonly steeringMeta: Readonly<Record<string, unknown>> | null;
  /** Whether `initialize` came from an adapter version Pages verified. */
  isSupportedAdapter(
    agent: Implementation | null | undefined,
  ): agent is Implementation;
  /** The profile of a mode; the chat purpose has its own narrower profile. */
  profile(
    mode: AcpPermissionMode,
    purpose?: AcpSessionPurpose,
  ): AcpSessionProfile;
  plan(specification: AcpLaunchSpecification): AcpLaunch;
  /**
   * Refuses a start when a configuration file that Pages did not write could
   * widen the session.
   *
   * @throws {AgentError} With the code of the runner when such a file exists.
   */
  requireManagedConfiguration(home: CliHome, directory: string): Promise<void>;
}
