// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useSubmit: vi.fn() };
});

import { I18nextProvider } from "react-i18next";
import { useSubmit } from "react-router";

import { GeneralIconSection } from "@/app/components/projects/general-icon-section";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";

const PROJECT: Project = {
  createdAt: "2026-01-01",
  description: "",
  hasIcon: false,
  id: "project-1",
  managerId: null,
  managerName: null,
  name: "Pages",
  notes: "",
  parentId: null,
  placeholderColor: "#FCE3D3",
  progress: 0,
  startDate: null,
  status: "active",
  targetDate: null,
  updatedAt: "2026-01-01",
};

function renderIcon(): ReturnType<typeof vi.fn> {
  const submit = vi.fn();

  vi.mocked(useSubmit).mockReturnValue(
    submit as unknown as ReturnType<typeof useSubmit>,
  );
  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <GeneralIconSection canWrite project={PROJECT} />
    </I18nextProvider>,
  );

  return submit;
}

describe("GeneralIconSection upload", () => {
  it("posts the chosen file to the icon route as multipart form", () => {
    const submit = renderIcon();
    const file = new File(["image"], "logo.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Icon ändern"), {
      target: { files: [file] },
    });

    expect(submit).toHaveBeenCalledOnce();

    const [formData, options] = submit.mock.calls[0] as [FormData, unknown];

    expect(formData.get("icon")).toBe(file);
    expect(options).toEqual({
      action: "/projekte/project-1/icon",
      encType: "multipart/form-data",
      method: "post",
    });
  });

  it("ignores a cleared file chooser", () => {
    const submit = renderIcon();

    fireEvent.change(screen.getByLabelText("Icon ändern"), {
      target: { files: [] },
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores a chooser without a file list", () => {
    const submit = renderIcon();
    const input = screen.getByLabelText("Icon ändern");

    Object.defineProperty(input, "files", { configurable: true, value: null });
    fireEvent.change(input);

    expect(submit).not.toHaveBeenCalled();
  });
});
