import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import type { DiscordActionResult } from "@/definition/Discord";

import {
  attempt,
  AUTHORIZE_URL,
  channel,
  connection,
  managerState,
  renderPanel,
  scriptServer,
  success,
} from "./discord-fixture";

afterEach(() => {
  vi.useRealTimers();
});

it("explains the missing Discord application and never asks for a credential", async () => {
  scriptServer([
    success(
      managerState({
        instance: {
          isConfigured: false,
          missingSettings: [
            "PAGES_DISCORD_APPLICATION_ID",
            "PAGES_DISCORD_CLIENT_SECRET",
            "PAGES_DISCORD_BOT_TOKEN",
          ],
        },
      }),
    ),
  ]);
  renderPanel();

  expect(
    await screen.findByText("Discord is not set up on this server"),
  ).toBeTruthy();
  expect(screen.getByText("PAGES_DISCORD_BOT_TOKEN")).toBeTruthy();
  expect(screen.getByText("PAGES_DISCORD_CLIENT_SECRET")).toBeTruthy();
  // No field of any kind: the application belongs to the instance, not to a project.
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.querySelector("input")).toBeNull();
  expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
});

it("tells people without the right to configure only that an administrator has to set it up", async () => {
  scriptServer([
    success(
      managerState({
        canManage: false,
        instance: {
          isConfigured: false,
          missingSettings: ["PAGES_DISCORD_BOT_TOKEN"],
        },
      }),
    ),
  ]);
  renderPanel();

  expect(await screen.findByText(/Ask a Pages administrator/)).toBeTruthy();
  expect(screen.queryByText("PAGES_DISCORD_BOT_TOKEN")).toBeNull();
});

it("shows a read-only state to people who cannot configure the interface", async () => {
  scriptServer([
    success(
      managerState({
        canManage: false,
        connection: connection({
          events: { ...DEFAULT_DISCORD_EVENTS, "ticket.updated": false },
        }),
      }),
    ),
  ]);
  renderPanel();

  expect(await screen.findByText("Team server")).toBeTruthy();
  expect(screen.getByText("#general")).toBeTruthy();
  expect(
    screen.getByText(/can only be configured by admins and project managers/),
  ).toBeTruthy();
  expect(screen.queryAllByRole("switch")).toHaveLength(0);

  for (const name of [
    "Connect Discord",
    "Disconnect",
    "Send test message",
    "Change channel",
  ]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }

  expect(screen.getAllByText("On")).toHaveLength(3);
  expect(screen.getAllByText("Off")).toHaveLength(1);
});

it("offers to connect and shows the QR code, the official link and the waiting state", async () => {
  const calls = scriptServer([
    success(managerState()),
    success(
      managerState({
        attempt: attempt({ authorizeUrl: AUTHORIZE_URL }),
      }),
    ),
  ]);
  renderPanel();

  fireEvent.click(
    await screen.findByRole("button", { name: "Connect Discord" }),
  );

  const qrCode = await screen.findByRole("img", {
    name: "QR code with the Discord authorization link",
  });
  const link = screen.getByRole("link", { name: /Open Discord authorization/ });

  expect(calls[1]).toMatchObject({ form: { intent: "start" }, method: "POST" });
  expect(link.getAttribute("href")).toBe(AUTHORIZE_URL);
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(
    qrCode.querySelector("path")?.getAttribute("d")?.length,
  ).toBeGreaterThan(500);
  expect(screen.getByRole("status", { name: "" }).textContent).toContain(
    "Waiting",
  );
  // The code is only the entrance to Discord's page; it does not connect anything.
  expect(
    screen.getByText(/Pages connects nothing until you confirm/),
  ).toBeTruthy();
});

