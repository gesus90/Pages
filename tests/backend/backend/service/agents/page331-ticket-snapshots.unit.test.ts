import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type * as fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CliAssetWorkspace } from "@/backend/agents/cli/CliAssetWorkspace";
import { logEvent, withLogContext } from "@/backend/logging/Logger";
import { AgentTicketAssetSnapshots } from "@/backend/service/agents/AgentTicketAssetSnapshots";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import {
  prepareRecoveredPlan,
  preparePlanContinuation,
} from "@/backend/service/agents/AgentPlanContinuation";
import { retainRemoteTicketSnapshots } from "@/backend/service/agents/AgentPlanTicketSnapshots";
import { RunnerAssetUploads } from "@/backend/service/runner/RunnerAssetUploads";
import { RunnerParameterFiles } from "@/backend/service/runner/RunnerParameterFiles";
import { RunnerAssetCursors } from "@/backend/service/runner/RunnerAssetCursors";
import { STREAMED_ASSET_REASON } from "@/backend/service/agents/AgentTicketAssetService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { assetFiles } from "./page331-memory-assets";
import { parameterRunFixture } from "./page55-run-fixture";
import { TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";
import {
  ticketAssetWorld,
  ticketDeclaration,
  PNG,
  TEXT,
} from "./page60-ticket-assets-fixture";
import { remoteTodoStep } from "./page162-remote-fixture";
import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { RemotePlanParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { ParameterFileAccess } from "@/backend/service/runner/RunnerParameterFiles";

vi.mock("node:fs/promises", async () =>
  (await import("./page331-memory-assets")).assetFiles.promises(),
);
vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof fs>("node:fs")),
  createWriteStream: (file: string) => assetFiles.writer(file),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
  withLogContext: vi.fn((context: unknown, work: () => unknown) => work()),
}));

beforeEach(() => {
  assetFiles.reset();
  vi.clearAllMocks();
});

function localWorld(): ReturnType<typeof ticketAssetWorld> & {
  snapshots: AgentTicketAssetSnapshots;
} {
  const world = ticketAssetWorld();
  const snapshots = new AgentTicketAssetSnapshots("/private");
  const service = new AgentTicketParameterService(
    world.context,
    world.assets,
    undefined,
    snapshots,
  );
  return { ...world, service, snapshots };
}

async function localRun(
  world: ReturnType<typeof localWorld>,
): Promise<Awaited<ReturnType<typeof parameterRunFixture>>> {
  const fixture = await parameterRunFixture(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{ticket.assets}}",
      parameters: [ticketDeclaration("ticket")],
    },
    "codex_cli",
    world.service,
  );
  const pinned = await world.service.pinAssets(
    "owner",
    fixture.step.prepared.parameters.assetInputs,
  );
  const step = {
    ...fixture.step,
    prepared: {
      ...fixture.step.prepared,
      parameters: { ...fixture.step.prepared.parameters, assetInputs: pinned },
    },
  };
  return { ...fixture, step, snapshot: { ...fixture.snapshot, steps: [step] } };
}

function added(world: ReturnType<typeof localWorld>): void {
  world.files.set("later", Buffer.from("added later"));
  vi.mocked(world.dependencies.tickets.list).mockResolvedValue([
    { id: "png" },
    { id: "later" },
  ]);
}

function changedAndRemoved(world: ReturnType<typeof localWorld>): void {
  world.files.set("png", Buffer.alloc(PNG.length, 65));
  world.files.delete("text");
  world.tickets.set(TICKET.id, {
    ...TICKET,
    description: "Removed the text attachment",
  });
}

function expectNotice(message: string): void {
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "info",
      event: "agent.ticket_assets.snapshot",
      message,
    }),
  );
}

