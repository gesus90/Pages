import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ProjectTemplateSaveButton } from "@/app/components/projects/project-template-save-button";
import { Toaster, ToastProvider } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

import type { ReactNode } from "react";
import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";

type SubmitCall = (
  form: FormData,
  options: { readonly method: string },
) => void;

const boundary = vi.hoisted(
  (): {
    result: ProjectDetailActionResult | undefined;
    submit: ReturnType<typeof vi.fn<SubmitCall>>;
  } => ({ result: undefined, submit: vi.fn<SubmitCall>() }),
);

vi.mock("react-router", () => ({
  useFetcher: () => ({
    data: boundary.result,
    state: "idle",
    submit: boundary.submit,
    Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  }),
}));

function TemplatePage(): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("en")}>
      <ToastProvider>
        <ProjectTemplateSaveButton />
        <Toaster />
      </ToastProvider>
    </I18nextProvider>
  );
}

beforeEach(() => {
  boundary.result = undefined;
  boundary.submit.mockReset();
});

it("announces an existing template save through the shared success toaster exactly once", () => {
  const view = render(<TemplatePage />);
  boundary.result = { ok: true };
  view.rerender(<TemplatePage />);
  expect(screen.getByRole("status").textContent).toBe(
    createI18n("en").t("projects.templates.saved"),
  );
  view.rerender(<TemplatePage />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

it("reports a refused save through the shared error toaster and retries the same form action", () => {
  const view = render(<TemplatePage />);
  boundary.result = { ok: false, error: "forbidden" };
  view.rerender(<TemplatePage />);
  expect(screen.getByRole("alert").textContent).toContain("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(boundary.submit).toHaveBeenCalledOnce();
  const [form, options] = boundary.submit.mock.calls[0];
  expect(form).toBeInstanceOf(FormData);
  expect(form.get("intent")).toBe("save-template");
  expect(options).toEqual({ method: "post" });
  act(() => {
    boundary.result = { ok: true };
  });
  view.rerender(<TemplatePage />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
});
