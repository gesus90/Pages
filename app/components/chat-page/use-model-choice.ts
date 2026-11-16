import { useEffect, useState } from "react";

import { sendAgentControl, targetFields } from "./agent-control-api";

import type {
  AgentChatControlTarget,
  AgentChatModelChoice,
  AgentChatModelOverview,
} from "@/definition/AgentChatControl";

/** The model and level a person picks in the choice of a chat. */
export interface ModelPick {
  readonly connectionId: string;
  readonly model: string;
  /** `null` follows the default of the model. */
  readonly reasoningEffort: string | null;
}

/** The state of the model choice of an agent in a chat. */
export interface ModelChoiceState {
  readonly overview: AgentChatModelOverview | null;
  readonly query: string;
  setQuery(query: string): void;
  readonly pick: ModelPick | null;
  /** The chosen model of the choice, for its reasoning levels. */
  readonly picked: AgentChatModelChoice | undefined;
  choose(choice: AgentChatModelChoice): void;
  chooseEffort(effort: string | null): void;
  /** The models whose name, ID or connection matches the search. */
  readonly visible: readonly AgentChatModelChoice[];
}

function sameModel(
  choice: Pick<AgentChatModelChoice, "connectionId" | "model">,
  pick: Pick<ModelPick, "connectionId" | "model"> | null,
): boolean {
  return (
    pick !== null &&
    choice.connectionId === pick.connectionId &&
    choice.model === pick.model
  );
}

function initialPick(overview: AgentChatModelOverview): ModelPick {
  const current = overview.override ?? overview.standard;
  return {
    connectionId: current.connectionId,
    model: current.model,
    reasoningEffort: current.reasoningEffort,
  };
}

function matchesQuery(choice: AgentChatModelChoice, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return (
    needle === "" ||
    [choice.name, choice.model, choice.connectionName].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    )
  );
}

/**
 * Reads the model choice of an agent in a chat when the dialog opens and
 * keeps what the person picks.
 * @param target - The chat and its agent; `null` while the dialog is closed.
 */
export function useModelChoice(
  target: AgentChatControlTarget | null,
): ModelChoiceState {
  const [overview, setOverview] = useState<AgentChatModelOverview | null>(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<ModelPick | null>(null);
  const kind = target?.kind;
  const agentId = target?.agentId;
  const conversationId = target?.conversationId;

  useEffect(() => {
    if (kind === undefined || agentId === undefined) return undefined;
    let isCurrent = true;
    setOverview(null);
    setQuery("");
    sendAgentControl({
      intent: "models",
      ...targetFields({ kind, agentId, conversationId }),
    })
      .then((response) => {
        if (!isCurrent || !response.ok || !response.overview) return;
        setOverview(response.overview);
        setPick(initialPick(response.overview));
      })
      .catch((error: unknown) => {
        console.warn("[pages] The model choice could not be read.", error);
      });
    return () => {
      isCurrent = false;
    };
  }, [kind, agentId, conversationId]);

  const choices = overview?.choices ?? [];
  const picked = choices.find((choice) => sameModel(choice, pick));

  function choose(choice: AgentChatModelChoice): void {
    setPick({
      connectionId: choice.connectionId,
      model: choice.model,
      reasoningEffort: null,
    });
  }

  function chooseEffort(effort: string | null): void {
    if (pick !== null) setPick({ ...pick, reasoningEffort: effort });
  }

  return {
    overview,
    query,
    setQuery,
    pick,
    picked,
    choose,
    chooseEffort,
    visible: choices.filter((choice) => matchesQuery(choice, query)),
  };
}
