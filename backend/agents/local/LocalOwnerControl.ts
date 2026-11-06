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
