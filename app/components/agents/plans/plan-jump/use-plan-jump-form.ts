import { useState } from "react";

import {
  PLAN_JUMP_DEFAULT_MINUTES,
  PLAN_JUMP_MAX_MINUTES,
  PLAN_JUMP_NAME_LENGTH,
  arePlanEntryInputsValid,
  isPlanSignalName,
} from "@/definition/AgentPlanJump";

import { newPlanJumpIn, newPlanJumpOut } from "./plan-jump-defaults";

import type {
  AgentPlanCallEntry,
  AgentPlanCallTarget,
  AgentPlanJump,
  AgentPlanJumpIn,
  AgentPlanJumpOut,
  AgentPlanJumpWait,
} from "@/definition/AgentPlanJump";

/** What the dialog keeps for both directions, so that switching back and forth loses nothing. */
interface PlanJumpFormState {
  readonly direction: "in" | "out";
  readonly entry: AgentPlanJumpIn;
  readonly call: AgentPlanJumpOut;
  /** The text of the timeout field, which may be unfinished while it is typed. */
  readonly minutes: string;
}

/** What of a receiving Jump the dialog changes. */
type PlanJumpEntryChange = Partial<
  Pick<AgentPlanJumpIn, "name" | "isEnabled" | "inputs">
>;

/** What of a calling Jump the dialog changes. */
type PlanJumpCallChange = Partial<
  Pick<AgentPlanJumpOut, "signalName" | "timeout" | "workspace" | "payloadType">
>;

/** The findings of the settings, as the dialog names them. */
interface PlanJumpFormIssues {
  readonly name: boolean;
  readonly inputs: boolean;
  readonly signalName: boolean;
  readonly timeout: boolean;
}

/** The settings of a Jump node while its dialog is open. */
export interface PlanJumpForm {
  readonly state: PlanJumpFormState;
  readonly issues: PlanJumpFormIssues;
  readonly canApply: boolean;
  readonly setDirection: (direction: "in" | "out") => void;
  readonly changeEntry: (change: PlanJumpEntryChange) => void;
  readonly changeCall: (change: PlanJumpCallChange) => void;
  readonly setWait: (wait: AgentPlanJumpWait) => void;
  readonly setMinutes: (text: string) => void;
  /** Switches between a finite wait and a wait without limit; the finite wait keeps its minutes. */
  readonly setUnlimited: (isUnlimited: boolean) => void;
  /** Chooses the entry of a plan and takes over its inputs and returns as they are now. */
  readonly chooseEntry: (
    target: AgentPlanCallTarget,
    entry: AgentPlanCallEntry,
  ) => void;
  /** The node the settings stand for. */
  readonly result: () => AgentPlanJump;
}

/** The whole minutes a text stands for, or `null` when it is no finite wait of 1 to 30 days. */
function parseMinutes(text: string): number | null {
  if (!/^\d+$/u.test(text)) return null;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= PLAN_JUMP_MAX_MINUTES ? minutes : null;
}

function initialState(
  jump: AgentPlanJump,
  entryName: string,
): PlanJumpFormState {
  const base = { id: jump.id, x: jump.x, y: jump.y };
  const call = jump.direction === "out" ? jump : newPlanJumpOut(base);
  return {
    direction: jump.direction,
    entry: jump.direction === "in" ? jump : newPlanJumpIn(base, entryName),
    call,
    minutes: String(
      call.timeout.kind === "minutes"
        ? call.timeout.minutes
        : PLAN_JUMP_DEFAULT_MINUTES,
    ),
  };
}

function isNameValid(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= PLAN_JUMP_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(trimmed)
  );
}

function issuesOf(state: PlanJumpFormState): PlanJumpFormIssues {
  const { call } = state;
  const isWaiting = call.wait !== "continue";
  return {
    name: !isNameValid(state.entry.name),
    inputs: !arePlanEntryInputsValid(state.entry.inputs),
    signalName:
      call.wait === "signal" && !isPlanSignalName(call.signalName ?? ""),
    timeout:
      isWaiting &&
      call.timeout.kind === "minutes" &&
      parseMinutes(state.minutes) === null,
  };
}

function builtNode(state: PlanJumpFormState): AgentPlanJump {
  if (state.direction === "in")
    return { ...state.entry, name: state.entry.name.trim() };
  const { call } = state;
  const minutes = parseMinutes(state.minutes);
  return call.timeout.kind === "minutes" && minutes !== null
    ? { ...call, timeout: { kind: "minutes", minutes } }
    : call;
}

/**
 * The state of the Jump dialog: both directions, so that switching loses nothing, and what is valid.
 * @param jump - The node the dialog edits.
 * @param entryName - The name a receiving entry starts with when the node was a call.
 * @remarks
 * Switching the direction or the target changes the settings only; the lines
 * and bindings of the plan are never touched here, so the plan shows what no
 * longer fits instead of being rewired.
 */
export function usePlanJumpForm(
  jump: AgentPlanJump,
  entryName: string,
): PlanJumpForm {
  const [state, setState] = useState(() => initialState(jump, entryName));
  const issues = issuesOf(state);
  const isValid =
    state.direction === "in"
      ? !issues.name && !issues.inputs
      : !issues.signalName && !issues.timeout;
  function changeCall(change: PlanJumpCallChange): void {
    setState((previous) => ({
      ...previous,
      call: { ...previous.call, ...change },
    }));
  }
  return {
    state,
    issues,
    canApply: isValid,
    setDirection: (direction) =>
      setState((previous) => ({ ...previous, direction })),
    changeEntry: (change) =>
      setState((previous) => ({
        ...previous,
        entry: { ...previous.entry, ...change },
      })),
    changeCall,
    setWait: (wait) =>
      setState((previous) => ({
        ...previous,
        // A shared workspace needs a wait; a call that does not wait never shares one.
        call: {
          ...previous.call,
          wait,
          workspace: wait === "continue" ? "own" : previous.call.workspace,
          ...(wait === "signal" && !previous.call.signalName
            ? { signalName: "signal" }
            : {}),
        },
      })),
    setMinutes: (minutes) => setState((previous) => ({ ...previous, minutes })),
    setUnlimited: (isUnlimited) =>
      setState((previous) => ({
        ...previous,
        call: {
          ...previous.call,
          timeout: isUnlimited
            ? { kind: "unlimited" }
            : {
                kind: "minutes",
                minutes:
                  parseMinutes(previous.minutes) ?? PLAN_JUMP_DEFAULT_MINUTES,
              },
        },
      })),
    chooseEntry: (target, entry) =>
      setState((previous) => ({
        ...previous,
        call: {
          ...previous.call,
          target: {
            planId: target.planId,
            entryNodeId: entry.entryNodeId,
            planName: target.planName,
            entryName: entry.entryName,
          },
          inputs: entry.inputs,
          returns: entry.returns,
        },
      })),
    result: () => builtNode(state),
  };
}
