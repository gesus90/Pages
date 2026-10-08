// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WikiSettingsCard } from "@/app/components/settings/system/wiki-settings-card";
import { createI18n } from "@/app/lib/i18n";
import { handleSystemSettingsAction } from "@/app/lib/settings-actions/settings-system-actions.server";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { createUser } from "../helpers/factories";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type { ApplicationServices } from "@/app/lib/services.server";

function renderCard(
  respond: (
    fields: Record<string, FormDataEntryValue>,
  ) => SettingsActionData | null,
  language: "de" | "en" = "en",
): void {
  const Stub = createRoutesStub([
    {
      Component: () => <WikiSettingsCard settings={WIKI_SETTING_DEFAULTS} />,
      action: async ({ request }) =>
        respond(Object.fromEntries(await request.formData())),
      path: "/settings",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={["/settings"]} />
    </I18nextProvider>,
  );
}

describe("WikiSettingsCard", () => {
  it("shows the stored values in days, versions and megabytes", async () => {
    renderCard(() => null);

    expect(await screen.findByLabelText(/Trash: days/)).toHaveValue("30");
    expect(screen.getByLabelText(/Versions: days/)).toHaveValue("90");
    expect(screen.getByLabelText(/Versions: this many/)).toHaveValue("50");
    expect(screen.getByLabelText(/Largest media file/)).toHaveValue("500");
    expect(screen.getByLabelText(/Largest other file/)).toHaveValue("100");
  });

  it("sends the values and confirms", async () => {
    const fields = vi.fn();

    renderCard((entries) => {
      fields(entries);

      return { intent: "update-wiki-settings", ok: true };
    });

    const days = await screen.findByLabelText(/Trash: days/);

    await userEvent.clear(days);
    await userEvent.type(days, "7");
    await userEvent.click(
      screen.getByRole("button", { name: "Save wiki settings" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "The wiki settings were saved.",
    );
    expect(fields).toHaveBeenCalledWith(
      expect.objectContaining({
        fileLimitMegabytes: "100",
        intent: "update-wiki-settings",
        trashRetentionDays: "7",
      }),
    );
  });

  it("says why the values were refused", async () => {
    renderCard(
      () => ({
        error: "invalidSetting",
        intent: "update-wiki-settings",
        ok: false,
      }),
      "de",
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Wiki-Einstellungen speichern",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ganze Zahlen im erlaubten Bereich",
    );
  });
});

describe("update-wiki-settings", () => {
  const updateSettings = vi.fn();

  beforeEach(() => {
    updateSettings.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function submit(fields: Record<string, string>): Promise<unknown> {
    const formData = new FormData();

    for (const [name, value] of Object.entries(fields)) {
      formData.set(name, value);
    }

    return handleSystemSettingsAction("update-wiki-settings", {
      formData,
      request: new Request("http://pages.invalid/settings/system", {
        method: "POST",
      }),
      services: {
        wikiService: { updateSettings },
      } as unknown as ApplicationServices,
      user: createUser(),
    });
  }

  const VALID = {
    fileLimitMegabytes: "100",
    mediaLimitMegabytes: "500",
    trashRetentionDays: "30",
    versionKeepLast: "50",
    versionRetentionDays: "90",
  };

  it("stores the values, megabytes as bytes", async () => {
    await expect(submit(VALID)).resolves.toMatchObject({
      data: { intent: "update-wiki-settings", ok: true },
    });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.anything(),
      WIKI_SETTING_DEFAULTS,
    );
  });

  it("treats anything but whole numbers as invalid", async () => {
    updateSettings.mockRejectedValue(new WikiValidationError("invalidSetting"));

    await expect(
      submit({ ...VALID, trashRetentionDays: "ten" }),
    ).resolves.toMatchObject({
      data: { error: "invalidSetting", ok: false },
      init: { status: 400 },
    });
    expect(updateSettings.mock.calls[0]?.[1]).toMatchObject({
      trashRetentionDays: Number.NaN,
    });
    await expect(submit({})).resolves.toMatchObject({
      data: { error: "invalidSetting" },
    });
  });

  it("refuses everyone but administrators and reports other failures", async () => {
    updateSettings.mockRejectedValueOnce(new InstanceSettingsDeniedError());
    await expect(submit(VALID)).rejects.toMatchObject({ status: 403 });

    updateSettings.mockRejectedValueOnce(new Error("disk"));
    await expect(submit(VALID)).resolves.toMatchObject({
      data: { error: "general", ok: false },
      init: { status: 500 },
    });
  });
});
