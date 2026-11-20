import { expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("@lydell/node-pty", () => ({ spawn: boundary.spawn }));

import { openSshPty } from "./SshPty";

import type { SshPty } from "./SshPty";

class FakeTerminal {
  public readonly write = vi.fn();
  public readonly resize = vi.fn();
  public readonly kill = vi.fn();
  public onData = vi.fn((listener: (chunk: string) => void) => {
    this.receive = listener;
  });
  public onExit = vi.fn((listener: (event: { exitCode: number }) => void) => {
    this.exit = listener;
  });
  public receive: (chunk: string) => void = () => {};
  public exit: (event: { exitCode: number }) => void = () => {};
}

async function startTerminal(
  path: string | null = null,
  command?: string,
): Promise<{
  terminal: FakeTerminal;
  session: SshPty;
  onOutput: ReturnType<typeof vi.fn>;
}> {
  const terminal = new FakeTerminal();
  boundary.spawn.mockReturnValue(terminal);
  const onOutput = vi.fn();
  const session = await openSshPty({
    file: "ssh",
    arguments: ["host"],
    environment: { PATH: "/bin" },
    directory: "/private",
    request: { path, command, columns: 80, rows: 24, onOutput },
  });
  return { terminal, session, onOutput };
}

it("forwards output, input, geometry and exit", async () => {
  const { terminal, session, onOutput } = await startTerminal();
  terminal.receive("ready");
  await expect(session.firstOutput).resolves.toBe(true);
  expect(onOutput).toHaveBeenCalledWith("ready");
  session.write("hello\r");
  session.resize(100, 30);
  expect(terminal.write).toHaveBeenCalledWith("hello\r");
  expect(terminal.resize).toHaveBeenCalledWith(100, 30);
  terminal.exit({ exitCode: 7 });
  await expect(session.exited).resolves.toBe(7);
  session.close();
  expect(terminal.kill).not.toHaveBeenCalled();
  expect(boundary.spawn).toHaveBeenCalledWith(
    "ssh",
    expect.arrayContaining(["-tt", "ProxyCommand=/bin/false", "host"]),
    expect.objectContaining({ cols: 80, rows: 24, cwd: "/private" }),
  );
});

it("detects a refusal split across chunks and closes only once", async () => {
  const { terminal, session } = await startTerminal("/some path");
  terminal.receive("PTY allocation ");
  terminal.receive("request failed");
  expect(session.wasRefused()).toBe(true);
  expect(terminal.kill).toHaveBeenCalledOnce();
  session.close();
  expect(terminal.kill).toHaveBeenCalledOnce();
  expect(boundary.spawn.mock.calls.at(-1)?.[1].at(-1)).toContain("cd -P");
});

it("ignores refusal text after input or after the initial window", async () => {
  const first = await startTerminal(null, "printf hello");
  first.session.write("input");
  first.terminal.receive("PTY allocation request failed");
  expect(first.session.wasRefused()).toBe(false);
  expect(boundary.spawn.mock.calls.at(-1)?.[1].at(-1)).toContain(
    "printf hello",
  );
  const second = await startTerminal();
  second.terminal.receive("x".repeat(512));
  second.terminal.receive("PTY allocation request failed");
  expect(second.session.wasRefused()).toBe(false);
  second.session.close();
  expect(second.terminal.kill).toHaveBeenCalledOnce();
});

it("reports no first output when the shell exits immediately or refuses", async () => {
  const exited = await startTerminal();
  exited.terminal.exit({ exitCode: 1 });
  await expect(exited.session.firstOutput).resolves.toBe(false);
  const refused = await startTerminal();
  refused.terminal.receive("PTY allocation request failed");
  await expect(refused.session.firstOutput).resolves.toBe(false);
});