it("notices the authorization on the computer and connects only after the confirmation", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  const pending = managerState({
    attempt: attempt({ authorizeUrl: AUTHORIZE_URL }),
  });
  const authorized = managerState({
    attempt: attempt({
      guild: { id: "300", name: "Team server" },
      status: "authorized",
    }),
    channels: [
      channel("201", "general"),
      channel("203", "read-only", {
        isSelectable: false,
        missing: ["SEND_MESSAGES"],
      }),
      channel("204", "hidden", {
        isSelectable: false,
        missing: ["VIEW_CHANNEL", "SEND_MESSAGES"],
      }),
    ],
  });
  const calls = scriptServer([
    success(managerState()),
    success(pending),
    success(pending),
    success(authorized),
    success(managerState({ connection: connection() })),
  ]);
  const changes: boolean[] = [];

  renderPanel((isConnected) => changes.push(isConnected));
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect Discord" }),
  );
  await screen.findByRole("img", { name: /QR code/ });

  // The phone authorizes; the next read of the attempt shows the verified server.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_200);
  });

  expect(await screen.findByText("Server: Team server")).toBeTruthy();

  const general = screen.getByRole("radio", { name: /general/ });
  const readOnly = screen.getByRole("radio", { name: /read-only/ });
  const hidden = screen.getByRole("radio", { name: /hidden/ });
  const confirm = screen.getByRole("button", {
    name: "Connect with this channel",
  });

  expect(readOnly.hasAttribute("disabled")).toBe(true);
  expect(hidden.hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByText("The bot cannot send messages in this channel."),
  ).toBeTruthy();
  expect(screen.getByText(/The bot cannot see this channel\./)).toBeTruthy();
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(changes.at(-1)).toBe(false);

  fireEvent.click(general);
  expect(confirm.hasAttribute("disabled")).toBe(false);
  fireEvent.click(confirm);

  await waitFor(() => {
    expect(calls.at(-1)).toMatchObject({
      form: { attemptId: "attempt-1", channelId: "201", intent: "confirm" },
      method: "POST",
    });
  });
  expect(await screen.findByText("#general")).toBeTruthy();
  expect(changes.at(-1)).toBe(true);
});

it("shows a started attempt without its link after a reload and offers a new start", async () => {
  const calls = scriptServer([
    success(managerState({ attempt: attempt() })),
    success(
      managerState({ attempt: attempt({ authorizeUrl: AUTHORIZE_URL }) }),
    ),
  ]);

  renderPanel();

  expect(
    await screen.findByText(/its link cannot be shown again/),
  ).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(await screen.findByRole("img", { name: /QR code/ })).toBeTruthy();
  expect(calls.at(-1)?.form).toEqual({ intent: "start" });
});

it("explains why an attempt ended and lets the person start again", async () => {
  scriptServer([
    success(
      managerState({
        attempt: attempt({ failure: "verification_failed", status: "failed" }),
      }),
    ),
  ]);
  renderPanel();

  expect(
    await screen.findByText(
      "Pages could not verify that the bot is on that server.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect Discord" })).toBeTruthy();
});

it("tells that an attempt expired", async () => {
  scriptServer([
    success(managerState({ attempt: attempt({ status: "expired" }) })),
  ]);
  renderPanel();

  expect(
    await screen.findByText("The connection attempt expired. Start again."),
  ).toBeTruthy();
});

