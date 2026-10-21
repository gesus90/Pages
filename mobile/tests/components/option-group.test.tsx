import { fireEvent } from "@testing-library/react-native";

import { OptionGroup } from "@/components/option-group";

import { renderWithProviders } from "../render-with-providers";

describe("OptionGroup", () => {
  it("marks the selected option and reports a change", async () => {
    const onChange = jest.fn();
    const screen = renderWithProviders(
      <OptionGroup
        label="Theme"
        onChange={onChange}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        value="light"
      />,
    );

    // The check mark of the selected option loads its icon font asynchronously.
    expect(
      await screen.findByRole("radio", { name: "Light", checked: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Dark", checked: false }),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("radio", { name: "Dark" }));

    expect(onChange).toHaveBeenCalledWith("dark");
  });
});
