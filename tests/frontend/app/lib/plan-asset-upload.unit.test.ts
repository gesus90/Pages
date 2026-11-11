import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkPlanAsset,
  PlanAssetUploadError,
  planAssetUrl,
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

const STORED = {
  assetId: "stored",
  fileName: "plan.bin",
  mediaType: "application/octet-stream",
  kind: "other",
  size: 12,
  digest: "d".repeat(64),
};

describe("planAssetUrl", () => {
  it("encodes the asset id into the address that serves its bytes", () => {
    expect(planAssetUrl("a/b c")).toBe("/agent-plan-assets/a%2Fb%20c");
  });
});

describe("uploadPlanAsset transfer", () => {
  it("puts the file to the project with encoded project and name", () => {
    stubRequests();
    const file = new File(["x"], "my plan & more.bin");

    void uploadPlanAsset("p/1", file, vi.fn());

    const request = requests[0];
    expect(request?.open).toHaveBeenCalledWith(
      "PUT",
      "/agent-api/plan-assets?projectId=p%2F1&name=my%20plan%20%26%20more.bin",
    );
    expect(request?.send).toHaveBeenCalledWith(file);
  });

  it("reports the share that was sent and 0 while the size is unknown", () => {
    stubRequests();
    const onProgress = vi.fn();
    void uploadPlanAsset("project", new File(["x"], "a.bin"), onProgress);
    const report = requests[0]?.upload.onprogress as (event: unknown) => void;

    report({ lengthComputable: true, loaded: 25, total: 100 });
    report({ lengthComputable: false, loaded: 25, total: 0 });

    expect(onProgress.mock.calls).toEqual([[0.25], [0]]);
  });

  it("fails with the network code when the connection breaks", async () => {
    stubRequests();
    const upload = uploadPlanAsset(
      "project",
      new File(["x"], "a.bin"),
      vi.fn(),
    );

    requests[0]?.onerror?.();

    await expect(upload).rejects.toMatchObject({ code: "network" });
  });

  it("returns only the stored part of the record", async () => {
    stubRequests();
    const upload = uploadPlanAsset(
      "project",
      new File(["x"], "a.bin"),
      vi.fn(),
    );
    const request = requests[0];
    request.responseText = JSON.stringify({
      asset: { ...STORED, ownerId: "secret" },
    });

    request.onload?.();

    await expect(upload).resolves.toEqual(STORED);
  });

  it("passes on the reason the server named", async () => {
    stubRequests();
    const upload = uploadPlanAsset(
      "project",
      new File(["x"], "a.bin"),
      vi.fn(),
    );
    const request = requests[0];
    request.status = 413;
    request.responseText = JSON.stringify({ error: "plan_asset_too_large" });

    request.onload?.();

    await expect(upload).rejects.toMatchObject({
      code: "plan_asset_too_large",
      message: "Plan asset upload failed: plan_asset_too_large",
      name: "PlanAssetUploadError",
    });
  });

  it.each([
    ["an error status without a reason", 500, "{}"],
    ["a success status without an asset", 200, JSON.stringify({ asset: null })],
    ["an answer that is no JSON", 200, "<html>"],
    ["an answer that is no object", 200, "7"],
    ["a non-text reason", 500, JSON.stringify({ error: 5 })],
  ])("falls back to the network code for %s", async (label, status, text) => {
    stubRequests();
    const upload = uploadPlanAsset(
      "project",
      new File(["x"], "a.bin"),
      vi.fn(),
    );
    const request = requests[0];
    request.status = status;
    request.responseText = text;

    request.onload?.();

    await expect(upload).rejects.toMatchObject({ code: "network" });
  });

  it("does not accept an asset behind an error status", async () => {
    stubRequests();
    const upload = uploadPlanAsset(
      "project",
      new File(["x"], "a.bin"),
      vi.fn(),
    );
    const request = requests[0];
    request.status = 400;
    request.responseText = JSON.stringify({ asset: STORED, error: "bad" });

    request.onload?.();

    await expect(upload).rejects.toMatchObject({ code: "bad" });
  });
});

describe("checkPlanAsset", () => {
  const fetchMock = vi.fn();
  const FILE = { assetId: "a/1", digest: STORED.digest };

  function answer(body: unknown, status = 200): void {
    fetchMock.mockResolvedValueOnce(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("asks for the encoded id as JSON, with the caller's signal", async () => {
    answer({ asset: STORED, isReadable: true });
    const signal = new AbortController().signal;

    await checkPlanAsset(FILE, signal);

    expect(fetchMock).toHaveBeenCalledWith("/agent-api/plan-assets?id=a%2F1", {
      signal,
      headers: { Accept: "application/json" },
    });
  });

  it("is readable when the digest matches and the bytes are there", async () => {
    answer({ asset: STORED, isReadable: true });

    await expect(
      checkPlanAsset(FILE, new AbortController().signal),
    ).resolves.toBe("readable");
  });

  it("is unreadable when the bytes are missing", async () => {
    answer({ asset: STORED, isReadable: false });
    answer({ asset: STORED });

    await expect(
      checkPlanAsset(FILE, new AbortController().signal),
    ).resolves.toBe("unreadable");
    await expect(
      checkPlanAsset(FILE, new AbortController().signal),
    ).resolves.toBe("unreadable");
  });

  it("is changed when the content is not the one chosen", async () => {
    answer({ asset: { ...STORED, digest: "e".repeat(64) }, isReadable: true });

    await expect(
      checkPlanAsset(FILE, new AbortController().signal),
    ).resolves.toBe("changed");
  });

  it("is missing for a refused file or an answer without an asset", async () => {
    answer({ error: "gone" }, 404);
    answer({ isReadable: true });
    answer("not json");

    for (let call = 0; call < 3; call += 1)
      await expect(
        checkPlanAsset(FILE, new AbortController().signal),
      ).resolves.toBe("missing");
  });
});
