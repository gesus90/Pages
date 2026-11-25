import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SendmailInvitationDelivery } from "./SendmailInvitationDelivery";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

interface FakeProcess extends EventEmitter {
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
}

function fakeProcess(): FakeProcess {
  const child = new EventEmitter() as FakeProcess;
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  spawnMock.mockReturnValue(child);
  return child;
}

const invitation = {
  email: "a@example.org",
  username: "ann",
  temporaryPassword: "pw",
};

beforeEach(() => {
  spawnMock.mockReset();
});

describe("SendmailInvitationDelivery", () => {
  it("rejects recipients with line breaks without spawning", async () => {
    await expect(
      new SendmailInvitationDelivery().send({ ...invitation, email: "a\nb@x" }),
    ).rejects.toThrow("Invalid mail recipient");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("writes the message and resolves on exit code 0", async () => {
    const child = fakeProcess();
    const sending = new SendmailInvitationDelivery().send(invitation);
    child.emit("close", 0);
    await expect(sending).resolves.toBeUndefined();
    expect(spawnMock.mock.calls[0]?.[0]).toBe("sendmail");
    expect(child.stdin.end.mock.calls[0]?.[0]).toContain("To: a@example.org");
  });

  it("rejects on a failing exit code", async () => {
    const child = fakeProcess();
    const sending = new SendmailInvitationDelivery().send(invitation);
    child.emit("close", 1);
    await expect(sending).rejects.toThrow("Invitation delivery failed");
  });

  it("rejects when the program or its input fails", async () => {
    const first = fakeProcess();
    const spawnFailure = new SendmailInvitationDelivery().send(invitation);
    first.emit("error", new Error("x"));
    await expect(spawnFailure).rejects.toThrow(
      "Invitation delivery unavailable",
    );
    const second = fakeProcess();
    const inputFailure = new SendmailInvitationDelivery().send(invitation);
    second.stdin.emit("error", new Error("x"));
    await expect(inputFailure).rejects.toThrow(
      "Invitation delivery unavailable",
    );
  });
});
