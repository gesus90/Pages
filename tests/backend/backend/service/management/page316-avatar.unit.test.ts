import { expect, it, vi } from "vitest";
import { loadImage } from "@napi-rs/canvas";

import { MemoryUserRepository } from "../accounts/memory-user-repository";
import { managementFixture } from "./page316-service-fixture";

it("renders hostile SVG as a PNG and changes the complete user revision", async () => {
  const { service } = managementFixture();
  const read = await service.call("management", "users_read", {
    userId: "emp-sales",
  });
  if (!("revision" in read) || !read.revision)
    throw new Error("Missing revision");
  let stored: Buffer | undefined;
  vi.spyOn(MemoryUserRepository.prototype, "upsertAvatar").mockImplementation(
    async (_id, avatar) => {
      expect(avatar.mimeType).toBe("image/png");
      stored = avatar.data;
    },
  );
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>alert(1)</script><image href="file:///etc/passwd"/><rect width="32" height="32" fill="red"/></svg>';
  const response = await service.call("management", "users_set_avatar", {
    userId: "emp-sales",
    expectedRevision: read.revision,
    contentType: "image/svg+xml",
    dataBase64: Buffer.from(svg).toString("base64"),
  });
  expect(response).toMatchObject({
    id: "emp-sales",
    avatarUrl: expect.stringMatching(/^\/users\/emp-sales\/avatar\?v=/u),
  });
  if (!stored) throw new Error("Expected stored PNG");
  expect(stored.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const decoded = await loadImage(stored);
  expect([decoded.width, decoded.height]).toEqual([512, 512]);
  const updated = await service.call("management", "users_read", {
    userId: "emp-sales",
  });
  expect(updated).not.toMatchObject({ revision: read.revision });
});

it("rejects a disguised SVG, malformed Base64 and more than 5 MiB before persistence", async () => {
  const { service } = managementFixture();
  const current = await service.call("management", "users_read", {
    userId: "emp-sales",
  });
  if (!("revision" in current)) throw new Error("Missing revision");
  const request = {
    userId: "emp-sales",
    expectedRevision: current.revision,
    contentType: "image/png",
  };
  await expect(
    service.call("management", "users_set_avatar", {
      ...request,
      dataBase64: Buffer.from(
        '<svg><image href="https://example.test"/></svg>',
      ).toString("base64"),
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "avatar" },
  });
  await expect(
    service.call("management", "users_set_avatar", {
      ...request,
      dataBase64: "invalid!",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    service.call("management", "users_set_avatar", {
      ...request,
      dataBase64: "a".repeat(7 * 1024 * 1024),
    }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
});

it("uses the same server-side SVG conversion for a browser avatar upload", async () => {
  const { parseAvatarUpload } =
    await import("@/app/lib/settings-actions/avatar-upload.server");
  const image = new File(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
    ],
    "agent.svg",
    { type: "image/svg+xml" },
  );
  const upload = await parseAvatarUpload(image);
  expect(upload.status).toBe("ready");
  if (upload.status !== "ready") throw new Error("Expected converted avatar");
  expect(upload.avatar.mimeType).toBe("image/png");
  expect(upload.avatar.data.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});
