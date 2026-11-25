import { createCanvas } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  managementAvatar,
  renderManagementAvatar,
  sanitizeManagementSvg,
} from "./ManagementAvatar";

import type * as CanvasModule from "@napi-rs/canvas";
import type { ManagementContext } from "./ManagementContext";

const state = vi.hoisted(() => ({
  changeable: vi.fn(),
  override: null as null | (() => Promise<unknown>),
}));

vi.mock("./ManagementUserWrite", () => ({
  ManagementUserWrite: class {
    public changeable = state.changeable;
  },
}));
vi.mock("@napi-rs/canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof CanvasModule>();
  return {
    ...actual,
    loadImage: async (source: Parameters<typeof actual.loadImage>[0]) =>
      state.override ? state.override() : actual.loadImage(source),
  };
});

async function imageOf(
  format: "png" | "jpeg" | "webp",
  width = 4,
  height = 4,
): Promise<string> {
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  if (format === "png") return (await canvas.encode("png")).toString("base64");
  if (format === "jpeg")
    return (await canvas.encode("jpeg")).toString("base64");
  return (await canvas.encode("webp")).toString("base64");
}

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>';

function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) =>
      (error as { code: string; details?: { reason: string } }).details
        ?.reason ?? (error as { code: string }).code,
  );
}

beforeEach(() => {
  state.override = null;
  state.changeable.mockReset();
});

describe("sanitizeManagementSvg", () => {
  it("rejects doctype and entity declarations", () => {
    expect(() => sanitizeManagementSvg("<!DOCTYPE svg><svg/>")).toThrow();
    expect(() => sanitizeManagementSvg("<!ENTITY x 'y'>")).toThrow();
  });

  it("removes executable elements and unknown tags", () => {
    const result = sanitizeManagementSvg(
      "<svg><script>alert(1)</script ><text>t</text><div>x</div><!-- c --><1></svg>",
    );
    expect(result).toBe("<svg >x</svg>");
  });

  it("keeps safe attributes and drops unsafe ones", () => {
    const result = sanitizeManagementSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="x" width="1" height="a&b" fill="url(#a)" stroke='a"b' x="//e" y="data:x" cx="ok"/>`,
    );
    expect(result).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" stroke="a&quot;b" cx="ok"/>',
    );
    expect(sanitizeManagementSvg('<svg xmlns="http://evil"></svg>')).toBe(
      "<svg ></svg>",
    );
  });
});

describe("renderManagementAvatar", () => {
  it("converts png, jpeg, webp and svg to a png", async () => {
    for (const [type, encoded] of [
      ["image/png", await imageOf("png")],
      ["image/jpeg", await imageOf("jpeg")],
      ["image/webp", await imageOf("webp")],
      ["image/svg+xml", Buffer.from(svg).toString("base64")],
    ] as const) {
      const stored = await renderManagementAvatar(type, encoded);
      expect(stored).toMatchObject({
        mimeType: "image/png",
        filename: "avatar.png",
      });
      expect(stored.data.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
  });

  it("refuses oversized payloads", async () => {
    expect(
      await reasonOf(
        renderManagementAvatar("image/png", "A".repeat(7_000_000)),
      ),
    ).toBe("PAYLOAD_TOO_LARGE");
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    expect(await reasonOf(renderManagementAvatar("image/png", oversized))).toBe(
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("refuses malformed base64 and mismatching signatures", async () => {
    expect(await reasonOf(renderManagementAvatar("image/png", "***"))).toBe(
      "avatar",
    );
    expect(await reasonOf(renderManagementAvatar("image/png", "AAA"))).toBe(
      "avatar",
    );
    expect(
      await reasonOf(
        renderManagementAvatar("image/png", await imageOf("jpeg")),
      ),
    ).toBe("avatar");
    expect(
      await reasonOf(
        renderManagementAvatar("image/jpeg", await imageOf("png")),
      ),
    ).toBe("avatar");
    expect(
      await reasonOf(
        renderManagementAvatar("image/webp", await imageOf("png")),
      ),
    ).toBe("avatar");
    expect(
      await reasonOf(renderManagementAvatar("image/gif", await imageOf("png"))),
    ).toBe("avatar");
  });

  it("refuses undecodable and out-of-range images", async () => {
    const garbage = Buffer.from("not an image").toString("base64");
    expect(
      await reasonOf(renderManagementAvatar("image/svg+xml", garbage)),
    ).toBe("avatar");
    expect(
      await reasonOf(
        renderManagementAvatar("image/png", await imageOf("png", 4097, 1)),
      ),
    ).toBe("avatar");
    expect(
      await reasonOf(
        renderManagementAvatar("image/png", await imageOf("png", 1, 4097)),
      ),
    ).toBe("avatar");
    state.override = async () => ({ width: 0, height: 5 });
    expect(
      await reasonOf(renderManagementAvatar("image/png", await imageOf("png"))),
    ).toBe("avatar");
    state.override = async () => ({ width: 5, height: 0 });
    expect(
      await reasonOf(renderManagementAvatar("image/png", await imageOf("png"))),
    ).toBe("avatar");
  });
});

describe("managementAvatar", () => {
  it("stores the rendered avatar and references it", async () => {
    state.changeable.mockResolvedValue({ revision: "r1" });
    const upsertAvatar = vi.fn(async () => undefined);
    const updateAvatarReference = vi.fn(async () => undefined);
    const context = {
      authorization: { users: () => ({ upsertAvatar, updateAvatarReference }) },
    } as unknown as ManagementContext;
    const result = await managementAvatar(context, "u1", {
      expectedRevision: "r1",
      contentType: "image/png",
      dataBase64: await imageOf("png"),
    });
    const urlPattern: unknown = expect.stringMatching(
      /^\/users\/u1\/avatar\?v=[0-9a-f]{64}$/u,
    );
    const urlPart: unknown = expect.stringContaining("/users/u1/avatar?v=");
    expect(result).toMatchObject({
      id: "u1",
      avatarUrl: urlPattern,
    });
    expect(upsertAvatar).toHaveBeenCalledOnce();
    expect(updateAvatarReference).toHaveBeenCalledWith("u1", {
      avatarType: "image",
      avatarImageUrl: urlPart,
    });
  });

  it("refuses a stale revision", async () => {
    state.changeable.mockResolvedValue({ revision: "r2" });
    await expect(
      managementAvatar({} as unknown as ManagementContext, "u1", {
        expectedRevision: "r1",
        contentType: "image/png",
        dataBase64: "",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
