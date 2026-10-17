import { RequestError, methods } from "@agentclientprotocol/sdk";

import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { findAcpSelectOption } from "./AcpConfigOptions";

import type {
  ClientConnection,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { AcpConfigStep, AcpDriverErrors } from "./AcpDriver";
import type { AcpSessionState } from "./AcpEvents";

/** The session whose stored mode, model and effort are confirmed. */
export interface AcpConfigurationTarget {
  readonly connection: ClientConnection;
  readonly state: AcpSessionState;
  readonly errors: Pick<AcpDriverErrors, "adapterUnsupported">;
  readonly sessionId: string;
}

/** One configuration option the session must take, with the options the adapter showed last. */
interface ConfigSelection extends AcpConfigStep {
  readonly options: readonly SessionConfigOption[];
}

/** Records which stored setting the adapter did not take, so the run record names it. */
function noteRefusal(
  target: AcpConfigurationTarget,
  selection: ConfigSelection,
  reason: string,
): void {
  const adapter = target.state.effective.adapter ?? "the adapter";
  noteSessionEvent(
    target.state.events,
    `${selection.id} ${selection.value} ${reason} (${adapter})`,
  );
}

function refused(
  target: AcpConfigurationTarget,
  selection: ConfigSelection,
  reason: string,
): AgentError {
  noteRefusal(target, selection, reason);
  return new AgentError(selection.refusal);
}

async function setOption(
  target: AcpConfigurationTarget,
  selection: ConfigSelection,
): Promise<readonly SessionConfigOption[]> {
  try {
    const response = await target.connection.agent.request(
      methods.agent.session.setConfigOption,
      {
        sessionId: target.sessionId,
        configId: selection.id,
        value: selection.value,
      },
    );
    return response.configOptions;
  } catch (error: unknown) {
    logCaughtError("AcpSessionConfiguration", error);

    // A refusal of the adapter, not a lost connection, means the value is not offered.
    if (error instanceof RequestError && !target.connection.signal.aborted)
      throw refused(target, selection, "was refused by the adapter");
    throw error;
  }
}

async function select(
  target: AcpConfigurationTarget,
  selection: ConfigSelection,
): Promise<readonly SessionConfigOption[]> {
  const option = findAcpSelectOption(selection.options, selection.id);
  if (option === null) {
    if (selection.isOptional) return selection.options;
    noteRefusal(target, selection, "is not an option of the adapter");
    throw new AgentError(
      selection.refusal === "plan_reasoning_unsupported"
        ? selection.refusal
        : target.errors.adapterUnsupported,
    );
  }
  const isResolved = selection.isResolvedByAdapter === true;
  if (!isResolved && !option.values.includes(selection.value))
    throw refused(
      target,
      selection,
      `is not among ${option.values.join(", ")}`,
    );
  if (!isResolved && option.currentValue === selection.value)
    return selection.options;
  const options = await setOption(target, selection);
  const confirmed = findAcpSelectOption(options, selection.id);
  if (confirmed === null)
    throw refused(target, selection, "was not confirmed by the adapter");
  if (!isResolved && confirmed.currentValue !== selection.value)
    throw refused(
      target,
      selection,
      `was not confirmed, the adapter kept ${confirmed.currentValue}`,
    );
  noteSessionEvent(
    target.state.events,
    isResolved
      ? `${selection.id} ${selection.value} as ${confirmed.currentValue}`
      : `${selection.id} ${selection.value} confirmed`,
  );
  return options;
}

/**
 * Makes the session take every stored option exactly, in order.
 *
 * @param target - The connection, state and session to configure.
 * @param initial - The options the adapter reported for the new session.
 * @param steps - The options to confirm; a model change resets the effort.
 * @returns The options the adapter reported last.
 * @throws {AgentError} With the refusal code of the step whose value the
 * adapter does not offer or confirm.
 */
export async function confirmAcpConfiguration(
  target: AcpConfigurationTarget,
  initial: readonly SessionConfigOption[],
  steps: readonly AcpConfigStep[],
): Promise<readonly SessionConfigOption[]> {
  let options = initial;
  for (const step of steps)
    options = await select(target, { ...step, options });
  return options;
}
