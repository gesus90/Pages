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

import { afterEach, beforeEach, expect, it } from "vitest";

import { sshConfigOverlay } from "../../../../../scripts/runner/execution.mjs";

let scratch = "";
let system = "";
let copies = "";

async function dropIn(
  name: string,
  content: string,
  mode = 0o644,
): Promise<void> {
  const file = path.join(system, name);
  await writeFile(file, content);
  await chmod(file, mode);
}

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "pages-runner-ssh-test-"));
  system = path.join(scratch, "system");
  copies = path.join(scratch, "job", "ssh_config.d");
  await mkdir(system);
  await mkdir(path.dirname(copies));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

it("mounts account-owned copies of the system drop-ins over their folder", async () => {
  await dropIn("20-proxy.conf", "Host x\n");
  await dropIn("readme", "ignored");
  await dropIn(".hidden.conf", "ignored");
  await writeFile(path.join(scratch, "target"), "Host z\n");
  await chmod(path.join(scratch, "target"), 0o644);
  await symlink(
    path.join(scratch, "target"),
    path.join(system, "30-link.conf"),
  );
  await symlink(path.join(scratch, "gone"), path.join(system, "40-dead.conf"));

  const args = await sshConfigOverlay(copies, system);

  expect(args).toEqual(["--ro-bind", copies, "/etc/ssh/ssh_config.d"]);
  expect((await readdir(copies)).sort()).toEqual([
    "20-proxy.conf",
    "30-link.conf",
  ]);
  expect(await readFile(path.join(copies, "30-link.conf"), "utf8")).toBe(
    "Host z\n",
  );
  const metadata = await stat(path.join(copies, "20-proxy.conf"));
  expect(metadata.uid).toBe(process.getuid?.());
  expect(metadata.mode & 0o022).toBe(0);
});

it("mounts nothing when any drop-in would be rejected by ssh, and leaves no copies", async () => {
  await dropIn("10-good.conf", "Host a\n");
  await dropIn("20-open.conf", "Host b\n", 0o666);

  expect(await sshConfigOverlay(copies, system)).toEqual([]);
  await expect(stat(copies)).rejects.toThrow();
});

it("rejects a link whose target is writable by others", async () => {
  await dropIn("10-good.conf", "Host a\n");
  const target = path.join(scratch, "open-target");
  await writeFile(target, "Host b\n");
  await chmod(target, 0o666);
  await symlink(target, path.join(system, "20-link.conf"));

  expect(await sshConfigOverlay(copies, system)).toEqual([]);
});

it("mounts nothing for a folder named like a drop-in, and removes a half-written copy", async () => {
  await mkdir(path.join(system, "10-folder.conf"));
  expect(await sshConfigOverlay(copies, system)).toEqual([]);
  await rm(path.join(system, "10-folder.conf"), { recursive: true });
  await dropIn("20-ok.conf", "Host ok\n");
  // The job folder is new for every job; an existing one is not shared.
  await mkdir(copies);
  expect(await sshConfigOverlay(copies, system)).toEqual([]);
  expect(await readdir(copies)).toEqual([]);
});

it("adds no mount when there is nothing to copy", async () => {
  expect(await sshConfigOverlay(copies, system)).toEqual([]);
  expect(await sshConfigOverlay(copies, path.join(scratch, "none"))).toEqual(
    [],
  );
});
