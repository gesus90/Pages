import { describe, expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { describeError } from "@/backend/error/ErrorDescription";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";

/** A system call error as Node.js reports a refused read of another process's environment. */
function refusedRead(): Error {
  return Object.assign(
    new Error("EACCES: permission denied, open '/proc/1003/environ'"),
    { code: "EACCES", syscall: "open", path: "/proc/1003/environ" },
  );
}

describe("describeError", () => {
  it("names the kind, the code and the path of a failed system call", () => {
    expect(describeError(refusedRead())).toBe(
      "Error | EACCES | EACCES: permission denied, open … | /proc/1003/environ",
    );
  });

  it("gives a coded error of Pages its code only once", () => {
    expect(describeError(new PicaAcpJobError("providerFailed"))).toBe(
      "PicaAcpJobError | providerFailed",
    );
    expect(describeError(new AgentError("plan_closeout_failed"))).toMatch(
      /^AgentError \| plan_closeout_failed \| \S/u,
    );
  });

  it("leaves out every quoted part and every further line of the message", () => {
    const error = new SyntaxError(
      "Unexpected token 'x', \"my secret answer\" is not valid JSON\nat `the prompt`",
    );
    const described = describeError(error);
    expect(described).toBe(
      "SyntaxError | Unexpected token …, … is not valid JSON",
    );
    expect(described).not.toContain("secret");
    expect(described).not.toContain("prompt");
  });

  it("keeps a long message short", () => {
    const described = describeError(new Error("a".repeat(500)));
    expect(described).toBe(`Error | ${"a".repeat(160)}`);
  });

  it("names only the type of a thrown value that is no error", () => {
    expect(describeError("the whole conversation")).toBe("string");
    expect(describeError(undefined)).toBe("undefined");
  });
});
