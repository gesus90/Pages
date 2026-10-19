import type { PagesRuntime } from "./PagesRuntime";

/** Warms application services after listening; optional tools never stop HTTP availability. */
export async function startAgentTools(runtime: PagesRuntime): Promise<void> {
  try {
    await runtime.interpreterProfiles.initialize();
    if (runtime.isSetupPending()) return;
    const { getApplicationServices } =
      await import("@/app/lib/services.server");
    await getApplicationServices();
  } catch {
    console.warn(
      "[pages] Agent startup checks could not finish; inspect the Tools page before running agents.",
    );
  }
}
