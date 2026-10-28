import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/instance-logo";

import { thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const getLogo = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    instanceSettingsService: { getLogo },
  }),
}));

function load(method = "GET"): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/instance-logo", { method }),
      null,
      {},
    ),
  );
}

it("allows only GET", async () => {
  const response = await thrownResponse(load("DELETE"));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
  expect(getLogo).not.toHaveBeenCalled();
});

it("answers 404 when no logo is stored", async () => {
  getLogo.mockResolvedValue(null);
  expect((await thrownResponse(load())).status).toBe(404);
});

it("returns the logo to visitors without a session under a script-free policy", async () => {
  getLogo.mockResolvedValue({
    data: Buffer.from("<svg/>"),
    mimeType: "image/svg+xml",
  });
  const response = await load();
  expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  expect(await response.text()).toBe("<svg/>");
});
