import { describe, expect, it } from "vitest";

import { applyProjectChange, applyTicketChange } from "./GitHubLocalChange";

import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type {
  AnnounceOptions,
  PagesEvent,
} from "@/backend/service/events/PagesEventPublisher";

interface Announcement {
  readonly events: readonly PagesEvent[];
  readonly options: unknown;
}

function createEvents(): {
  readonly events: GitHubChangeEvents;
  readonly announced: Announcement[];
} {
  const announced: Announcement[] = [];
  const events: GitHubChangeEvents = {
    announce: async <Result>(
      work: () => Promise<Result>,
      decide: (result: Result) => readonly PagesEvent[],
      options?: AnnounceOptions,
    ): Promise<Result> => {
      const result = await work();
      announced.push({ events: decide(result), options });
      return result;
    },
  };

  return { events, announced };
}

describe("applyTicketChange", () => {
  it("runs the work and announces ticket.changed at the first write", async () => {
    const { events, announced } = createEvents();

    const result = await applyTicketChange(events, "ticket-1", () =>
      Promise.resolve("done"),
    );

    expect(result).toBe("done");
    expect(announced).toEqual([
      {
        events: [{ type: "ticket.changed", id: "ticket-1" }],
        options: { opensAtFirstWrite: true },
      },
    ]);
  });
});

describe("applyProjectChange", () => {
  it("announces project.tickets.changed when the list changed", async () => {
    const { events, announced } = createEvents();

    const result = await applyProjectChange(events, "project-1", () =>
      Promise.resolve(true),
    );

    expect(result).toBe(true);
    expect(announced).toEqual([
      {
        events: [{ type: "project.tickets.changed", id: "project-1" }],
        options: { decidesChange: true },
      },
    ]);
  });

  it("announces nothing when the list did not change", async () => {
    const { events, announced } = createEvents();

    const result = await applyProjectChange(events, "project-1", () =>
      Promise.resolve(false),
    );

    expect(result).toBe(false);
    expect(announced[0]?.events).toEqual([]);
  });
});
