// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskFormTextField } from "@/app/components/tasks/form/task-form-text-field";

describe("TaskFormTextField", () => {
  it("links the hint to a textarea", () => {
    render(
      <TaskFormTextField
        defaultValue=""
        hint="Use markdown"
        id="notes"
        label="Notes"
        name="notes"
        type="textarea"
      />,
    );

    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription(
      "Use markdown",
    );
  });

  it("renders a textarea and an input without a hint", () => {
    render(
      <>
        <TaskFormTextField
          defaultValue=""
          id="notes"
          label="Notes"
          name="notes"
          type="textarea"
        />
        <TaskFormTextField
          defaultValue=""
          id="title"
          label="Title"
          name="title"
        />
      </>,
    );

    expect(screen.getByLabelText("Notes")).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });
});
