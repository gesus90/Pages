import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentAttachmentReturnService } from "@/backend/service/agents/AgentAttachmentReturnService";

import { TICKET_ACTOR } from "./page55-ticket-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { UploadedFile } from "@/backend/service/WikiService";
import type { AttachmentReturnTarget } from "@/backend/service/agents/AgentAttachmentReturnTarget";

const IDENTITY: AgentIdentity = {
  userId: TICKET_ACTOR.id,
  isAdmin: true,
  permissions: [],
};
const ORIGINAL = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10"/></svg>',
);
const EDITED = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20"/></svg>',
);
const DIGEST = createHash("sha256").update(ORIGINAL).digest("hex");
const SOURCE = {
  id: "source",
  ownerId: "ticket",
  checksum: DIGEST,
  storageName: "original",
};
const KEYS = new Map<string, StoredAgentOperation>();
const REPLACED = new Set<string>();
const originRead = vi.fn(async () => ({
  fileName: "source.svg",
  size: ORIGINAL.length,
  bytes: ORIGINAL,
  original: {
    mimeType: "image/svg+xml",
    size: ORIGINAL.length,
    digest: DIGEST,
  },
  content: {
    type: "text" as const,
    text: ORIGINAL.toString("utf8"),
    representation: "source" as const,
  },
}));
const actor = vi.fn(async () => TICKET_ACTOR);
const credentialOwner = vi.fn(async () => TICKET_ACTOR.id);
const upload = vi.fn(async (uploaded: UploadedFile) => {
  const chunks = [];
  for await (const bytes of uploaded.body) chunks.push(Buffer.from(bytes));
  expect(Buffer.concat(chunks)).toEqual(EDITED);
  return {
    assetId: "published",
    link: "/aufgaben/attachments/published",
    fileName: uploaded.fileName,
    contentType: "application/octet-stream",
    size: EDITED.length,
    expiresAt: null,
  };
});
const TARGET: AttachmentReturnTarget = {
  authorize: vi.fn(async () => undefined),
  find: vi.fn(async (id) =>
    id === "source"
      ? SOURCE
      : { ...SOURCE, id: "published", storageName: "edited" },
  ),
  upload,
  requireFile: vi.fn(async () => undefined),
  digest: vi.fn(async (name) =>
    createHash("sha256")
      .update(name === "original" ? ORIGINAL : EDITED)
      .digest("hex"),
  ),
  remove: vi.fn(async () => undefined),
};

