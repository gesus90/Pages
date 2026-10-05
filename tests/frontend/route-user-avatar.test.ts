import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { loader } from "@/app/routes/user-avatar";

const mockedServices = vi.mocked(getApplicationServices);

function mockAvatar(avatar: unknown): ReturnType<typeof vi.fn> {
  const getAvatar = vi.fn().mockResolvedValue(avatar);

  mockedServices.mockResolvedValue({
    userService: { getAvatar },
  } as unknown as Awaited<ReturnType<typeof mockedServices>>);

  return getAvatar;
}

function callLoader(
  userId: string | undefined,
  method = "GET",
): Promise<Response> {
  return loader({
    params: { userId },
    request: new Request("http://pages.invalid/users/user-1/avatar", {
      method,
    }),
  } as unknown as Parameters<typeof loader>[0]);
}

describe("user avatar route", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("serves the stored image with its type and safe caching headers", async () => {
    const getAvatar = mockAvatar({
      data: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    });

    const response = await callLoader("user-1");

    expect(getAvatar).toHaveBeenCalledWith("user-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("answers 404 when the user has no stored image", async () => {
    mockAvatar(null);

    const failure = await callLoader("user-1").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(404);
  });

  it("answers 404 without a user identifier", async () => {
    const getAvatar = mockAvatar(null);

    const failure = await callLoader(undefined).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(404);
    expect(getAvatar).not.toHaveBeenCalled();
  });

  it("rejects methods other than GET", async () => {
    const getAvatar = mockAvatar(null);

    const failure = await callLoader("user-1", "POST").catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("GET");
    expect(getAvatar).not.toHaveBeenCalled();
  });
});
