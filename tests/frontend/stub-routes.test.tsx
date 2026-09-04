import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ProjectRoute from "@/app/routes/project";
import ProjectsRoute from "@/app/routes/projects";
import SettingsRoute from "@/app/routes/settings";
import TasksRoute from "@/app/routes/tasks";
import WikiRoute from "@/app/routes/wiki";

describe("future route boundaries", () => {
  it("renders an empty settings shell", () => {
    const { container } = render(<SettingsRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders an empty projects shell", () => {
    const { container } = render(<ProjectsRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders an empty project shell", () => {
    const { container } = render(<ProjectRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders an empty tasks shell", () => {
    const { container } = render(<TasksRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });

  it("renders an empty wiki shell", () => {
    const { container } = render(<WikiRoute />);

    expect(container.querySelector("main")).not.toBeNull();
  });
});
