import { describe, expect, it, vi } from "vitest";

import { checkRemoteDirectory } from "@/backend/service/remote/RemoteDirectoryCheck";

import type { RemoteSession } from "@/backend/remote/RemoteSession";

const request = { path: "/work/a'b", roots: ["/work"] };

function session(stdout: string): Pick<RemoteSession, "run"> {
  return {
    run: vi.fn().mockResolvedValue({
      stdout,
      stderr: "",
      exitCode: 0,
      isTimedOut: false,
      isUnavailable: false,
    }),
  };
}

describe("remote directory findings", () => {
  it("returns canonical paths and first missing permission", async () => {
    for (const [permissions, issue] of [
      ["pages-read=1\npages-write=1\npages-traverse=1", null],
      ["pages-write=1\npages-traverse=1", "path_not_readable"],
      ["pages-read=1\npages-traverse=1", "path_not_writable"],
      ["pages-read=1\npages-write=1", "path_not_traversable"],
    ] as const) {
      const remote = session(
        `${permissions}\npages-check=ok\npages-path=/work/canonical\n`,
      );
      await expect(checkRemoteDirectory(remote, request)).resolves.toEqual({
        path: "/work/canonical",
        issue,
      });
      expect(remote.run).toHaveBeenCalledOnce();
    }
  });

  it("maps known failure states without disclosing a path", async () => {
    for (const [state, issue] of [
      ["missing", "path_missing"],
      ["not_directory", "path_not_directory"],
      ["denied", "path_denied"],
      ["outside", "path_outside_roots"],
    ]) {
      await expect(
        checkRemoteDirectory(session(`pages-check=${state}\n`), request),
      ).resolves.toEqual({ path: null, issue });
    }
  });

  it("rejects incomplete and unsafe remote output", async () => {
    for (const stdout of [
      "",
      "pages-check=ok",
      "pages-check=ok\npages-path=relative\n",
      "pages-check=ok\npages-path=/work/unsafe\r\n",
    ]) {
      await expect(
        checkRemoteDirectory(session(stdout), request),
      ).resolves.toEqual({ path: null, issue: "path_denied" });
    }
  });
});
