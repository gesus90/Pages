import { expect, it, vi } from "vitest";

import { browserRequestCookies } from "@/backend/service/chat/browser/PicaBrowserProxy";
import {
  requireWriteApproval,
  resolveBrowserTarget,
} from "@/backend/service/chat/browser/PicaBrowserTargets";

import type { PicaBrowserTarget } from "@/backend/service/chat/browser/PicaBrowserTargets";

vi.mock("node:dns/promises", () => ({
  lookup: async (_host: string, options: { all?: boolean }) =>
    options.all
      ? [{ address: "93.184.216.34", family: 4 }]
      : { address: "127.0.0.1", family: 4 },
}));

const origins = {
  pages: ["http://127.0.0.1:3000"],
  services: ["http://127.0.0.1:4000"],
};

it("allows this Pages instance, public HTTPS and exactly the operator-released local origins", async () => {
  expect(
    await resolveBrowserTarget("http://127.0.0.1:3000/settings", origins),
  ).toMatchObject({ kind: "pages" });
  expect(
    await resolveBrowserTarget("https://example.org", origins),
  ).toMatchObject({ kind: "public", address: "93.184.216.34" });
  expect(
    await resolveBrowserTarget("http://127.0.0.1:4000", origins),
  ).toMatchObject({ kind: "service" });
  for (const address of [
    "http://127.0.0.1:4001",
    "http://example.org",
    "file:///etc/passwd",
    "https://user:password@example.org",
    "http://127.0.0.1:3000/chat-api",
  ])
    await expect(resolveBrowserTarget(address, origins)).rejects.toThrow(
      "URL_DENIED",
    );
});

it("keeps the Pages session cookie on Pages even when a local test service uses the same host", () => {
  const cookies = [
    { name: "pages_session", value: "pabs_PLACEHOLDER" },
    { name: "test_cookie", value: "ordinary" },
  ];
  expect(browserRequestCookies(cookies, "pages")).toContain(
    "pages_session=pabs_PLACEHOLDER",
  );
  for (const kind of ["public", "service"] as const) {
    expect(browserRequestCookies(cookies, kind)).toBe("test_cookie=ordinary");
  }
});

it("uses account authorization for Pages writes while local service writes still require administrator approval", () => {
  const target: PicaBrowserTarget = {
    url: new URL("http://127.0.0.1:3000"),
    kind: "pages",
    address: "127.0.0.1",
  };
  expect(() => requireWriteApproval(target, "POST", false, true)).not.toThrow();
  expect(() => requireWriteApproval(target, "POST", false)).toThrow(
    "LOCAL_WRITE_NOT_APPROVED",
  );
  expect(() =>
    requireWriteApproval({ ...target, kind: "service" }, "POST", false, true),
  ).toThrow("LOCAL_WRITE_NOT_APPROVED");
  expect(() =>
    requireWriteApproval({ ...target, kind: "service" }, "POST", true, true),
  ).not.toThrow();
  expect(() =>
    requireWriteApproval({ ...target, kind: "public" }, "POST", false, true),
  ).not.toThrow();
  expect(() =>
    requireWriteApproval({ ...target, kind: "service" }, "GET", false, true),
  ).not.toThrow();
});
