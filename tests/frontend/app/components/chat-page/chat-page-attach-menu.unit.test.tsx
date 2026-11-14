import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatPageAttachMenu } from "@/app/components/chat-page/chat-page-attach-menu";
import { createI18n } from "@/app/lib/i18n";

function renderMenu(canAttach: boolean): {
  readonly onInsert: ReturnType<typeof vi.fn>;
  readonly onFiles: ReturnType<typeof vi.fn>;
  readonly onVoice: ReturnType<typeof vi.fn>;
  readonly container: HTMLElement;
} {
  const onInsert = vi.fn();
  const onFiles = vi.fn();
  const onVoice = vi.fn();
  const { container } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <ChatPageAttachMenu
        canAttach={canAttach}
        onFiles={onFiles}
        onInsert={onInsert}
        onVoice={onVoice}
      />
    </I18nextProvider>,
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Attach and insert" }),
    { button: 0, ctrlKey: false },
  );
  return { onInsert, onFiles, onVoice, container };
}

it("validates a web address and inserts its trimmed value", () => {
  const { onInsert } = renderMenu(true);
  fireEvent.click(screen.getByRole("menuitem", { name: "Embed web page" }));
  const input = screen.getByRole("textbox", {
    name: "Address of the web page",
  });
  fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(screen.getByRole("alert").textContent).toContain("http://");
  expect(onInsert).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: " https://example.com/path " } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(onInsert).toHaveBeenCalledWith("https://example.com/path");
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("inserts templates and omits file choices when attachment is unavailable", () => {
  const { onInsert, container } = renderMenu(false);
  expect(screen.queryByRole("menuitem", { name: "Attach file" })).toBeNull();
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  fireEvent.click(screen.getByRole("menuitem", { name: "Code block" }));
  expect(onInsert).toHaveBeenCalledWith("```\n\n```");
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Attach and insert" }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Diff" }));
  expect(onInsert).toHaveBeenCalledWith("```diff\n- alt\n+ neu\n```");
});

it("passes picked files and starts voice recording", () => {
  const { onFiles, onVoice, container } = renderMenu(true);
  const picker =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!picker) throw new Error("Missing file picker");
  const file = new File(["hello"], "note.txt");
  fireEvent.change(picker, { target: { files: [file] } });
  expect(onFiles).toHaveBeenCalledWith([file]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Voice message" }));
  expect(onVoice).toHaveBeenCalledOnce();
});
