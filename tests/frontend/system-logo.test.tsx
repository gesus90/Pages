// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";

import { LogoForm } from "@/app/components/settings/system/logo-form";
import { createI18n } from "@/app/lib/i18n";

const mockedActionData = vi.mocked(useActionData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

function renderForm(
  options: { actionData?: unknown; navigation?: unknown } = {},
): ReturnType<typeof vi.fn> {
  const submit = vi.fn();

  mockedSubmit.mockReturnValue(
    submit as unknown as ReturnType<typeof useSubmit>,
  );
  mockedActionData.mockReturnValue(options.actionData);
  mockedNavigation.mockReturnValue(
    (options.navigation ?? { state: "idle" }) as ReturnType<
      typeof useNavigation
    >,
  );

  const router = createMemoryRouter(
    [{ element: <LogoForm logoUrl={null} />, path: "/" }],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return submit;
}

describe("LogoForm upload", () => {
  it("sends the chosen file as multipart form", async () => {
    const user = userEvent.setup();
    const submit = renderForm();
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", {
      type: "image/png",
    });

    await user.upload(screen.getByLabelText("Firmenlogo"), file);
    await user.click(screen.getByRole("button", { name: "Logo hochladen" }));

    expect(submit).toHaveBeenCalledTimes(1);

    const [formData, options] = submit.mock.calls[0] as [
      FormData,
      { encType: string; method: string },
    ];

    expect(options).toEqual({
      encType: "multipart/form-data",
      method: "post",
    });
    expect(formData.get("intent")).toBe("update-logo");
    expect(formData.has("logo")).toBe(true);
    expect(
      (screen.getByLabelText("Firmenlogo") as HTMLInputElement).files?.[0],
    ).toBe(file);
  });

  it("offers only the image types the server accepts", () => {
    renderForm();

    expect(screen.getByLabelText("Firmenlogo")).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp,image/svg+xml",
    );
  });

  it("confirms a stored logo", () => {
    renderForm({ actionData: { intent: "update-logo", ok: true } });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Das Logo wurde gespeichert.",
    );
  });

  it.each([
    ["missing", "Bitte zuerst eine Datei auswählen."],
    [
      "invalidLogo",
      "Die Datei ist kein gültiges Logo (JPEG, PNG, WebP oder sicheres SVG bis 2 MB).",
    ],
    ["general", "Das Logo konnte nicht gespeichert werden."],
  ] as const)("explains a %s upload", (error, message) => {
    renderForm({ actionData: { error, intent: "update-logo", ok: false } });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("disables the upload while a file is sent", () => {
    renderForm({
      navigation: {
        formData: new URLSearchParams({ intent: "update-logo" }),
        state: "submitting",
      },
    });

    expect(
      screen.getByRole("button", { name: "Logo hochladen" }),
    ).toBeDisabled();
  });
});
