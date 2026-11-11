import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ChoiceRow,
  FieldSelect,
  FieldValue,
  FormField,
} from "@/app/components/automations/automation-form-controls";

const options = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
];

it("connects field labels and hints and marks invalid values", () => {
  render(
    <>
      <FormField label="Name" htmlFor="name" hint="Required">
        <input id="name" />
      </FormField>
      <FieldValue isInvalid>Invalid</FieldValue>
    </>,
  );
  expect(screen.getByLabelText("Name")).toBeInstanceOf(HTMLInputElement);
  expect(screen.getByText("Required")).toBeTruthy();
  expect(screen.getByText("Invalid").className).toContain("border-destructive");
});

it("reports choices and prevents changes in read-only mode", () => {
  const onChange = vi.fn();
  const view = render(
    <ChoiceRow
      label="Mode"
      value="one"
      options={options}
      onChange={onChange}
      isReadOnly={false}
    />,
  );
  expect(
    screen.getByRole("button", { name: "One" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Two" }));
  expect(onChange).toHaveBeenCalledWith("two");
  view.rerender(
    <ChoiceRow
      label="Mode"
      value="two"
      options={options}
      onChange={onChange}
      isReadOnly
    />,
  );
  expect(
    screen.getByRole("button", { name: "Two" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "One" }));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("labels the select and exposes its read-only state", () => {
  const onChange = vi.fn();
  const view = render(
    <FieldSelect
      label="Choice"
      value="one"
      options={options}
      onChange={onChange}
      isReadOnly={false}
    />,
  );
  expect(screen.getByLabelText("Choice")).toBeTruthy();
  view.rerender(
    <FieldSelect
      label="Choice"
      value="one"
      options={options}
      onChange={onChange}
      isReadOnly
    />,
  );
  expect(screen.getByLabelText("Choice").hasAttribute("disabled")).toBe(true);
});