describe("local ticket start copies", () => {
  it("keeps the first manifest across a new attempt and logs a later attachment without passing it", async () => {
    const world = localWorld();
    const fixture = await localRun(world);
    const first = await fixture.start.prepare(
      fixture.run,
      fixture.snapshot,
      fixture.step,
    );
    const copies = new CliAssetWorkspace("/workspace");
    const prepared = await copies.prepare(first.input);
    added(world);
    const repeated = await prepared.readTicketAssets?.();
    expect(repeated?.map((file) => file.asset.id)).toEqual(["png", "text"]);
    const retried = await fixture.start.prepare(
      fixture.run,
      structuredClone(fixture.snapshot),
      fixture.step,
    );
    expect(
      (await retried.input.readTicketAssets?.())?.map((file) => file.asset.id),
    ).toEqual(["png", "text"]);
    expect(retried.input.prompt).not.toContain("later");
    expect(world.open.mock.calls.some(([, id]) => id === "later")).toBe(false);
    expect(withLogContext).toHaveBeenCalledWith(
      { runId: fixture.run.id, stepId: fixture.step.step.id },
      expect.any(Function),
    );
    expectNotice(
      "1 Anhang kam nach dem Start dazu und ist nicht in diesem Lauf.",
    );
    await copies.cleanup();
  });

  it("keeps original bytes and names after an original changes and another disappears", async () => {
    const world = localWorld();
    const fixture = await localRun(world);
    changedAndRemoved(world);
    const next = await fixture.start.prepare(
      fixture.run,
      fixture.snapshot,
      fixture.step,
    );
    const files = await next.input.readTicketAssets?.();
    expect(files?.map((file) => Buffer.from(file.bytes ?? []))).toEqual([
      PNG,
      Buffer.from(TEXT),
    ]);
    expect(files?.map((file) => file.fileName)).toEqual([
      "diagram.png",
      "notes.txt",
    ]);
    expectNotice(
      "2 Anhänge wurden nach dem Start geändert oder entfernt. Dieser Lauf nutzt seine geprüften Kopien vom Start.",
    );
  });
});

describe("local snapshot integrity and authorization", () => {
  it.each(["tampered", "missing", "symlink"])(
    "refuses a %s workspace copy with parameter_ticket_changed",
    async (kind) => {
      const world = localWorld();
      const fixture = await localRun(world);
      const input = await fixture.start.prepare(
        fixture.run,
        fixture.snapshot,
        fixture.step,
      );
      const prepared = await new CliAssetWorkspace("/workspace").prepare(
        input.input,
      );
      const [file] = (await prepared.readTicketAssets?.()) ?? [];
      if (!file?.path) throw new Error("Missing workspace copy");
      if (kind === "tampered")
        assetFiles.contents.set(file.path, Buffer.alloc(PNG.length, 1));
      if (kind === "missing") assetFiles.contents.delete(file.path);
      if (kind === "symlink") assetFiles.links.add(file.path);
      await expect(prepared.readTicketAssets?.()).rejects.toMatchObject({
        code: "parameter_ticket_changed",
      });
    },
  );

  it("keeps an empty initial manifest empty after attachments arrive", async () => {
    const world = localWorld();
    vi.mocked(world.dependencies.tickets.list).mockResolvedValue([]);
    world.tickets.set(TICKET.id, { ...TICKET, description: "No files" });
    const fixture = await localRun(world);
    added(world);
    const retried = await fixture.start.prepare(
      fixture.run,
      fixture.snapshot,
      fixture.step,
    );
    expect(await retried.input.readTicketAssets?.()).toEqual([]);
    expect(retried.input.ticketInputs?.[0].snapshots).toEqual({});
  });

  it("still refuses inactive users and revoked ticket rights when copies exist", async () => {
    const world = localWorld();
    const fixture = await localRun(world);
    const inputs = fixture.step.prepared.parameters.assetInputs;
    await expect(
      world.service.readAssets("inactive", inputs),
    ).rejects.toMatchObject({ code: "parameter_ticket_unavailable" });
    world.denied.add(TICKET.id);
    await expect(
      fixture.start.prepare(fixture.run, fixture.snapshot, fixture.step),
    ).rejects.toMatchObject({ code: "parameter_ticket_unavailable" });
  });
});

describe("local recovery manifests", () => {
  it.each(["recovered", "paused"])(
    "retains the first copies when a %s continuation prepares the ticket again",
    async (mode) => {
      const world = localWorld();
      const fixture = await localRun(world);
      added(world);
      const proposed = await localRun(world);
      const paused = {
        ...fixture.run,
        status: "paused" as const,
        pauseBoundary: {
          pausedAt: "now",
          completedStepIds: [],
          pendingStepIds: [fixture.step.step.id],
          frontierStepIds: [fixture.step.step.id],
        },
      };
      const next =
        mode === "recovered"
          ? prepareRecoveredPlan(paused, fixture.snapshot, proposed.snapshot)
          : preparePlanContinuation(paused, fixture.snapshot, proposed.snapshot)
              .snapshot;
      const step = next.steps[0];
      if (!step) throw new Error("Missing continued step");
      const input = await fixture.start.prepare(paused, next, step);
      expect(
        (await input.input.readTicketAssets?.())?.map((file) => file.asset.id),
      ).toEqual(["png", "text"]);
    },
  );
});

