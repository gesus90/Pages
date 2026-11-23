import { describe, expect, it } from "vitest";

import {
  readGlobals,
  readOneShot,
  readPlanObject,
  readPlanSharing,
} from "@/backend/agents/AgentPlanSettingsInput";
import { AgentError } from "@/backend/error/AgentErrors";

describe("readPlanObject", () => {
  it("returns an object", () => {
    expect(readPlanObject({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([null, [], "x", 3, undefined])("rejects %j", (input) => {
    expect(() => readPlanObject(input)).toThrow(AgentError);
  });
});

describe("readPlanSharing", () => {
  it("defaults the operator to or", () => {
    expect(
      readPlanSharing({
        isGlobal: false,
        targets: [{ kind: "group", targetId: "g" }],
      }),
    ).toEqual({
      isGlobal: false,
      targets: [{ kind: "group", targetId: "g" }],
      operator: "or",
    });
  });

  it("keeps an explicit and operator and department targets", () => {
    expect(
      readPlanSharing({
        isGlobal: true,
        targets: [{ kind: "department", targetId: "d" }],
        operator: "and",
      }).operator,
    ).toBe("and");
  });

  it("rejects a non boolean global flag, a bad operator and person targets", () => {
    expect(() => readPlanSharing({ isGlobal: 1, targets: [] })).toThrow(
      AgentError,
    );
    expect(() =>
      readPlanSharing({ isGlobal: true, targets: [], operator: "xor" }),
    ).toThrow(AgentError);
    expect(() =>
      readPlanSharing({
        isGlobal: true,
        targets: [{ kind: "person", targetId: "p" }],
      }),
    ).toThrow(AgentError);
  });
});

describe("readGlobals", () => {
  it("reads named texts", () => {
    expect(readGlobals({ name: "value" })).toEqual({ name: "value" });
  });

  it("rejects more than 64 entries", () => {
    const globals = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`p${String(index)}`, "x"]),
    );

    expect(() => readGlobals(globals)).toThrow(AgentError);
  });

  it("rejects bad names, non text values and over long texts", () => {
    expect(() => readGlobals({ "bad name": "x" })).toThrow(AgentError);
    expect(() => readGlobals({ name: 1 })).toThrow(AgentError);
    expect(() => readGlobals({ name: "x".repeat(200001) })).toThrow(AgentError);
  });
});

describe("readOneShot", () => {
  it("keeps only true", () => {
    expect(readOneShot(true)).toEqual({ oneShot: true });
    expect(readOneShot(false)).toEqual({});
    expect(readOneShot(undefined)).toEqual({});
  });

  it("rejects anything else", () => {
    expect(() => readOneShot("yes")).toThrow(AgentError);
  });
});
