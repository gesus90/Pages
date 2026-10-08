// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderWiki(source: string): HTMLElement {
  return render(
    <I18nextProvider i18n={createI18n(LANGUAGE.ENGLISH)}>
      <MemoryRouter>
        <WikiMarkdown source={source} />
      </MemoryRouter>
    </I18nextProvider>,
  ).container;
}

describe("WikiMarkdown", () => {
  it("lets the person select the page text, which comments rely on", () => {
    expect(renderWiki("Some text").firstElementChild).toHaveClass(
      "pages-selectable",
    );
  });

  it("gives headings anchors and builds a table of contents", () => {
    const container = renderWiki(
      ["[toc]", "", "# One", "", "## Two", "", "### Three", "", "# One"].join(
        "\n",
      ),
    );

    expect(container.querySelector("h1")?.id).toBe("one");
    expect(container.querySelector("h2")?.id).toBe("two");
    expect(container.querySelector("h3")?.id).toBe("three");
    expect(container.querySelectorAll("h1")[1]?.id).toBe("one-1");
    expect(container.querySelector("nav")?.querySelectorAll("a")).toHaveLength(
      4,
    );
  });

  it("renders callouts for known kinds and keeps other quotes", () => {
    const container = renderWiki(
      [
        "> [!WARNING]",
        "> Careful",
        "",
        "> [!NOTE] Same line",
        "",
        "> [!FOO]",
        "> Plain",
        "",
        "> normal quote",
      ].join("\n"),
    );

    expect(screen.getAllByRole("note")).toHaveLength(2);
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(container.textContent).toContain("[!FOO]");
  });

  it("renders every callout kind with its own style", () => {
    renderWiki(
      ["note", "tip", "important", "warning", "caution"]
        .map((kind) => `> [!${kind.toUpperCase()}]\n> ${kind}`)
        .join("\n\n"),
    );

    expect(screen.getAllByRole("note")).toHaveLength(5);
  });

  it("renders a collapsible block", () => {
    const container = renderWiki("> [!TOGGLE] Details\n> Hidden text");

    expect(container.querySelector("details summary")?.textContent).toBe(
      "Details",
    );
    expect(container.querySelector("details")?.textContent).toContain(
      "Hidden text",
    );
  });

  it("renders a collapsible block whose body starts below the title", () => {
    const container = renderWiki("> [!TOGGLE] Title");

    expect(container.querySelector("summary")?.textContent).toBe("Title");
  });

  it("shows attachment images and drops every other image", () => {
    const container = renderWiki(
      "![ok](/wiki/attachments/abc-123) ![bad](https://example.com/x.png) ![none](/other.png)",
    );

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("ok");
  });

  it("shows raw HTML as text", () => {
    const container = renderWiki("<script>alert(1)</script>");

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("renders a heading without an anchor when the line is unknown", () => {
    const container = renderWiki("Title\n=====");

    expect(container.querySelector("h1")?.id).toBe("");
  });
});
