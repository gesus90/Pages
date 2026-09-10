// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { DashboardPanel } from "@/app/components/dashboard/dashboard-panel";

function renderPanel(jsx: React.ReactElement): void {
  render(<MemoryRouter>{jsx}</MemoryRouter>);
}

describe("DashboardPanel", () => {
  it("renders the title with the matching id and labelled region", () => {
    renderPanel(
      <DashboardPanel title="My tasks" titleId="panel-my-tasks">
        <p>Body</p>
      </DashboardPanel>,
    );

    const heading = screen.getByRole("heading", { level: 2 });

    expect(heading).toHaveTextContent("My tasks");
    expect(heading).toHaveAttribute("id", "panel-my-tasks");

    const region = heading.closest("section");

    expect(region).toHaveAttribute("aria-labelledby", "panel-my-tasks");
  });

  it("renders the body content inside the panel", () => {
    renderPanel(
      <DashboardPanel title="My tasks" titleId="panel-my-tasks">
        <p>Body</p>
      </DashboardPanel>,
    );

    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("renders the optional link", () => {
    renderPanel(
      <DashboardPanel
        linkLabel="All tasks"
        linkTo="/tasks"
        title="My tasks"
        titleId="panel-my-tasks"
      >
        <p>Body</p>
      </DashboardPanel>,
    );

    const link = screen.getByRole("link", { name: "All tasks" });

    expect(link).toHaveAttribute("href", "/tasks");
  });

  it("omits the link when only one of linkLabel or linkTo is provided", () => {
    const { rerender } = render(
      <MemoryRouter>
        <DashboardPanel linkLabel="Only label" title="My tasks" titleId="panel">
          <p>Body</p>
        </DashboardPanel>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <DashboardPanel linkTo="/tasks" title="My tasks" titleId="panel-2">
          <p>Body</p>
        </DashboardPanel>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("applies the optional className to the section", () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardPanel
          className="extra-class"
          title="My tasks"
          titleId="panel"
        >
          <p>Body</p>
        </DashboardPanel>
      </MemoryRouter>,
    );

    const section = container.querySelector("section");

    expect(section?.className).toContain("extra-class");
  });
});
