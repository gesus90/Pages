import { fileURLToPath } from "node:url";

import { dashboardBuildSchema } from "@/definition/SystemDashboard";

import type { DashboardBuild } from "@/definition/SystemDashboard";
import type { SystemSources } from "./SystemSources";

/**
 * The deploy writes this beside `build/server/`, independently of the working
 * directory. In the source tree there is no deployment manifest at this location.
 */
const DEPLOYMENT_FILE = fileURLToPath(
  new URL("../deployment.json", import.meta.url),
);

/**
 * Reads only the public build identity and timestamp of the deployed server.
 *
 * @param readText - The dashboard's file reader; missing files return `null`.
 * @returns Validated metadata, or `null` for absent, unreadable or malformed files.
 */
export async function readDeploymentBuild(
  readText: SystemSources["readText"],
): Promise<DashboardBuild | null> {
  try {
    const text = await readText(DEPLOYMENT_FILE);
    if (text === null) return null;
    const manifest: unknown = JSON.parse(text);
    const result = dashboardBuildSchema.safeParse(manifest);
    return result.success ? result.data : null;
  } catch {
    // Deployment metadata is optional; its failure must not hide system metrics.
    return null;
  }
}
