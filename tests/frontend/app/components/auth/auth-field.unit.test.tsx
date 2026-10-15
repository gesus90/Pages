import { act, fireEvent, render, screen } from "@testing-library/react";
import { KeyRound } from "lucide-react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AuthField } from "@/app/components/auth/auth-field";
import { PasswordVisibilityToggle } from "@/app/components/auth/password-visibility-toggle";
import { usePasswordVisibility } from "@/app/components/auth/use-password-visibility";
import { createI18n } from "@/app/lib/i18n";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("connects the label, rejection and extra description to the input", () => {
  render(
    <AuthField
      name="account"
      label="Account"
      icon={KeyRound}
      error="Account is required"
      describedBy="account-hint"
      required
      autoComplete="username"
    />,
  );
  const input = screen.getByRole("textbox", { name: "Account" });
  expect(input.getAttribute("name")).toBe("account");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(
    "account-error account-hint",
  );
  expect(screen.getByText("Account is required").id).toBe("account-error");
  expect(input).toHaveProperty("required", true);
  expect(input.getAttribute("autocomplete")).toBe("username");
});

it("removes obsolete error associations after correction", () => {
  const { rerender } = render(
    <AuthField
      name="account"
      label="Account"
      icon={KeyRound}
      error="Required"
    />,
  );
  rerender(<AuthField name="account" label="Account" icon={KeyRound} />);
  expect(screen.queryByText("Required")).toBeNull();
  const input = screen.getByRole("textbox");
  expect(input.getAttribute("aria-invalid")).toBeNull();
  expect(input.getAttribute("aria-describedby")).toBeNull();
});

function PasswordField(): React.ReactElement {
  const visibility = usePasswordVisibility("password");
  return (
    <AuthField
      name="password"
      label="Password"
      icon={KeyRound}
      type={visibility.isPasswordVisible ? "text" : "password"}
    >
      <PasswordVisibilityToggle
        isPasswordVisible={visibility.isPasswordVisible}
        onToggle={visibility.togglePasswordVisibility}
      />
    </AuthField>
  );
}

it("toggles visibility twice, preserves text and returns focus to the input", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <PasswordField />
    </I18nextProvider>,
  );
  const input = screen.getByLabelText("Password");
  fireEvent.change(input, { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  act(() => {
    vi.advanceTimersByTime(20);
  });
  expect(input).toHaveProperty("type", "text");
  expect(input).toHaveProperty("value", "synthetic-password");
  expect(document.activeElement).toBe(input);
  expect(
    screen
      .getByRole("button", { name: "Hide password" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  act(() => {
    vi.advanceTimersByTime(20);
  });
  expect(input).toHaveProperty("type", "password");
  expect(input).toHaveProperty("value", "synthetic-password");
});