it("switches the events one by one and sends the whole selection", async () => {
  const changed = {
    ...DEFAULT_DISCORD_EVENTS,
    "milestone.updated": false,
  };
  const calls = scriptServer([
    success(managerState({ connection: connection() })),
    success(managerState({ connection: connection({ events: changed }) })),
  ]);

  renderPanel();

  const toggle = await screen.findByRole("switch", {
    name: "Milestone changed",
  });

  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(screen.getAllByRole("switch")).toHaveLength(4);
  fireEvent.click(toggle);

  await waitFor(() => {
    expect(calls.at(-1)).toMatchObject({
      form: {
        intent: "events",
        "milestone.created": "on",
        "milestone.updated": "",
        "ticket.created": "on",
        "ticket.updated": "on",
      },
      method: "POST",
    });
  });
  await waitFor(() => {
    expect(
      screen
        .getByRole("switch", { name: "Milestone changed" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
  expect(
    screen
      .getByRole("switch", { name: "Ticket created" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("sends a test message and reports the outcome", async () => {
  const connected = managerState({ connection: connection() });
  const calls = scriptServer([
    success(connected),
    success(connected, { isSent: true, problem: null }),
    success(connected, { isSent: false, problem: "missing_permissions" }),
  ]);

  renderPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: "Send test message" }),
  );

  expect(
    await screen.findByText("Test message sent to the channel."),
  ).toBeTruthy();
  expect(calls.at(-1)).toMatchObject({
    form: { intent: "test" },
    method: "POST",
  });

  fireEvent.click(screen.getByRole("button", { name: "Send test message" }));

  const alert = await screen.findByRole("alert", { name: "" });

  expect(alert.textContent).toContain("The test message was not sent.");
  expect(alert.textContent).toContain(
    "The bot may not send messages in the channel.",
  );
});

it("asks before disconnecting, explains that the bot stays and then disconnects", async () => {
  const calls = scriptServer([
    success(managerState({ connection: connection() })),
    success(managerState()),
  ]);
  const changes: boolean[] = [];

  renderPanel((isConnected) => changes.push(isConnected));
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

  expect(calls).toHaveLength(1);
  expect(screen.getByText(/The bot stays on your Discord server/)).toBeTruthy();
  expect(screen.getByText(/Other projects stay connected/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect now" }));

  await waitFor(() => {
    expect(calls.at(-1)).toMatchObject({
      form: { intent: "disconnect" },
      method: "POST",
    });
  });
  expect(
    await screen.findByRole("button", { name: "Connect Discord" }),
  ).toBeTruthy();
  expect(changes.at(-1)).toBe(false);
});

it("changes the channel from the list of the connected server", async () => {
  const connected = managerState({ connection: connection() });
  const calls = scriptServer([
    success(connected),
    success({
      ...connected,
      channels: [
        channel("201", "general"),
        channel("202", "dev", { kind: "announcement" }),
        channel("203", "locked", {
          isSelectable: false,
          missing: ["SEND_MESSAGES"],
        }),
      ],
    }),
    success(
      managerState({
        connection: connection({ channelId: "202", channelName: "dev" }),
      }),
    ),
  ]);

  renderPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: "Change channel" }),
  );

  const list = await screen.findByRole("group", {
    name: "Channel for notifications",
  });
  const dev = within(list).getByRole("radio", { name: /dev/ });
  const save = within(list).getByRole("button", { name: "Use this channel" });

  expect(calls[1]?.address).toContain("channels=1");
  expect(
    within(list).getByRole<HTMLInputElement>("radio", { name: /general/ })
      .checked,
  ).toBe(true);
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.click(dev);
  fireEvent.click(save);

  await waitFor(() => {
    expect(calls.at(-1)).toMatchObject({
      form: { channelId: "202", intent: "channel" },
      method: "POST",
    });
  });
  expect(await screen.findByText("#dev")).toBeTruthy();
});

it("shows a delivery problem in words and the counters of the queue", async () => {
  scriptServer([
    success(
      managerState({
        connection: connection({
          delivery: {
            failed: 2,
            lastProblem: "missing_permissions",
            lastSentAt: "2026-10-15T10:00:00.000Z",
            pending: 1,
          },
        }),
      }),
    ),
  ]);
  renderPanel();

  const alert = await screen.findByRole("alert");

  expect(alert.textContent).toBe(
    "The bot may not send messages in the channel.",
  );
  expect(screen.getByText("Waiting to be sent").nextSibling?.textContent).toBe(
    "1",
  );
  expect(screen.getByText("Given up").nextSibling?.textContent).toBe("2");
});

it("reports a refused request and a panel that could not be loaded", async () => {
  scriptServer(["network-error"]);
  renderPanel();

  expect(
    await screen.findByText("The Discord settings could not be loaded."),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("shows the reason when the server refuses an action", async () => {
  scriptServer([
    success(managerState({ connection: connection() })),
    { error: "forbidden", ok: false },
  ]);
  renderPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: "Send test message" }),
  );

  expect(
    await screen.findByText(
      "You are not allowed to change the Discord settings of this project.",
    ),
  ).toBeTruthy();
});

it("keeps the channel picker open while an event is switched", async () => {
  const connected = managerState({ connection: connection() });
  const withChannels = {
    ...connected,
    channels: [channel("201", "general"), channel("202", "dev")],
  };

  scriptServer([
    success(connected),
    success(withChannels),
    // Answers to an action carry no channel list.
    success(
      managerState({
        connection: connection({
          events: { ...DEFAULT_DISCORD_EVENTS, "ticket.created": false },
        }),
      }),
    ),
  ]);
  renderPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: "Change channel" }),
  );
  await screen.findByRole("group", { name: "Channel for notifications" });

  fireEvent.click(screen.getByRole("switch", { name: "Ticket created" }));

  await waitFor(() => {
    expect(
      screen
        .getByRole("switch", { name: "Ticket created" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
  expect(
    screen.getByRole("group", { name: "Channel for notifications" }),
  ).toBeTruthy();
  expect(screen.getByRole("radio", { name: /dev/ })).toBeTruthy();
});

it("blocks the event switches while a change is being saved, so no switch is lost", async () => {
  const connected = managerState({ connection: connection() });
  let finish: (result: DiscordActionResult) => void = () => undefined;

  scriptServer([
    success(connected),
    () =>
      new Promise<DiscordActionResult>((resolve) => {
        finish = resolve;
      }),
  ]);
  renderPanel();

  fireEvent.click(
    await screen.findByRole("switch", { name: "Ticket created" }),
  );

  await waitFor(() => {
    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle.hasAttribute("disabled")).toBe(true);
    }
  });

  await act(async () => {
    finish(success(connected));
  });
  await waitFor(() => {
    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle.hasAttribute("disabled")).toBe(false);
    }
  });
});

it("offers a retry and a way out when the channels of the authorized server cannot be read", async () => {
  const authorized = managerState({
    attempt: attempt({
      guild: { id: "300", name: "Team server" },
      status: "authorized",
    }),
    channelsProblem: "rate_limited",
  });
  const calls = scriptServer([
    success(authorized),
    success({
      ...authorized,
      channels: [channel("201", "general")],
      channelsProblem: null,
    }),
  ]);

  renderPanel();

  expect((await screen.findByRole("alert")).textContent).toContain("slow down");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("radio", { name: /general/ })).toBeTruthy();
  expect(calls[1]?.address).toContain("channels=1");
});

it("can abandon an authorized attempt whose channels cannot be read", async () => {
  const authorized = managerState({
    attempt: attempt({
      guild: { id: "300", name: "Team server" },
      status: "authorized",
    }),
    channelsProblem: "unavailable",
  });
  const calls = scriptServer([success(authorized), success(managerState())]);

  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

  await waitFor(() => {
    expect(calls.at(-1)).toMatchObject({
      form: { attemptId: "attempt-1", intent: "cancel" },
    });
  });
  expect(
    await screen.findByRole("button", { name: "Connect Discord" }),
  ).toBeTruthy();
});

it("never shows the code of an attempt that another one replaced", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  scriptServer([
    success(managerState()),
    success(
      managerState({
        attempt: attempt({ authorizeUrl: AUTHORIZE_URL, id: "attempt-1" }),
      }),
    ),
    // A second tab restarted the connection; the poll sees the new attempt.
    success(managerState({ attempt: attempt({ id: "attempt-2" }) })),
  ]);
  renderPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect Discord" }),
  );
  await screen.findByRole("img", { name: /QR code/ });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_700);
  });

  expect(
    await screen.findByText(/its link cannot be shown again/),
  ).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(
    screen.queryByRole("link", { name: /Open Discord authorization/ }),
  ).toBeNull();
});
