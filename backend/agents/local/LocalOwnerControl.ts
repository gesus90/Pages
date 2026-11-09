type LocalOwnerSettlement = (instanceId: string) => Promise<boolean | null>;
let settlement: LocalOwnerSettlement | null = null;

/** Installs the instance's stronger local-owner boundary before legacy cleanup can run. */
export function registerLocalOwnerSettlement(
  control: LocalOwnerSettlement,
): void {
  settlement = control;
}

/** A managed native unit may be controlled only through its independently proven owner. */
export async function settleManagedLocalOwner(
  instanceId: string,
): Promise<boolean | null> {
  return settlement ? settlement(instanceId) : null;
}

/** What a managed local owner says about a lease without being contacted. */
export type LocalOwnerInspection = "released" | "owned";

type LocalOwnerInspector = (instanceId: string) => LocalOwnerInspection | null;
let inspector: LocalOwnerInspector | null = null;

/** Installs the read-only view of the instance's managed local owners. */
export function registerLocalOwnerInspection(
  control: LocalOwnerInspector,
): void {
  inspector = control;
}

/**
 * Reads whether a managed local owner holds a lease, without commanding or
 * signalling it.
 *
 * @returns `null` when no managed owner belongs to the lease.
 */
export function inspectManagedLocalOwner(
  instanceId: string,
): LocalOwnerInspection | null {
  return inspector ? inspector(instanceId) : null;
}
