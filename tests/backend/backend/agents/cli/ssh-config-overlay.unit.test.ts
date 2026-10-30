import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sshConfigOverlayArguments } from "@/backend/agents/cli/CliSshConfigOverlay";

let scratch = "";
let system = "";
let parent = "";

async function dropIn(
  name: string,
  content: string,
  mode = 0o644,
): Promise<string> {
  const file = path.join(system, name);
  await writeFile(file, content);
  await chmod(file, mode);
  return file;
}

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "pages-ssh-overlay-test-"));
  system = path.join(scratch, "system");
  parent = path.join(scratch, "copies");
  await mkdir(system);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

it("mounts account-owned copies of the drop-ins over the system folder", async () => {
  await dropIn("20-proxy.conf", "Host x\n  User y\n");
  // `ssh` includes only `*.conf` without a leading dot, and follows a link as it is.
  await dropIn("notes.txt", "ignored");
  await dropIn(".hidden.conf", "ignored");
  await writeFile(path.join(scratch, "target"), "Host z\n");
  await chmod(path.join(scratch, "target"), 0o644);
  await symlink(
    path.join(scratch, "target"),
    path.join(system, "30-link.conf"),
  );
  // An include `ssh` cannot open is skipped by `ssh` as well.
  await symlink(path.join(scratch, "gone"), path.join(system, "40-dead.conf"));

  const args = await sshConfigOverlayArguments(parent, system);

  expect(args).toHaveLength(3);
  const copies = args[1] ?? "";
  expect(args[0]).toBe("--ro-bind");
  expect(args[2]).toBe("/etc/ssh/ssh_config.d");
  expect((await readdir(copies)).sort()).toEqual([
    "20-proxy.conf",
    "30-link.conf",
  ]);
  expect(await readFile(path.join(copies, "20-proxy.conf"), "utf8")).toBe(
    "Host x\n  User y\n",
  );
  expect(await readFile(path.join(copies, "30-link.conf"), "utf8")).toBe(
    "Host z\n",
  );
  const metadata = await stat(path.join(copies, "20-proxy.conf"));
  // The two conditions `ssh` enforces on an included file.
  expect(metadata.uid).toBe(process.getuid?.());
  expect(metadata.mode & 0o022).toBe(0);
});

it("mounts nothing when a drop-in is writable by others, whatever else is valid", async () => {
  await dropIn("10-good.conf", "Host a\n");
  await dropIn("20-open.conf", "Host b\n", 0o666);
  await dropIn("30-group.conf", "Host c\n", 0o664);

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await expect(stat(parent)).rejects.toThrow();
});

it("rejects a link whose target is writable by others", async () => {
  await dropIn("10-good.conf", "Host a\n");
  const target = path.join(scratch, "open-target");
  await writeFile(target, "Host b\n");
  await chmod(target, 0o666);
  await symlink(target, path.join(system, "20-link.conf"));

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
});

it("mounts nothing for a drop-in owned by someone else", async () => {
  await dropIn("10-foreign.conf", "Host a\n");
  vi.spyOn(process, "getuid").mockReturnValue(4242);

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
});

it("mounts nothing for a folder, an oversized file or a failed copy", async () => {
  await mkdir(path.join(system, "10-folder.conf"));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await rm(path.join(system, "10-folder.conf"), { recursive: true });
  await dropIn("20-large.conf", "#".repeat(1_048_577));
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  await rm(path.join(system, "20-large.conf"));
  await dropIn("30-ok.conf", "Host ok\n");
  await writeFile(path.join(scratch, "occupied"), "a file");
  expect(
    await sshConfigOverlayArguments(path.join(scratch, "occupied"), system),
  ).toEqual([]);
});

it("mounts nothing when the system has no drop-ins or no folder", async () => {
  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
  expect(
    await sshConfigOverlayArguments(parent, path.join(scratch, "absent")),
  ).toEqual([]);
  await expect(stat(parent)).rejects.toThrow();
});

it("publishes an immutable snapshot per content that a later start never rewrites", async () => {
  await dropIn("20-proxy.conf", "Host first\n");
  const first = (await sshConfigOverlayArguments(parent, system))[1] ?? "";
  const again = (await sshConfigOverlayArguments(parent, system))[1];
  expect(again).toBe(first);

  // A changed system file gets its own folder; the one a running job mounted stays as it was.
  await dropIn("20-proxy.conf", "Host second\n");
  const second = (await sshConfigOverlayArguments(parent, system))[1] ?? "";
  expect(second).not.toBe(first);
  expect(await readFile(path.join(first, "20-proxy.conf"), "utf8")).toBe(
    "Host first\n",
  );
  expect(await readFile(path.join(second, "20-proxy.conf"), "utf8")).toBe(
    "Host second\n",
  );
  const files = await readdir(first);
  expect((await stat(path.join(first, files[0] ?? ""))).mode & 0o222).toBe(0);
  expect((await readdir(parent)).sort()).toEqual(
    [path.basename(first), path.basename(second)].sort(),
  );
});

it("agrees on one folder for concurrent starts", async () => {
  await dropIn("20-proxy.conf", "Host x\n");

  const results = await Promise.all(
    Array.from({ length: 6 }, () => sshConfigOverlayArguments(parent, system)),
  );

  expect(new Set(results.map((args) => args[1])).size).toBe(1);
  expect(results[0]).toHaveLength(3);
  expect(await readdir(parent)).toHaveLength(1);
});

it("refuses a published folder that no longer matches its content", async () => {
  await dropIn("20-proxy.conf", "Host x\n");
  const copies = (await sshConfigOverlayArguments(parent, system))[1] ?? "";
  await chmod(path.join(copies, "20-proxy.conf"), 0o644);
  await writeFile(path.join(copies, "20-proxy.conf"), "Host tampered\n");

  expect(await sshConfigOverlayArguments(parent, system)).toEqual([]);
});
