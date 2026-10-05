// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineEditTrigger } from "@/app/components/ui/inline-edit-trigger";

function renderTrigger(): ReturnType<typeof vi.fn> {
  const onStartEdit = vi.fn();

  render(
    <InlineEditTrigger className="text" onStartEdit={onStartEdit}>
      Title
    </InlineEditTrigger>,
  );

  return onStartEdit;
}

describe("InlineEditTrigger", () => {
  it("starts editing with a double click", async () => {
    const user = userEvent.setup();
    const onStartEdit = renderTrigger();

    await user.dblClick(screen.getByRole("button", { name: "Title" }));

    expect(onStartEdit).toHaveBeenCalled();
  });

  it("leaves a single click of a pointer free for selecting text", async () => {
    const user = userEvent.setup();
    const onStartEdit = renderTrigger();

    await user.click(screen.getByRole("button", { name: "Title" }));

    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it.each(["{Enter}", " "])("starts editing with the key %j", async (key) => {
    const user = userEvent.setup();
    const onStartEdit = renderTrigger();

    screen.getByRole("button", { name: "Title" }).focus();
    await user.keyboard(key);

    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });
});