vi.mock("@/backend/service/agents/AgentAssetReturnSources", () => ({
  assetReturnSources: () => ({ read: originRead }),
}));
vi.mock("@/backend/database/repositories/UserRepository", () => ({
  UserRepository: vi.fn().mockImplementation(function () {
    return { findById: actor };
  }),
}));
vi.mock(
  "@/backend/database/repositories/mcp/PersonalAgentTokenRepository",
  () => ({
    PersonalAgentTokenRepository: vi.fn().mockImplementation(function () {
      return { findOwner: credentialOwner };
    }),
  }),
);
vi.mock("@/backend/service/agents/AgentAttachmentReturnTarget", () => ({
  attachmentReturnTarget: () => TARGET,
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({
    AgentOperationKeyRepository: vi.fn().mockImplementation(function () {
      return {
        find: async (userId: string, operationId: string) =>
          KEYS.get(`${userId}:${operationId}`) ?? null,
        insert: async (
          userId: string,
          operationId: string,
          result: StoredAgentOperation,
        ) => {
          KEYS.set(`${userId}:${operationId}`, result);
        },
      };
    }),
  }),
);
vi.mock(
  "@/backend/database/repositories/agents/AgentAssetRevisionRepository",
  () => ({
    AgentAssetRevisionRepository: vi.fn().mockImplementation(function () {
      return {
        isReplaced: async (source: string, sourceType: string) =>
          REPLACED.has(`${sourceType}:${source}`),
        insert: async (
          source: string,
          replacement: string,
          digest: string,
          sourceType: string,
        ) => {
          expect(replacement).toBe("published");
          expect(digest).toBe(DIGEST);
          REPLACED.add(`${sourceType}:${source}`);
        },
      };
    }),
  }),
);

function service(): AgentAttachmentReturnService {
  const transaction: DatabaseTransaction = {
    execute: async () => undefined,
    query: async () => [],
    onRollback: vi.fn(),
  };
  return new AgentAttachmentReturnService({
    database: { transaction: async (operation) => operation(transaction) },
    directory: "/synthetic/isolated-instance",
    limits: {
      getSettings: async () => ({
        mediaLimitBytes: 1024 * 1024,
        fileLimitBytes: 1024 * 1024,
      }),
    },
  });
}

function file(bytes = EDITED): UploadedFile {
  return {
    fileName: "edited.svg",
    contentLength: bytes.length,
    body: (async function* () {
      yield bytes;
    })(),
  };
}

const REQUEST = {
  operationId: "return-1",
  sourceAttachmentId: "source",
  expectedDigest: DIGEST,
  credentialHash: "originating-authority",
};

beforeEach(() => {
  KEYS.clear();
  REPLACED.clear();
  vi.clearAllMocks();
  credentialOwner.mockResolvedValue(TICKET_ACTOR.id);
});

describe("permanent asset returns", () => {
  it("preserves the original and returns the committed attachment link with provenance", async () => {
    expect(
      await service().upload(file(), async () => IDENTITY, "ticket", REQUEST),
    ).toMatchObject({
      link: "/aufgaben/attachments/published",
      sourceAttachmentId: "source",
      replaces: false,
      digest: createHash("sha256").update(EDITED).digest("hex"),
    });
    expect(TARGET.remove).not.toHaveBeenCalled();
    expect(SOURCE.checksum).toBe(DIGEST);
    expect(upload).toHaveBeenCalledOnce();
  });

  it("recovers the same permanent result after response loss and rejects changed replay input", async () => {
    const returns = service();
    const first = await returns.upload(
      file(),
      async () => IDENTITY,
      "ticket",
      REQUEST,
    );
    expect(
      await returns.upload(file(), async () => IDENTITY, "ticket", {
        ...REQUEST,
        credentialHash: "rotated-authority",
      }),
    ).toEqual(first);
    await expect(
      returns.upload(
        file(Buffer.from("different")),
        async () => IDENTITY,
        "ticket",
        REQUEST,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(upload).toHaveBeenCalledOnce();
  });

  it("requires an unreplaced current source and returns only one explicit replacement", async () => {
    const returns = service();
    expect(
      await returns.upload(file(), async () => IDENTITY, "ticket", {
        ...REQUEST,
        replace: true,
      }),
    ).toMatchObject({ replaces: true });
    await expect(
      returns.upload(file(), async () => IDENTITY, "ticket", {
        ...REQUEST,
        operationId: "another-operation",
        replace: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(upload).toHaveBeenCalledOnce();
  });

  it("rejects stale versions, unchanged renamed output, read-only scope and revoked credentials before persistence", async () => {
    const returns = service();
    await expect(
      returns.upload(file(), async () => IDENTITY, "ticket", {
        ...REQUEST,
        expectedDigest: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      returns.upload(file(ORIGINAL), async () => IDENTITY, "ticket", REQUEST),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const readOnly: AgentIdentity = {
      ...IDENTITY,
      run: {
        runId: "r",
        stepId: "s",
        reach: "read",
        operations: [],
        tickets: [],
      },
    };
    await expect(
      returns.upload(file(), async () => readOnly, "ticket", REQUEST),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    credentialOwner.mockResolvedValueOnce("revoked-owner");
    await expect(
      returns.upload(file(), async () => IDENTITY, "ticket", REQUEST),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(upload).not.toHaveBeenCalled();
  });
});

it("retains authorized wiki provenance when the derived file is returned to a ticket", async () => {
  const result = await service().upload(
    file(),
    async () => IDENTITY,
    "ticket",
    { ...REQUEST, sourceType: "wiki", sourceAttachmentId: "wiki-source" },
  );
  expect(result).toMatchObject({
    sourceType: "wiki",
    sourceLink: "/wiki/attachments/wiki-source",
    replaces: false,
  });
  expect(originRead).toHaveBeenCalledWith(TICKET_ACTOR, {
    source: "wiki",
    id: "wiki-source",
    link: "/wiki/attachments/wiki-source",
  });
  await expect(
    service().upload(file(), async () => IDENTITY, "ticket", {
      ...REQUEST,
      operationId: "cross-replace",
      sourceType: "wiki",
      replace: true,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
