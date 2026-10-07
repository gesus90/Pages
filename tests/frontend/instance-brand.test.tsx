// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InstanceBrand } from "@/app/components/common/instance-brand";

describe("InstanceBrand", () => {
  it("renders nothing for an instance without name and logo", () => {
    const { container } = render(
      <InstanceBrand branding={{ companyName: null, logoUrl: null }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the name when there is no logo", () => {
    const { container } = render(
      <InstanceBrand
        branding={{ companyName: "Muster GmbH", logoUrl: null }}
      />,
    );

    expect(screen.getByText("Muster GmbH")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows logo and name, the logo being decorative next to the name", () => {
    const { container } = render(
      <InstanceBrand
        branding={{ companyName: "Muster GmbH", logoUrl: "/instance-logo?v=1" }}
      />,
    );
    const logo = container.querySelector("img");

    expect(logo).toHaveAttribute("src", "/instance-logo?v=1");
    expect(logo).toHaveAttribute("alt", "");
  });

  it("stacks and enlarges both on the login page", () => {
    const { container } = render(
      <InstanceBrand
        branding={{ companyName: "Muster GmbH", logoUrl: "/instance-logo?v=1" }}
        className="mb-6"
        isCentered
      />,
    );

    expect(container.firstElementChild).toHaveClass("flex-col", "mb-6");
  });

  it("shows only the logo when the name is missing", () => {
    const { container } = render(
      <InstanceBrand
        branding={{ companyName: null, logoUrl: "/instance-logo?v=1" }}
      />,
    );

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("span")).toBeNull();
  });
});
