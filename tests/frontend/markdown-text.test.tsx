// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { MarkdownText } from "@/app/components/markdown/markdown-text";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderMarkdown(source: string): HTMLElement {
  const { container } = render(
    <I18nextProvider i18n={createI18n(LANGUAGE.ENGLISH)}>
      <MemoryRouter>
        <MarkdownText source={source} />
      </MemoryRouter>
    </I18nextProvider>,
  );

  return container;
}

describe("MarkdownText", () => {
  it("renders headings, lists, quotes and code", () => {
    const container = renderMarkdown(
      [
        "# One",
        "## Two",
        "### Three",
        "#### Four",
        "",
        "Text with `inline` and **bold**.",
        "",
        "- a",
        "- b",
        "",
        "1. x",
        "",
        "> quote",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );

    expect(screen.getAllByRole("heading")).toHaveLength(4);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain(
      "const a = 1;",
    );
    expect(container.querySelector("p code")?.textContent).toBe("inline");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables and task lists", () => {
    const container = renderMarkdown(
      [
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "- [x] done",
        "- [ ] open",
      ].join("\n"),
    );

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("cell")).toHaveLength(2);

    const boxes = screen.getAllByRole("checkbox");

    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[0]).toBeDisabled();
    expect(container.querySelector("ul")?.className).toContain("list-none");
  });

  it("shows raw HTML as text and drops images", () => {
    const container = renderMarkdown(
      '<script>window.hacked = 1</script><b onclick="x()">hi</b>\n\n![pic](https://example.org/p.png)',
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("neutralises javascript and data links", () => {
    renderMarkdown("[x](javascript:alert(1)) [y](data:text/html;base64,AAAA)");

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("opens external links safely in a new tab", () => {
    renderMarkdown("[site](https://example.org/a)");

    const link = screen.getByRole("link", { name: /site/ });

    expect(link).toHaveAttribute("href", "https://example.org/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("img", { name: "External link" }),
    ).toBeInTheDocument();
  });

  it("links mail addresses without a new tab", () => {
    renderMarkdown("[mail](mailto:a@example.org)");

    const link = screen.getByRole("link", { name: "mail" });

    expect(link).toHaveAttribute("href", "mailto:a@example.org");
    expect(link).not.toHaveAttribute("target");
  });

  it("renders Wiki links as marked in-app hotlinks", () => {
    renderMarkdown("[Idea](/wiki/ideas/one)");

    const link = screen.getByRole("link", { name: /Idea/ });

    expect(link).toHaveAttribute("href", "/wiki/ideas/one");
    expect(link).toHaveAttribute("data-link-kind", "wiki");
    expect(link).not.toHaveAttribute("target");
    expect(screen.getByRole("img", { name: "Wiki page" })).toBeInTheDocument();
  });

  it("treats same-origin links as in-app after mount", async () => {
    renderMarkdown(
      `[Same](${window.location.origin}/wiki/a) [Plain](/tasks/1)`,
    );

    const same = await screen.findByRole("link", { name: /Same/ });

    expect(same).toHaveAttribute("href", "/wiki/a");
    expect(same).toHaveAttribute("data-link-kind", "wiki");
    expect(screen.getByRole("link", { name: "Plain" })).toHaveAttribute(
      "data-link-kind",
      "internal",
    );
  });

  it("renders a link without target as plain text", () => {
    renderMarkdown("[ref][missing]\n\n[x]()");

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
