import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { loader } from "@/app/routes/instance-logo";

function useLogo(logo: unknown): void {
  vi.mocked(getApplicationServices).mockResolvedValue({
    instanceSettingsService: { getLogo: vi.fn().mockResolvedValue(logo) },
  } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
}

function call(method = "GET"): Promise<Response> {
  return loader({
    request: new Request("http://pages.invalid/instance-logo", { method }),
  } as unknown as Parameters<typeof loader>[0]);
}

describe("instance logo route", () => {
  beforeEach(() => {
    vi.mocked(getApplicationServices).mockReset();
  });

  it("serves the logo with headers that keep an SVG harmless", async () => {
    useLogo({
      data: Buffer.from("<svg/>"),
      mimeType: "image/svg+xml",
      updatedAt: "2026-10-07 10:00:00",
    });

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(response.headers.get("Cache-Control")).toContain("max-age");
    expect(await response.text()).toBe("<svg/>");
  });

  it("answers 404 without a logo", async () => {
    useLogo(null);

    const failure = await call().catch((error: unknown) => error);

    expect((failure as Response).status).toBe(404);
  });

  it("allows GET only", async () => {
    useLogo(null);

    const failure = await call("POST").catch((error: unknown) => error);

    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("GET");
  });
});
