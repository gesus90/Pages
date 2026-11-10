import { afterEach, expect, it, vi } from "vitest";

import {
  PlanAssetUploadError,
  uploadPlanAsset,
} from "@/app/lib/plan-asset-upload";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import de from "@/language/locales/de/translation.json";
import en from "@/language/locales/en/translation.json";

interface RequestStub {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  upload: { onprogress: unknown };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  status: number;
  responseText: string;
}

const requests: RequestStub[] = [];

function stubRequests(): void {
  vi.stubGlobal(
    "XMLHttpRequest",
    vi.fn(function constructRequest(this: RequestStub) {
      this.open = vi.fn();
      this.send = vi.fn();
      this.upload = { onprogress: null };
      this.onload = null;
      this.onerror = null;
      this.status = 200;
      this.responseText = JSON.stringify({
        asset: {
          assetId: "stored",
          fileName: "plan.bin",
          mediaType: "application/octet-stream",
          kind: "other",
          size: PLAN_HANDOVER_LIMITS.bytes,
          digest: "d".repeat(64),
        },
      });
      requests.push(this);
    }),
  );
}

/** A file whose size is declared without allocating its bytes. */
function fileOfSize(size: number): File {
  const file = new File([], "plan.bin");
  Object.defineProperty(file, "size", { value: size });
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
  requests.length = 0;
});

it("refuses a file above 512 MiB before anything is sent", async () => {
  stubRequests();
  const upload = uploadPlanAsset(
    "project",
    fileOfSize(PLAN_HANDOVER_LIMITS.bytes + 1),
    vi.fn(),
  );
  await expect(upload).rejects.toBeInstanceOf(PlanAssetUploadError);
  await expect(upload).rejects.toMatchObject({ code: "plan_asset_too_large" });
  expect(requests).toHaveLength(0);
});

it("sends a file of exactly 512 MiB and a file above the former 10 MiB", async () => {
  stubRequests();
  for (const size of [PLAN_HANDOVER_LIMITS.bytes, 20 * 1024 * 1024]) {
    const upload = uploadPlanAsset("project", fileOfSize(size), vi.fn());
    const request = requests.at(-1);
    request?.onload?.();
    await expect(upload).resolves.toMatchObject({ assetId: "stored" });
  }
  expect(requests).toHaveLength(2);
});

it("tells people the same limit in both languages", () => {
  // Number and unit are joined by a no-break space so the limit never wraps apart.
  const messages = [
    en.settings.agents.error.plan_asset_too_large,
    de.settings.agents.error.plan_asset_too_large,
  ].map((message) => message.replaceAll("\u00a0", " "));
  expect(messages[0]).toContain("512 MiB (536,870,912 bytes)");
  expect(messages[1]).toContain("512 MiB (536.870.912 Bytes)");
  expect(en.plans.asset.limit).toContain("{{limit}}");
  expect(PLAN_HANDOVER_LIMITS.bytes).toBe(536_870_912);
});
