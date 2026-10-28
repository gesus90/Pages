import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/user-avatar";

import { thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const getAvatar = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ userService: { getAvatar } }),
}));

function load(userId: string, method = "GET"): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/users/u1/avatar", { method }),
      null,
      { userId },
    ),
  );
}

it("allows only GET", async () => {
  const response = await thrownResponse(load("u1", "POST"));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
});

it("answers 404 without a user id or a stored avatar", async () => {
  expect((await thrownResponse(load(""))).status).toBe(404);
  expect(getAvatar).not.toHaveBeenCalled();
  getAvatar.mockResolvedValue(null);
  expect((await thrownResponse(load("u1"))).status).toBe(404);
  expect(getAvatar).toHaveBeenCalledWith("u1");
});

it("returns the avatar with a private cache", async () => {
  getAvatar.mockResolvedValue({
    data: Buffer.from([7]),
    mimeType: "image/jpeg",
  });
  const response = await load("u1");
  expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7]);
});
