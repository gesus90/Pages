import { expect, it, vi } from "vitest";

import { action } from "@/app/routes/chat-attachments";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const upload = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ chatAttachmentService: { upload } }),
}));

function put(user: User | null, query: string): Promise<Response> {
  return action(
    routeArguments(
      new Request(`http://pages.invalid/chat-api/attachments${query}`, {
        method: "PUT",
        body: "file",
      }),
      user,
      {},
    ),
  );
}

it("refuses visitors without a session with a stable code", async () => {
  const response = await put(null, "?session=s&name=a.txt");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ ok: false, error: "accessDenied" });
  expect(upload).not.toHaveBeenCalled();
});

it("uploads the body for the named session and file", async () => {
  upload.mockResolvedValue({ id: "attachment" });
  const response = await put(EMPLOYEE, "?session=s&name=a.txt");
  expect(await response.json()).toEqual({
    ok: true,
    attachment: { id: "attachment" },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(upload).toHaveBeenCalledWith(
    EMPLOYEE,
    "s",
    expect.objectContaining({ fileName: "a.txt" }),
  );
});

it("passes a missing session and name on to the service", async () => {
  upload.mockResolvedValue({ id: "attachment" });
  await put(EMPLOYEE, "");
  expect(upload).toHaveBeenLastCalledWith(
    EMPLOYEE,
    null,
    expect.objectContaining({ fileName: "" }),
  );
});
