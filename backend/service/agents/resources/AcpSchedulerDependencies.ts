import type {
  AcpResourceOptions,
  AcpResourceLimitSource,
} from "@/definition/AcpResource";
import type { AcpRecoveryScope } from "./AcpLeaseAdmission";
import type { AcpResourceStore } from "./AcpResourceStore";

/** Process-local boundaries and shared lease storage of the existing ACP scheduler. */
export interface SchedulerDependencies {
  readonly recoveryScope?: AcpRecoveryScope;
  readonly readOptions?: () => Promise<AcpResourceOptions>;
  readonly store: AcpResourceStore;
  readonly options?: Partial<AcpResourceOptions>;
  readonly limitSource?: AcpResourceLimitSource;
  readonly memory?: () => Promise<number | null>;
  /** Ends the processes of a lease; `startedAt` is `null` when its start is unknown. */
  readonly cleanup?: (
    instanceId: string,
    startedAt: string | null,
  ) => Promise<{ readonly remaining: number }>;
}
