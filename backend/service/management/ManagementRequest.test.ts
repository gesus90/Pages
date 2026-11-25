import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  managementAvatarSchema,
  managementCreateSchema,
  managementDepartmentsSchema,
  managementGroupCreateSchema,
  managementGroupUpdateSchema,
  managementListSchema,
  managementMembersSchema,
  managementStatusSchema,
  managementUpdateSchema,
  parseManagement,
} from "./ManagementRequest";

const agent = {
  agentMd: "a",
  soulMd: "s",
  connectionId: "c",
  model: "m",
  reasoningEffort: null,
};
const human = {
  kind: "human",
  username: "ann",
  displayName: "Ann",
  email: "a@example.org",
  role: "r",
  departmentIds: [],
  groupIds: [],
};

function reason(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return (error as { details?: { reason: string } }).details?.reason;
  }
  return undefined;
}

describe("parseManagement", () => {
  it("parses valid creation of humans and agents", () => {
    expect(parseManagement(managementCreateSchema, human).username).toBe("ann");
    expect(
      parseManagement(managementCreateSchema, {
        ...human,
        kind: "agent",
        email: undefined,
        agent,
      }).kind,
    ).toBe("agent");
  });

  it("requires kind specific fields", () => {
    expect(
      reason(() =>
        parseManagement(managementCreateSchema, { ...human, email: null }),
      ),
    ).toBe("validation");
    expect(
      reason(() =>
        parseManagement(managementCreateSchema, { ...human, kind: "agent" }),
      ),
    ).toBe("validation");
  });

  it("normalizes revisions and defaults the list limit", () => {
    expect(
      parseManagement(managementUpdateSchema, { expectedRevision: 3 })
        .expectedRevision,
    ).toBe("3");
    expect(parseManagement(managementListSchema, {}).limit).toBe(20);
    expect(
      parseManagement(managementStatusSchema, {
        expectedRevision: "r",
        status: "active",
      }).status,
    ).toBe("active");
    expect(
      parseManagement(managementAvatarSchema, {
        expectedRevision: "r",
        contentType: "image/png",
        dataBase64: "",
      }).contentType,
    ).toBe("image/png");
    expect(
      parseManagement(managementGroupCreateSchema, {
        name: "g",
        description: "",
        memberIds: [],
        leaderIds: [],
      }).name,
    ).toBe("g");
    expect(
      parseManagement(managementGroupUpdateSchema, { expectedRevision: "r" })
        .expectedRevision,
    ).toBe("r");
    expect(
      parseManagement(managementDepartmentsSchema, {
        expectedRevision: "r",
        departmentIds: ["d"],
      }).departmentIds,
    ).toEqual(["d"]);
  });
});

describe("parseManagement validation", () => {
  it("rejects duplicate members and invalid shapes", () => {
    const members = [{ userId: "u", role: "member" }];
    expect(
      parseManagement(managementMembersSchema, {
        expectedRevision: "r",
        members,
      }).members,
    ).toHaveLength(1);
    expect(
      reason(() =>
        parseManagement(managementMembersSchema, {
          expectedRevision: "r",
          members: [...members, ...members],
        }),
      ),
    ).toBe("validation");
    expect(
      reason(() =>
        parseManagement(managementDepartmentsSchema, {
          expectedRevision: "r",
          departmentIds: ["d", "d"],
        }),
      ),
    ).toBe("validation");
  });

  it("refuses credential, access and administrator fields before validation", () => {
    expect(
      reason(() =>
        parseManagement(managementListSchema, { nested: [{ apiKey: "x" }] }),
      ),
    ).toBe("core_system");
    expect(
      reason(() => parseManagement(managementListSchema, { access: "yolo" })),
    ).toBe("access_level");
    expect(
      reason(() =>
        parseManagement(managementListSchema, { accessLevel: "yolo" }),
      ),
    ).toBe("access_level");
    expect(
      reason(() => parseManagement(managementListSchema, { isAdmin: true })),
    ).toBe("role_grant");
    expect(
      reason(() =>
        parseManagement(managementListSchema, { isAdministrator: true }),
      ),
    ).toBe("role_grant");
  });

  it("walks past primitives, nulls and harmless fields", () => {
    const anything = z.unknown();
    expect(
      parseManagement(anything, {
        n: { isAdmin: false, access: "read", v: null, w: 1 },
      }),
    ).toBeTruthy();
    expect(reason(() => parseManagement(managementListSchema, "text"))).toBe(
      "validation",
    );
  });
});
