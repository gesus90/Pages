import { useState } from "react";

/** Whether a password field shows its text, and how to switch that. */
export interface PasswordVisibility {
  readonly isPasswordVisible: boolean;
  readonly togglePasswordVisibility: () => void;
}

/**
 * Keeps the visibility of a password field.
 *
 * @param passwordInputId - Id of the password input that keeps the focus.
 */
export function usePasswordVisibility(
  passwordInputId: string,
): PasswordVisibility {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  function togglePasswordVisibility(): void {
    setIsPasswordVisible((isVisible) => !isVisible);

    // Keep the focus inside the password field when toggling visibility.
    requestAnimationFrame(() => {
      const passwordInput = document.getElementById(passwordInputId);

      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.focus({ preventScroll: true });
      }
    });
  }

  return { isPasswordVisible, togglePasswordVisibility };
}
