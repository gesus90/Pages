import { QUOTA_CARD_CLASS } from "./quota-card-layout";

import type { ReactNode } from "react";
import type { QuotaAccount } from "@/definition/AgentQuota";

/** Common surface and alignment for a provider card in the quota grid. */
export function QuotaCardFrame({
  connectionId,
  provider,
  isLoading,
  isQuerying,
  children,
}: {
  readonly connectionId: string;
  readonly provider?: QuotaAccount["provider"];
  readonly isLoading: boolean;
  readonly isQuerying: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <article
      data-quota-card={connectionId}
      data-quota-provider={provider}
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isQuerying}
      className={QUOTA_CARD_CLASS}
    >
      {children}
    </article>
  );
}
