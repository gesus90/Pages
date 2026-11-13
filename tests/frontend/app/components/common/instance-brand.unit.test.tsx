import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { InstanceBrand } from "@/app/components/common/instance-brand";

it("omits empty branding and displays a centered logo and company name", () => {
  const { container, rerender } = render(
    <InstanceBrand branding={{ companyName: null, logoUrl: null }} />,
  );
  expect(container.innerHTML).toBe("");
  rerender(
    <InstanceBrand
      branding={{ companyName: "Acme", logoUrl: "/logo.png" }}
      isCentered
    />,
  );
  expect(screen.getByText("Acme").getAttribute("title")).toBe("Acme");
  expect(screen.getByRole("presentation").getAttribute("src")).toBe(
    "/logo.png",
  );
  expect(container.firstElementChild?.className).toContain("flex-col");
});

it("renders a logo without a name and a name without a logo", () => {
  const { rerender } = render(
    <InstanceBrand branding={{ companyName: null, logoUrl: "/logo.png" }} />,
  );
  expect(screen.getByRole("presentation")).toBeTruthy();
  rerender(<InstanceBrand branding={{ companyName: "Acme", logoUrl: null }} />);
  expect(screen.queryByRole("presentation")).toBeNull();
  expect(screen.getByText("Acme").className).toContain("truncate");
});
