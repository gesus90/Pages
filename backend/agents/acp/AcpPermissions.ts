import type {
  PermissionOptionKind,
  RequestPermissionOutcome,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import type { AcpPermissionDecision } from "./AcpDriver";

/**
 * Picks the option of the first kind a request offers.
 *
 * @param request - The permission request of the adapter.
 * @param kinds - The kinds that answer the request the way Pages decided.
 * @returns The selected option, or a cancellation when none is offered.
 */
export function selectPermissionOption(
  request: RequestPermissionRequest,
  kinds: readonly PermissionOptionKind[],
): RequestPermissionOutcome {
  for (const kind of kinds) {
    const option = request.options.find((entry) => entry.kind === kind);
    if (option) return { outcome: "selected", optionId: option.optionId };
  }
  return { outcome: "cancelled" };
}

/** Approves a request once; nothing is stored for later runs. */
export function approvePermission(
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  return {
    outcome: selectPermissionOption(request, ["allow_once", "allow_always"]),
    isDenied: false,
  };
}

/** Refuses a request; the run counts it as a permission denial. */
export function refusePermission(
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  return {
    outcome: selectPermissionOption(request, ["reject_once", "reject_always"]),
    isDenied: true,
  };
}
