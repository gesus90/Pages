// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import {
  AssistantProfileField,
  readAssistantProfileChoices,
} from "@/app/components/assistant/assistant-profile-field";
import { createI18n } from "@/app/lib/i18n";

import type { AssistantFormState } from "@/app/components/assistant/assistant-form";

const first = {
  id: "personal",
  name: "Personal",
  model: "model-a",
  reasoningEffort: "medium",
};
const second = {
  id: "system",
  name: "System",
  model: "model-b",
  reasoningEffort: null,
};
const initial: AssistantFormState = {
  action: "chat",
  scope: "none",
  change: "answer",
  instruction: "",
  targetLanguage: "de",
  autoApply: false,
};

function story(state: AssistantFormState = initial, isRunning = false) {
  const onChange = vi.fn();
  function Story(): React.ReactElement {
    const [form, setForm] = useState(state);
    return (
      <>
        <AssistantProfileField
          state={form}
          isRunning={isRunning}
          onChange={(next) => {
            onChange(next);
            setForm(next);
          }}
        />
        <button
          type="button"
          onClick={() =>
            setForm({ ...form, action: "proofread", profileId: null })
          }
        >
          Text purpose
        </button>
      </>
    );
  }
  return {
    ...render(
      <I18nextProvider i18n={createI18n("en")}>
        <Story />
      </I18nextProvider>,
    ),
    onChange,
    user: userEvent.setup(),
  };
}

describe("explicit, credential-free profile selection", () => {
  it("requires explicit selection between personal and system profiles and sends purpose-specific metadata requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ ok: true, profiles: [first, second] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { user, onChange } = story();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(onChange).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("combobox", { name: "Execution profile" }),
    );
    await user.click(
      screen.getByRole("option", { name: "Personal · model-a · medium" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...initial,
      profileId: "personal",
    });
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Choose a profile" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, profileId: null });
    await user.click(screen.getByRole("button", { name: "Text purpose" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([, options]) => options?.body)).toEqual([
      JSON.stringify({ intent: "profiles", purpose: "chat" }),
      JSON.stringify({ intent: "profiles", purpose: "text" }),
    ]);
  });

  it("pins the sole profile and preserves a revoked selection instead of selecting another account", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json({ ok: true, profiles: [second] }),
        ),
    );
    const rendered = story();
    await waitFor(() =>
      expect(rendered.onChange).toHaveBeenLastCalledWith({
        ...initial,
        profileId: "system",
      }),
    );
    rendered.unmount();
    const revoked = story({ ...initial, profileId: "revoked" });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.getByRole("combobox")).toHaveTextContent("Unavailable");
    expect(revoked.onChange).not.toHaveBeenCalled();
  });

  it("handles empty lists and stable errors; running requests cannot change profiles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, profiles: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: false, error: "accessDenied" }, { status: 403 }),
      )
      .mockRejectedValueOnce(new Error("private diagnostic"));
    vi.stubGlobal("fetch", fetchMock);
    const empty = story();
    expect(
      await screen.findByText("No active assigned profile is available."),
    ).toBeInTheDocument();
    empty.unmount();
    const denied = story();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    expect(screen.queryByText("private diagnostic")).toBeNull();
    denied.unmount();
    const failed = story(initial, true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("combobox")).toBeDisabled();
    failed.unmount();
  });

  it("ignores successful and failing completions after unmount", async () => {
    for (const shouldReject of [false, true]) {
      let resolve: (response: Response) => void = () => undefined;
      let reject: (failure: Error) => void = () => undefined;
      const response = new Promise<Response>((success, failure) => {
        resolve = success;
        reject = failure;
      });
      const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response);
      vi.stubGlobal("fetch", fetchMock);
      const rendered = story();
      const signal = fetchMock.mock.calls[0][1]?.signal;
      rendered.unmount();
      await act(async () => {
        if (shouldReject) reject(new Error("synthetic"));
        else resolve(Response.json({ ok: true, profiles: [first] }));
      });
      expect(signal?.aborted).toBe(true);
      expect(rendered.onChange).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed or credential-expanded selections at the client contract boundary", () => {
    expect(readAssistantProfileChoices([first, second])).toEqual([
      first,
      second,
    ]);
    for (const input of [
      null,
      [null],
      [{ ...first, id: 1 }],
      [{ ...first, name: 1 }],
      [{ ...first, model: 1 }],
      [{ ...first, reasoningEffort: 1 }],
    ])
      expect(() => readAssistantProfileChoices(input)).toThrow();
    expect(
      readAssistantProfileChoices([{ ...first, apiKey: "never-forward" }]),
    ).toEqual([first]);
  });
});
