import { currentCallEntry } from "./plan-jump-model";

import type { TFunction } from "i18next";
import type {
  AgentPlanCallTarget,
  AgentPlanJumpOut,
} from "@/definition/AgentPlanJump";

/** One choice of the target lists. */
export interface PlanTargetOption {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * The plans a Jump may call, with the stored target kept visible when it is no longer offered.
 * @param call - The calling Jump being edited.
 * @param targets - The plans the person may call.
 * @param translate - The translation function.
 * @remarks
 * A plan without a callable entry is shown but cannot be chosen. A stored
 * target that is gone stays selected as unavailable instead of vanishing.
 */
export function planTargetOptions(
  call: Pick<AgentPlanJumpOut, "target">,
  targets: readonly AgentPlanCallTarget[],
  translate: TFunction,
): readonly PlanTargetOption[] {
  const stored = call.target;
  const isListed = targets.some((entry) => entry.planId === stored?.planId);
  const lead: readonly PlanTargetOption[] = [
    ...(stored
      ? []
      : [
          {
            value: "",
            label: translate("plans.jump.choosePlan"),
            disabled: true,
          },
        ]),
    ...(stored && !isListed
      ? [
          {
            value: stored.planId,
            label: translate("plans.jump.unavailablePlan", {
              name: stored.planName,
            }),
            disabled: true,
          },
        ]
      : []),
  ];
  return [
    ...lead,
    ...targets.map((target) => ({
      value: target.planId,
      label: target.planName,
      disabled: !target.entries.some((entry) => !entry.hasReturnConflict),
    })),
  ];
}

/**
 * The entries of the chosen plan, with the stored entry kept visible when it is no longer released.
 * @param call - The calling Jump being edited.
 * @param targets - The plans the person may call.
 * @param translate - The translation function.
 * @remarks
 * An entry whose reachable ends declare contradicting returns is shown but
 * cannot be chosen.
 */
export function planEntryOptions(
  call: Pick<AgentPlanJumpOut, "target">,
  targets: readonly AgentPlanCallTarget[],
  translate: TFunction,
): readonly PlanTargetOption[] {
  const stored = call.target;
  const chosen = targets.find((entry) => entry.planId === stored?.planId);
  const isListed = currentCallEntry(call, targets) !== null;
  return [
    ...(stored
      ? []
      : [
          {
            value: "",
            label: translate("plans.jump.chooseEntry"),
            disabled: true,
          },
        ]),
    ...(stored && chosen && !isListed
      ? [
          {
            value: stored.entryNodeId,
            label: translate("plans.jump.unavailableEntry", {
              name: stored.entryName,
            }),
            disabled: true,
          },
        ]
      : []),
    ...(chosen?.entries ?? []).map((entry) => ({
      value: entry.entryNodeId,
      label: `${entry.entryName} · ${translate(
        `plans.jump.entryKind.${entry.kind}`,
      )}`,
      disabled: entry.hasReturnConflict,
    })),
  ];
}
