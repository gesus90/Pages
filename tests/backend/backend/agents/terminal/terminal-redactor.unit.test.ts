import { describe, expect, it } from "vitest";

import { TerminalRedactor } from "@/backend/agents/terminal/TerminalRedactor";

const ESC = "\u001b";
const SECRET = "Pq7vXk2LmN9sT4wRb8YcZ1";

/** Feeds chunks one after another and releases the rest at the end, as the recorder does. */
function stream(redactor: TerminalRedactor, chunks: readonly string[]): string {
  return (
    chunks.map((chunk) => redactor.push(chunk)).join("") + redactor.flush()
  );
}

describe("TerminalRedactor", () => {
  it("masks a known secret in place and keeps the layout", () => {
    const redactor = new TerminalRedactor([SECRET]);
    const output = stream(redactor, [`token ${SECRET} end\r\n`]);
    expect(output).toBe(`token ${"*".repeat(SECRET.length)} end\r\n`);
  });

  it("masks a secret that is split over chunks at any position", () => {
    for (let cut = 1; cut < SECRET.length; cut += 1) {
      const redactor = new TerminalRedactor([SECRET]);
      const output = stream(redactor, [
        `a ${SECRET.slice(0, cut)}`,
        `${SECRET.slice(cut)} b`,
      ]);
      // At most three characters of a split may pass before the boundary.
      expect(output).not.toContain(SECRET.slice(0, 4));
      expect(output).not.toContain(SECRET.slice(-4));
    }
  });

  it("masks a secret interrupted by colors and control sequences", () => {
    const redactor = new TerminalRedactor([SECRET]);
    const colored = `${SECRET.slice(0, 6)}${ESC}[1;31m${SECRET.slice(6, 12)}${ESC}[0m${SECRET.slice(12)}`;
    const output = stream(redactor, [colored.slice(0, 9), colored.slice(9)]);
    expect(output.replaceAll(/\u001b\[[0-9;]*m/gu, "")).toBe(
      "*".repeat(SECRET.length),
    );
    expect(output).toContain(`${ESC}[1;31m`);
  });

  it("masks a secret that a CLI wraps over two lines", () => {
    const redactor = new TerminalRedactor([SECRET]);
    const output = stream(redactor, [
      `${SECRET.slice(0, 10)}\r\n  ${SECRET.slice(10)}`,
    ]);
    expect(output).toBe(
      `${"*".repeat(10)}\r\n  ${"*".repeat(SECRET.length - 10)}`,
    );
  });

  it("holds an unfinished control sequence until the next chunk", () => {
    const redactor = new TerminalRedactor([]);
    expect(redactor.push(`ab${ESC}[3`)).toBe("ab");
    expect(redactor.hasPending).toBe(true);
    expect(redactor.push("1mc")).toBe(`${ESC}[31mc`);
  });

  it("masks credential-shaped tokens split over chunks", () => {
    const redactor = new TerminalRedactor([]);
    const token = "ghp_abcdefghijklmnopqrstuvwx";
    const output = stream(redactor, [
      "push with gh",
      "p_abcdef",
      "ghijklmnopqrstuvwx done",
    ]);
    expect(output).not.toContain(token.slice(4));
    expect(output).toContain("done");
  });

  it("masks an assigned password and a bearer header", () => {
    const redactor = new TerminalRedactor([]);
    const output = stream(redactor, [
      "password: hunt",
      "er2\r\nAuthorization: Bearer abc.def-123\r\n",
    ]);
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("abc.def-123");
  });

  it("masks a private key over several chunks", () => {
    const redactor = new TerminalRedactor([]);
    const output = stream(redactor, [
      "-----BEGIN OPENSSH PRIVATE KEY-----\r\nAAAAB3Nza",
      "C1yc2EAAAADAQAB\r\nZZZZ\r\n-----END OPENSSH PRIVATE KEY-----\r\nafter",
    ]);
    expect(output).not.toMatch(/AAAAB3|yc2EA|ZZZZ/u);
    expect(output).toContain("after");
  });

  it("does not delay ordinary typing", () => {
    const redactor = new TerminalRedactor([SECRET]);
    expect(redactor.push("P")).toBe("P");
    expect(redactor.push("q")).toBe("q");
  });
});
