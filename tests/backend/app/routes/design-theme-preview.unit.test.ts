import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/design-theme-preview";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const readPreviewImage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    designThemeService: { readPreviewImage },
  }),
}));

function load(user: User | null, method = "GET"): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/design-themes/arctic/preview", {
        method,
      }),
      user,
      { designThemeId: "arctic" },
    ),
  );
}

it("allows only GET", async () => {
  const response = await thrownResponse(load(EMPLOYEE, "POST"));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
});

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(readPreviewImage).not.toHaveBeenCalled();
});

it("answers 404 when the theme has no preview image", async () => {
  readPreviewImage.mockResolvedValue(null);
  expect((await thrownResponse(load(EMPLOYEE))).status).toBe(404);
  expect(readPreviewImage).toHaveBeenCalledWith("arctic");
});

it("returns the preview image with a private cache and a sandbox policy", async () => {
  readPreviewImage.mockResolvedValue({
    data: Buffer.from([1, 2, 3]),
    contentType: "image/png",
  });
  const response = await load(EMPLOYEE);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; sandbox",
  );
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
});
