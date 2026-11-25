import { describe, expect, it, vi } from "vitest";

import { checkRemoteDirectory } from "./RemoteDirectoryCheck";

import type { Mock } from "vitest";
import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { SshProcessResult } from "@/backend/remote/SshProcess";
import type { RemoteDirectoryFinding } from "./RemoteDirectoryCheck";

interface CheckRun {
  readonly finding: RemoteDirectoryFinding;
  readonly run: Mock<
    (command: string, timeoutMs: number) => Promise<SshProcessResult>
  >;
}

async function check(
  stdout: string,
  roots: readonly string[] = ["/srv"],
): Promise<CheckRun> {
  const run = vi.fn(async (): Promise<SshProcessResult> => ({
    exitCode: 0,
    stdout,
    stderr: "",
    isTimedOut: false,
    isUnavailable: false,
  }));
  const session: Pick<RemoteSession, "run"> = { run };
  const finding = await checkRemoteDirectory(session, {
    path: "/srv/../srv/app",
    roots,
  });
  return { finding, run };
}

describe("checkRemoteDirectory", () => {
  it("builds a script that quotes path and roots", async () => {
    const { run } = await check("pages-check=missing\n", ["/srv", "/o'x"]);
    const [script, timeout] = run.mock.calls[0];
    expect(timeout).toBe(60_000);
    expect(script).toContain("n='/srv/app'");
    expect(script).toContain("/o");
  });

  it.each([
    ["missing", "path_missing"],
    ["not_directory", "path_not_directory"],
    ["denied", "path_denied"],
    ["outside", "path_outside_roots"],
  ])("maps %s", async (word, issue) => {
    const { finding } = await check(`pages-check=${word}\n`);
    expect(finding).toEqual({ path: null, issue });
  });

  it("treats output without a verdict as denied", async () => {
    expect((await check("garbage")).finding).toEqual({
      path: null,
      issue: "path_denied",
    });
  });

  it("rejects missing or unsafe canonical paths", async () => {
    for (const out of [
      "pages-check=ok\n",
      "pages-check=ok\npages-path=relative\n",
      "pages-check=ok\npages-path=/a\u0001b\n",
    ])
      expect((await check(out)).finding).toEqual({
        path: null,
        issue: "path_denied",
      });
  });

  it("returns the canonical path when all rights exist", async () => {
    const out =
      "pages-read=1\npages-write=1\npages-traverse=1\npages-check=ok\npages-path=/srv/app\n";
    expect((await check(out)).finding).toEqual({
      path: "/srv/app",
      issue: null,
    });
  });

  it("reports the first missing right", async () => {
    const base = "pages-check=ok\npages-path=/srv/app\n";
    expect((await check(base)).finding.issue).toBe("path_not_readable");
    expect((await check(`pages-read=1\n${base}`)).finding.issue).toBe(
      "path_not_writable",
    );
    expect(
      (await check(`pages-read=1\npages-write=1\n${base}`)).finding.issue,
    ).toBe("path_not_traversable");
  });
});
