import { expect, it, vi } from "vitest";

import { AgentTicketAnnouncer } from "@/backend/service/agents/AgentTicketAnnouncer";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

import { createUser, createWorkItem } from "../helpers/factories";

it("keeps replays silent and publishes a committed event with or without a GitHub publisher", () => {
  const actor = createUser();
  const item = createWorkItem();
  const events = new PagesEventPublisher();
  const listener = vi.fn();
  const release = events.subscribe(listener);
  const invalidateWorkItems = vi.fn();
  const publish = vi.fn().mockResolvedValue(undefined);
  const announcer = new AgentTicketAnnouncer({
    events,
    cache: { invalidateWorkItems },
    publisher: { publish },
  });
  announcer.announce({ actor, result: {}, published: item, event: null });
  expect(invalidateWorkItems).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  announcer.announce({
    actor,
    result: {},
    published: item,
    event: { type: "ticket.updated", id: item.id },
  });
  expect(publish).toHaveBeenCalledExactlyOnceWith(actor, item);
  new AgentTicketAnnouncer({
    events,
    cache: { invalidateWorkItems },
    publisher: null,
  }).announce({
    actor,
    result: {},
    published: item,
    event: { type: "ticket.created", id: item.id },
  });
  announcer.announce({
    actor,
    result: {},
    published: null,
    event: { type: "milestone.updated", id: "milestone" },
  });
  expect(listener).toHaveBeenCalledTimes(3);
  expect(invalidateWorkItems).toHaveBeenCalledTimes(3);
  release();
  events.publish({ type: "ticket.updated", id: item.id });
  expect(listener).toHaveBeenCalledTimes(3);
});

it("continues delivering post-commit events when an earlier subscriber throws", () => {
  const events = new PagesEventPublisher();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  events.subscribe(() => {
    throw new Error("subscriber unavailable");
  });
  const listener = vi.fn();
  events.subscribe(listener);
  const event = { type: "ticket.updated", id: "ticket" } as const;
  expect(() => events.publish(event)).not.toThrow();
  expect(warning).toHaveBeenCalledExactlyOnceWith(
    "Pages event subscriber failed.",
  );
  expect(listener).toHaveBeenCalledExactlyOnceWith(event);
});
