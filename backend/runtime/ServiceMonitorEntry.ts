import path from "node:path";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { ServiceMonitorService } from "@/backend/service/ServiceMonitorService";

/** One timer-triggered observation; neither a database nor an application process must be available. */
export async function observeServices(
  argumentList: readonly string[],
): Promise<void> {
  const configIndex = argumentList.indexOf("--config");
  const instanceIndex = argumentList.indexOf("--instance");
  const unitsIndex = argumentList.indexOf("--units");
  const configPath = argumentList[configIndex + 1];
  const instance =
    instanceIndex < 0 ? "default" : argumentList[instanceIndex + 1];
  if (
    configIndex < 0 ||
    !configPath ||
    !path.isAbsolute(configPath) ||
    !instance ||
    !/^[a-zA-Z0-9_-]+$/u.test(instance)
  )
    throw new Error(
      "Usage: pages-service-monitor.mjs --config /absolute/config.toml [--instance default] [--user] [--units unit.service,...]",
    );
  const units =
    unitsIndex < 0
      ? ["api", "runs", "integrations", "postgres"].map(
          (role) => `pages-${role}@${instance}.service`,
        )
      : (argumentList[unitsIndex + 1] ?? "").split(",");
  await new ServiceMonitorService(new ConfigFile(configPath)).observe(
    units,
    argumentList.includes("--user"),
  );
}
