import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import ProjectRoute from "@/app/routes/project";

it("renders an empty main region as the future project screen", () => {
  const { container } = render(<ProjectRoute />);

  expect(container.innerHTML).toBe("<main></main>");
});