const TARGET: AgentPlanRemoteTarget = {
  kind: "remote",
  connectionId: "runner",
  connectionRevision: 1,
  connectionName: "Runner",
  workspaceId: "workspace",
  workspaceRevision: 1,
  workspaceName: "Workspace",
  path: "/remote",
};

async function remoteWorld(): Promise<{
  world: ReturnType<typeof localWorld>;
  service: AgentPlanRemoteParameters;
  prepared: RemotePlanParameters;
  files: RunnerParameterFiles;
  access: ParameterFileAccess;
}> {
  const world = localWorld();
  const service = new AgentPlanRemoteParameters({
    tickets: world.service,
    assets: world.assets,
    snapshots: world.snapshots,
    content: partial({}),
    authorization: partial({}),
    users: partial({ getById: async () => TICKET_ACTOR }),
    targets: partial({ list: async () => [TARGET] }),
  });
  const base = remoteTodoStep();
  if (!base.configuration) throw new Error("Missing configuration");
  const step = {
    ...base,
    configuration: {
      ...base.configuration,
      template: {
        ...base.configuration.template,
        markdown: "{{ticket.assets}}",
        parameters: [ticketDeclaration("ticket")],
      },
    },
  };
  const prepared = await service.prepare("owner", {
    plan: partial({ projectId: "project" }),
    step,
    tasks: [],
    target: TARGET,
  });
  const files = new RunnerParameterFiles({
    parameters: service,
    evidence: partial({ write: vi.fn(async () => undefined) }),
  });
  const access: ParameterFileAccess = {
    run: partial({
      id: "run",
      userId: "owner",
      steps: [{ id: step.id, execution: { attemptId: "attempt" } }],
    }),
    remote: partial({ step, parameters: prepared }),
    cursors: new RunnerAssetCursors(),
  };
  return { world, service, prepared, files, access };
}

