import { expect, it } from "vitest";

import { formatPlanAssetSize } from "@/app/components/agents/plans/plan-node-card/plan-asset-format";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

it("writes sizes in binary units so the limit of a plan reads 512 MiB", () => {
  expect(formatPlanAssetSize(PLAN_HANDOVER_LIMITS.bytes, "en")).toBe("512 MiB");
  expect(formatPlanAssetSize(PLAN_HANDOVER_LIMITS.bytes, "de")).toBe("512 MiB");
  expect(formatPlanAssetSize(10 * 1024 * 1024, "en")).toBe("10 MiB");
  expect(formatPlanAssetSize(1536 * 1024, "de")).toBe("1,5 MiB");
  expect(formatPlanAssetSize(1023, "en")).toBe("1,023 B");
  expect(formatPlanAssetSize(1024, "en")).toBe("1 KiB");
});
