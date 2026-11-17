/** Stable public messages for plan calls and their execution boundaries. */
export const PLAN_CALL_ERROR_MESSAGES = {
  plan_manual_start_unavailable:
    "This plan only receives calls from other plans. Start it from a calling plan, or add a Start that leads to an End.",
  plan_jump_invalid:
    "The Jump or signal node is not configured correctly. Check its direction, target, wait, signal name and declared values.",
  plan_jump_target_unavailable:
    "The called plan is not available to the person who runs this plan. It was removed, is not shared with them or cannot be started.",
  plan_jump_entry_unavailable:
    "The chosen entry of the called plan no longer exists, is not released for calls or does not lead to an end.",
  plan_jump_interface_changed:
    "The called plan changed after the call was made. Open the Jump node and choose the entry again.",
  plan_jump_input_invalid:
    "A value handed to the called plan is missing or has the wrong type. The called plan was not started.",
  plan_jump_payload_limit:
    "The values of this call are larger than a run keeps. Reduce them; nothing was cut off.",
  plan_jump_cycle:
    "This call would run a plan that is already part of the chain of calls. Plans may not call each other in a circle.",
  plan_jump_timeout: "The called plan did not answer within the set time.",
  plan_jump_target_failed: "The called plan failed.",
  plan_jump_target_cancelled: "The called plan was stopped before it answered.",
  plan_jump_no_signal:
    "The called plan ended without sending the awaited signal.",
  plan_jump_cleanup_open:
    "The called plan ended, but its processes or working copies are not confirmed to be cleaned up.",
  plan_jump_handover_unavailable:
    "The workspace could not be handed over safely: another writer of this plan is still active or the reservation changed.",
  plan_jump_resource_cycle:
    "The called plan waits for a workspace that this plan holds while it waits for the called plan. Share the workspace with this plan, or use a separate workspace.",
  plan_jump_cancelled:
    "The call was cancelled because the calling run stopped or ended.",
  plan_jump_start_conflict:
    "The called run was already created or the call was withdrawn.",
  plan_jump_start_blocked:
    "The called plan has to wait: its plan or a workspace it needs is in use by another run.",
  plan_jump_invocation_missing:
    "The call could not be found after it was stored.",
} as const;
