import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { AgentHostFiles } from "@/backend/service/employee/AgentHostFiles";

import type { AgentHostFileStores } from "@/backend/service/employee/AgentHostFiles";
import type { User } from "@/definition/User";

const boundary = vi.hoisted(() => ({
  content: "",
  resolved: new Map<string, string>(),
  reads: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  realpath: async (file: string) => boundary.resolved.get(file) ?? file,
  stat: async () => ({ isFile: () => true, size: boundary.content.length }),
}));
vi.mock("node:fs", () => ({
  createReadStream: (file: string) => {
    boundary.reads(file);
    return Readable.from([boundary.content]);
  },
}));

const agent: User = {
  id: "agent",
  username: "agent",
  displayName: "Agent",
  role: "employee",
  isActive: true,
  isAgent: true,
  mustChangePassword: false,
};

/** Upload boundaries record any attempt; no file, database or network is used. */
function stores(): AgentHostFileStores {
  return {
    tickets: { upload: vi.fn() },
    wiki: { uploadAttachment: vi.fn() },
    ticketKeys: { getByKey: vi.fn() },
  };
}

it("never attaches the private state by absolute path, relative traversal or a symbolic link", async () => {
  const targets = stores();
  const service = new AgentHostFiles(targets);
  const file = "/runtime/pages-agent-browser-unit/agent/storage-state.json";
  boundary.resolved.set("/chat/state.json", file);
  for (const named of [
    file,
    "../runtime/pages-agent-browser-unit/agent/storage-state.json",
    "state.json",
  ]) {
    expect(
      await service.attach(agent, {
        directory: "/chat",
        file: named,
        target: { kind: "ticket", ticketId: "ticket" },
      }),
    ).toMatchObject({ ok: false, reason: "file_unusable" });
  }
  expect(targets.tickets.upload).not.toHaveBeenCalled();
  expect(boundary.reads).not.toHaveBeenCalled();
});

it("also refuses a copied credential in the working folder before uploading to a ticket or wiki", async () => {
  const targets = stores();
  const service = new AgentHostFiles(targets);
  boundary.content = '{"token":"pabs_PLACEHOLDER_SESSION"}';
  for (const target of [
    { kind: "ticket", ticketId: "ticket" },
    { kind: "wikiPage", pageId: "page" },
  ] as const) {
    expect(
      await service.attach(agent, {
        directory: "/chat",
        file: "copy.json",
        target,
      }),
    ).toMatchObject({ ok: false, reason: "file_credentials" });
  }
  expect(targets.tickets.upload).not.toHaveBeenCalled();
  expect(targets.wiki.uploadAttachment).not.toHaveBeenCalled();
});
