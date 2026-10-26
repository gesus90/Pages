import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { McpServer, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AcpPromptContent, AcpSessionListener } from "./AcpChat";
import type { AcpDriver, AcpSessionProfile } from "./AcpDriver";

/** What the session runs: exactly the stored model, effort and prompt of the node. */
export interface AcpSessionRequest extends Pick<
  TextExecutionInput,
  "ticketInputs" | "readTicketAssets"
> {
  readonly directory: string;
  /** The complete prompt; it is sent unchanged as one text block. */
  readonly prompt: string;
  readonly model: string;
  /** `null` leaves the effort to the model's default, as the agent stores it. */
  readonly reasoningEffort: string | null;
  readonly mcpServers: readonly McpServer[];
  readonly sessionMeta: Readonly<Record<string, unknown>>;
  /** Blocks after the prompt text, such as the attachments of a chat message. */
  readonly promptContent?: AcpPromptContent;
  /** A protocol session to continue with `session/resume` instead of starting one. */
  readonly resumeSessionId?: string | null;
}

/** The protocol session that was opened and the options it reported. */
export interface OpenedSession {
  readonly sessionId: string;
  readonly options: readonly SessionConfigOption[];
}

/** What one prompt of the session sends. */
export type AcpPromptRequest = Pick<
  AcpSessionRequest,
  "prompt" | "ticketInputs" | "readTicketAssets" | "promptContent"
>;

/** What one ACP session needs from its surroundings. */
export interface AcpSessionContext {
  readonly instanceId: string;
  /** What differs between the adapters of the runners. */
  readonly driver: Pick<
    AcpDriver,
    | "provider"
    | "errors"
    | "supportedVersions"
    | "isSupportedAdapter"
    | "steeringMeta"
  >;
  readonly profile: AcpSessionProfile;
  readonly request: AcpSessionRequest;
  readonly observer: PlanSessionObserver;
  /** The stop and deadline of the node; the process ends with it. */
  readonly signal: AbortSignal;
  /** How the process is isolated, as the run records it. */
  readonly isolation: string;
  /** Restores the modes of the credential folder after the session. */
  readonly secure: () => Promise<void>;
  /** Masks the exact project credential before any text reaches the observer or turn result. */
  readonly redact?: (text: string) => string;
  /** Safe availability diagnostic, including an explicit reason when credentials are missing. */
  readonly github?: string;
  /** Receives every update and the usage of every prompt, as a chat session shows them. */
  readonly listener?: AcpSessionListener;
  /** Releases the process read only after a native notification and its journal writes were handled. */
  readonly notificationHandled?: () => void;
}
