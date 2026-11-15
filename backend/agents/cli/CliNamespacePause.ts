import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { hasEndedOwnedNamespace } from "./CliOwnedNamespace";

import type { AcpNamespaceOwner } from "@/definition/AcpResource";

const execute = promisify(execFile);

// Pin each task before signalling. Stopping parents before discovering children
// prevents forks escaping the traversal; a PID namespace prevents reparenting out.
const NAMESPACE_SIGNAL = `
import os, signal, sys, time
root, start, uid, boot, action = sys.argv[1:]
root, start, uid = int(root), int(start), int(uid)
if open('/proc/sys/kernel/random/boot_id').read().strip() != boot:
    sys.exit(0)
def identity(pid):
    try:
        stat = open('/proc/%d/stat' % pid).read().rsplit(')', 1)[1].split()
        return int(stat[19]), os.stat('/proc/%d' % pid).st_uid, stat[0]
    except FileNotFoundError:
        return None
def pin(pid, expected=None):
    try:
        before = identity(pid)
        if before is None or before[1] != uid or (expected is not None and before[0] != expected):
            return None
        fd = os.pidfd_open(pid)
        after = identity(pid)
        if after is None or before[:2] != after[:2]:
            os.close(fd)
            return None
        return fd
    except ProcessLookupError:
        return None
def send(fd, sig):
    try:
        signal.pidfd_send_signal(fd, sig)
    except ProcessLookupError:
        pass
def visit(pid, expected=None):
    fd = pin(pid, expected)
    if fd is None:
        return
    try:
        if action == 'pause':
            send(fd, signal.SIGSTOP)
            until = time.monotonic() + 1
            while True:
                current = identity(pid)
                if current is None or current[2] in ('T', 't', 'Z'):
                    break
                if time.monotonic() >= until:
                    raise RuntimeError('Namespace did not pause')
                time.sleep(.001)
        children = set()
        try:
            for task in os.listdir('/proc/%d/task' % pid):
                try:
                    children.update(map(int, open('/proc/%d/task/%s/children' % (pid, task)).read().split()))
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            pass
        for child in children:
            visit(child)
        if action == 'resume':
            send(fd, signal.SIGCONT)
    finally:
        os.close(fd)
visit(root, start)
`;

/** Suspends an owned process frame without cancelling its protocol or releasing its resources. */
export async function setNamespacePaused(
  owner: AcpNamespaceOwner,
  isPaused: boolean,
): Promise<void> {
  if (await hasEndedOwnedNamespace(owner)) return;
  if (owner.unit) {
    if (!/^pages-acp-[a-f0-9-]+-[a-f0-9]{8}\.service$/u.test(owner.unit))
      throw new Error("Invalid worker unit identity");
    const runtime = `/run/user/${owner.uid}`;
    await execute(
      "/usr/bin/systemctl",
      ["--user", isPaused ? "freeze" : "thaw", owner.unit],
      {
        timeout: 2_000,
        env: {
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: runtime,
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
        },
      },
    );
    return;
  }
  await execute(
    "python3",
    [
      "-c",
      NAMESPACE_SIGNAL,
      String(owner.pid),
      String(owner.start),
      String(owner.uid),
      owner.boot,
      isPaused ? "pause" : "resume",
    ],
    { timeout: 2_000 },
  );
}
