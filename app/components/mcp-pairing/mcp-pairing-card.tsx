import { McpPairingOpen } from "./mcp-pairing-open";
import { McpPairingOutcome } from "./mcp-pairing-outcome";

import type { McpPairingPageData } from "@/definition/McpDevice";

/**
 * Renders the content of the pairing card for the state of the code.
 *
 * @remarks
 * An open code shows the confirmation, every other state one sentence with its
 * symbol. The open view is keyed by its code so that a new code restarts the
 * countdown.
 */
export function McpPairingCard({
  pairing,
}: {
  readonly pairing: McpPairingPageData;
}): React.ReactElement {
  if (
    pairing.state === "open" &&
    pairing.code !== null &&
    pairing.deviceName !== null &&
    pairing.remainingMs !== null
  ) {
    return (
      <McpPairingOpen
        key={pairing.code}
        code={pairing.code}
        deviceName={pairing.deviceName}
        remainingMs={pairing.remainingMs}
        server={pairing.server}
        accountName={pairing.accountName}
      />
    );
  }

  return (
    <McpPairingOutcome
      state={pairing.state === "open" ? "invalid" : pairing.state}
      deviceName={pairing.deviceName}
    />
  );
}
