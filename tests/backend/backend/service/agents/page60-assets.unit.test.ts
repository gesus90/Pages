import { Readable } from "node:stream";

import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { ticketAssetReferences } from "@/backend/service/agents/AgentTicketAssetReferences";
import { MAX_TICKET_ASSET_BYTES } from "@/backend/service/agents/AgentTicketAssetService";

import { TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";
import { PNG, TEXT, ticketAssetWorld } from "./page60-ticket-assets-fixture";

it("reads complete PNG and UTF-8 contents through each file's own authorized service", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  const contents = await world.service.readAssets("executor", [
    { parameter: "referenz", ticket },
  ]);
  expect(contents[0]).toMatchObject({
    parameter: "referenz",
    ticketId: TICKET.id,
    ticketKey: TICKET.key,
    content: {
      type: "image",
      mimeType: "image/png",
      base64: PNG.toString("base64"),
    },
  });
  expect(contents[1].content).toEqual({ type: "text", text: TEXT });
  expect(world.open).toHaveBeenCalledWith(TICKET_ACTOR, "text");
  expect(world.context).toHaveBeenCalledWith("executor");
});

it.each(["png", "text", TICKET.id])(
  "refuses revoked access before a later agent receives %s",
  async (id) => {
    const world = ticketAssetWorld();
    const ticket = await world.service.resolve("executor", TICKET.id);
    await world.service.readAssets("executor", [
      { parameter: "first", ticket },
    ]);
    world.denied.add(id);
    await expect(
      world.service.readAssets("executor", [{ parameter: "next", ticket }]),
    ).rejects.toBeInstanceOf(AgentError);
  },
);

it("refuses deleted files, stream failures, unsupported binary files and truncated storage", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  world.files.delete("png");
  await expect(
    world.service.readAssets("executor", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_asset_unavailable"));
  world.files.set("png", Buffer.from([0, 1, 2]));
  await expect(
    world.service.readAssets("executor", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_asset_type_unsupported"));
  world.open.mockImplementation(async () => ({
    attachment: { fileName: "text.txt", size: 5 },
    stream: Readable.from([Buffer.from("shorter than expected")]),
  }));
  await expect(
    world.service.readAssets("executor", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_asset_unavailable"));
  world.open.mockImplementation(async () => ({
    attachment: { fileName: "text.txt", size: 5 },
    stream: new Readable({
      read() {
        this.destroy(new Error("ENOENT"));
      },
    }),
  }));
  await expect(
    world.service.readAssets("executor", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_asset_unavailable"));
});

it("does not silently adopt changed ticket references and bounds the total transfer", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  world.tickets.set(TICKET.id, { ...TICKET, description: "Changed" });
  await expect(
    world.service.readAssets("executor", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_ticket_changed"));
  world.files.set("png", Buffer.alloc(MAX_TICKET_ASSET_BYTES + 1, 65));
  await expect(
    world.assets.read(TICKET_ACTOR, {
      source: "ticket",
      id: "png",
      link: "/aufgaben/attachments/png",
    }),
  ).rejects.toThrow(new AgentError("parameter_assets_too_large"));
});

it("discovers used reference links and agent assets, deduplicates and ignores code examples", async () => {
  const markdown =
    "![image][ref]\n[text](/agent-assets/text)\n[again](/agent-assets/text)\n\n[ref]: /wiki/attachments/png\n\n`![code](/agent-assets/hidden)`\n\n```md\n![code](/agent-assets/hidden2)\n```";
  expect(ticketAssetReferences(markdown)).toEqual([
    { source: "wiki", id: "png", link: "/wiki/attachments/png" },
    { source: "agent", id: "text", link: "/agent-assets/text" },
  ]);
  const world = ticketAssetWorld(markdown);
  expect(
    (
      await world.assets.read(TICKET_ACTOR, {
        source: "agent",
        id: "text",
        link: "/agent-assets/text",
      })
    ).content,
  ).toEqual({ type: "text", text: TEXT });
});

it("rejects external image references explicitly and never fetches the network", () => {
  expect(() =>
    ticketAssetReferences("![image](https://outside.invalid/image.png)"),
  ).toThrow(new AgentError("parameter_asset_reference_unsupported"));
  expect(
    ticketAssetReferences("[documentation](https://outside.invalid/docs)"),
  ).toEqual([]);
});

it("reauthorizes original assets for historical results even after their ticket links are removed", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  world.tickets.set(TICKET.id, { ...TICKET, description: "No links now" });
  world.denied.add("text");
  await expect(
    world.service.requireAssets("executor", ticket.assets),
  ).rejects.toThrow(new AgentError("parameter_asset_unavailable"));
});

it("rejects invalid UTF-8 and totals files across parameters before transmitting", async () => {
  const world = ticketAssetWorld("Description");
  world.files.set("png", Buffer.from([0xc3, 0x28]));
  await expect(
    world.assets.read(TICKET_ACTOR, {
      source: "ticket",
      id: "png",
      link: "/aufgaben/attachments/png",
    }),
  ).rejects.toThrow(new AgentError("parameter_asset_type_unsupported"));
  world.files.set("png", Buffer.alloc(MAX_TICKET_ASSET_BYTES / 2 + 1, 65));
  const ticket = await world.service.resolve("executor", TICKET.id);
  await expect(
    world.service.readAssets("executor", [
      { parameter: "one", ticket },
      { parameter: "two", ticket },
    ]),
  ).rejects.toThrow(new AgentError("parameter_assets_too_large"));
});

it("refuses an inactive executor on file transmission and historical reads", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  await expect(
    world.service.readAssets("inactive", [{ parameter: "ticket", ticket }]),
  ).rejects.toThrow(new AgentError("parameter_ticket_unavailable"));
  await expect(
    world.service.requireAssets("inactive", ticket.assets),
  ).rejects.toThrow(new AgentError("parameter_asset_unavailable"));
});
