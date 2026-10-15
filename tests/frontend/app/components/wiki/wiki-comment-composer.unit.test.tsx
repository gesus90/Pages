import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { WikiCommentComposer } from "@/app/components/wiki/wiki-comment-composer";
import { createI18n } from "@/app/lib/i18n";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { ComponentProps } from "react";
import type { WikiActionResult } from "@/app/lib/wiki-actions/wiki-action-support.server";

const fetcher = vi.hoisted(() => ({
  data: undefined as WikiActionResult | undefined,
  state: "idle",
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({ ...fetcher, Form: NativeForm }),
}));

function NativeForm(properties: ComponentProps<"form">): React.ReactElement {
  return <form {...properties} />;
}
const i18n = createI18n("en");
beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
});

function renderComposer(): ReturnType<typeof render> & {
  readonly done: ReturnType<typeof vi.fn>;
  readonly refresh: () => void;
} {
  const done = vi.fn();
  function content(): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <WikiCommentComposer
          pageId="page"
          parentId="parent"
          quote={{ quote: "Quoted passage", prefix: "before", suffix: "after" }}
          label="Reply"
          submitLabel="Send reply"
          onDone={done}
        />
      </I18nextProvider>
    );
  }
  const rendered = render(content());
  return { ...rendered, done, refresh: () => rendered.rerender(content()) };
}

it("keeps blank comments unsendable and includes reply and quotation context", () => {
  const { container } = renderComposer();
  const send = screen.getByRole("button", { name: "Send reply" });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
    target: { value: "  " },
  });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Useful reply" },
  });
  expect(send).toHaveProperty("disabled", false);
  const form = container.querySelector("form");
  if (!form) throw new Error("Expected comment form");
  expect(form.getAttribute("method")).toBe("post");
  expect(Object.fromEntries(new FormData(form))).toEqual({
    intent: "add-comment",
    parentId: "parent",
    quote: "Quoted passage",
    quotePrefix: "before",
    quoteSuffix: "after",
    body: "Useful reply",
  });
});

it("preserves the draft after server refusal and disables sending while pending", () => {
  const { refresh, done } = renderComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Keep this reply" },
  });
  fetcher.state = "submitting";
  refresh();
  expect(screen.getByRole("button", { name: "Send reply" })).toHaveProperty(
    "disabled",
    true,
  );
  fetcher.state = "idle";
  fetcher.data = { ok: false, error: "forbidden" };
  refresh();
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("wiki.errors.forbidden"),
  );
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "Keep this reply",
  );
  expect(done).not.toHaveBeenCalled();
});

it("clears a successfully saved comment and calls completion once", () => {
  const { refresh, done } = renderComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Saved reply" },
  });
  fetcher.data = { ok: true };
  refresh();
  refresh();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  expect(done).toHaveBeenCalledTimes(1);
});

it("counts Unicode characters near the limit and allows cancellation", () => {
  const { done } = renderComposer();
  const length = Math.floor(WIKI_LIMITS.commentLength * 0.8) + 1;
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "🙂".repeat(length) },
  });
  expect(
    screen.getByText(`${length} / ${WIKI_LIMITS.commentLength}`),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("wiki.dialog.cancel") }),
  );
  expect(done).toHaveBeenCalledTimes(1);
});