describe("remote ticket start copies", () => {
  it("keeps later uploads outside the original manifest and serves the same bytes on a fresh attempt", async () => {
    const { world, service, prepared, files, access } = await remoteWorld();
    added(world);
    await service.authorize("owner", prepared, {
      projectId: "project",
      target: TARGET,
    });
    expect(await files.manifest(access)).toMatchObject({
      files: [{ name: "diagram.png" }, { name: "notes.txt" }],
    });
    expect(
      await files.chunk(access, { kind: "asset", index: 0, offset: 0 }),
    ).toMatchObject({ base64: PNG.toString("base64"), done: true });
    const retried = structuredClone(prepared);
    expect(retried.assets).toHaveLength(2);
    expect(withLogContext).toHaveBeenCalledWith(
      { runId: "run", stepId: access.remote.step.id },
      expect.any(Function),
    );
    expect(
      await service.readAsset("owner", retried.assets[0], retried),
    ).toEqual(PNG);
    expectNotice(
      "1 Anhang kam nach dem Start dazu und ist nicht in diesem Lauf.",
    );
  });

  it("continues with start bytes after changed and removed remote originals", async () => {
    const { world, prepared, files, access } = await remoteWorld();
    changedAndRemoved(world);
    expect(
      await files.chunk(access, { kind: "asset", index: 0, offset: 0 }),
    ).toMatchObject({ base64: PNG.toString("base64") });
    expect(
      await files.chunk(access, { kind: "asset", index: 1, offset: 0 }),
    ).toMatchObject({ base64: Buffer.from(TEXT).toString("base64") });
    expect(prepared.assets).toHaveLength(2);
    expectNotice(
      "2 Anhänge wurden nach dem Start geändert oder entfernt. Dieser Lauf nutzt seine geprüften Kopien vom Start.",
    );
  });

  it("refuses a corrupt saved copy and revoked remote owner rights", async () => {
    const { world, service, prepared } = await remoteWorld();
    const asset = prepared.assets[0];
    assetFiles.contents.set(
      `/private/ticket-asset-snapshots/${asset.file.digest}`,
      Buffer.alloc(PNG.length, 1),
    );
    await expect(
      service.readAsset("owner", asset, prepared),
    ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
    world.denied.add(TICKET.id);
    await expect(
      service.openAsset("owner", asset, prepared),
    ).rejects.toMatchObject({ code: "parameter_ticket_unavailable" });
    await expect(
      service.authorizeAsset(
        "owner",
        { ...asset, reference: { ...asset.reference, id: "unbound" } },
        prepared,
      ),
    ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
    await expect(
      service.readAsset(
        "owner",
        { ...asset, owner: { type: "ticket", id: "unbound" } },
        prepared,
      ),
    ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
  });

  it("retains the remote first manifest when recovery proposes a newer ticket", async () => {
    const { prepared } = await remoteWorld();
    const proposed = {
      ...prepared,
      assets: [],
      tickets: { [TICKET.id]: { ...prepared.tickets[TICKET.id], assets: [] } },
    };
    const retained = retainRemoteTicketSnapshots(prepared, proposed);
    expect(retained?.assets).toEqual(prepared.assets);
    expect(retained?.tickets[TICKET.id].assets).toEqual(
      prepared.tickets[TICKET.id].assets,
    );
  });
});

it("serves remote streamed chunks from the start copy after an original changes", async () => {
  const { world, service, prepared, files, access } = await remoteWorld();
  const first = prepared.assets[0];
  const streamed = {
    ...first,
    file: { ...first.file, modelContent: STREAMED_ASSET_REASON },
  };
  const transfer = { ...prepared, assets: [streamed] };
  changedAndRemoved(world);
  world.open.mockClear();
  await service.authorizeAsset("owner", streamed, transfer);
  await service.authorizeAsset("owner", streamed, transfer);
  expect(world.open).not.toHaveBeenCalled();
  const current = {
    ...access,
    remote: { ...access.remote, parameters: transfer },
  };
  expect(
    await files.chunk(current, { kind: "asset", index: 0, offset: 0 }),
  ).toEqual({ base64: PNG.toString("base64"), size: PNG.length, done: true });
  access.cursors.close();
});

describe("snapshot storage and output replay", () => {
  it("captures streamed originals, keeps them after a storage-owner restart and refuses tampering", async () => {
    const snapshots = new AgentTicketAssetSnapshots("/private");
    const bytes = Buffer.from("streamed original");
    const snapshot = await snapshots.pin({
      fileName: "large.txt",
      original: {
        mimeType: "text/plain",
        size: bytes.length,
        digest: createHash("sha256").update(bytes).digest("hex"),
      },
      open: async () => Readable.from([bytes]),
    });
    const restarted = new AgentTicketAssetSnapshots("/private");
    const streamed = await restarted.read(snapshot, 0);
    expect("open" in streamed).toBe(true);
    expect("bytes" in streamed).toBe(false);
    const received: Buffer[] = [];
    for await (const chunk of await restarted.open(snapshot)) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Expected file bytes");
      received.push(chunk);
    }
    expect(Buffer.concat(received)).toEqual(bytes);
    assetFiles.contents.set(
      `/private/ticket-asset-snapshots/${snapshot.original.digest}`,
      Buffer.from("corrupt"),
    );
    await expect(restarted.open(snapshot)).rejects.toMatchObject({
      code: "parameter_ticket_changed",
    });
    await expect(
      restarted.pin({
        fileName: snapshot.fileName,
        original: snapshot.original,
        bytes,
      }),
    ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
  });

  it("keeps an output replay's immutable operation contract separate from ticket mutations", async () => {
    const uploads = new RunnerAssetUploads(
      vi.fn(async () => ({
        assetId: "new",
        link: "/aufgaben/attachments/new",
        contentType: "text/plain",
        fileName: "new.txt",
        size: 3,
        expiresAt: null,
      })),
    );
    const send = async (
      ticket: string,
      operationId: string,
      text: string,
    ): Promise<unknown> => {
      uploads.register("attempt", ticket, operationId);
      return uploads.receive("attempt", {
        ticket,
        offset: 0,
        base64: Buffer.from(text).toString("base64"),
        done: true,
        digest: createHash("sha256").update(text).digest("hex"),
      });
    };
    await send("first", "operation", "one");
    await expect(
      send("new", "another-operation", "two"),
    ).resolves.toMatchObject({ assetId: "new" });
    await expect(send("retry", "operation", "two")).rejects.toMatchObject({
      code: "parameter_asset_conflict",
    });
  });
});

it("refuses an inconsistent source before publishing its private copy", async () => {
  const snapshots = new AgentTicketAssetSnapshots("/private");
  const bytes = Buffer.from("original");
  const original = {
    mimeType: "text/plain",
    size: bytes.length,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
  await expect(
    snapshots.pin({
      fileName: "file.txt",
      original,
      open: async () => Readable.from([Buffer.from("replaced")]),
    }),
  ).rejects.toMatchObject({ code: "parameter_ticket_changed" });
  expect([...assetFiles.contents.keys()]).toEqual([]);
});
