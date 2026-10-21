import { fireEvent } from "@testing-library/react-native";

import { EmptySessionState } from "@/components/empty-session-state";

import { renderWithProviders } from "../render-with-providers";

describe("EmptySessionState", () => {
  it("explains the empty view and offers the server setup while none is configured", () => {
    const onSetUpServer = jest.fn();
    const screen = renderWithProviders(
      <EmptySessionState
        host={null}
        onSetUpServer={onSetUpServer}
        status="unconfigured"
      />,
    );

    expect(screen.getByText("No conversation yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Chatting with Pica is not part of this version of the app yet.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Enter the address of your Pages server."),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Set up server" }));

    expect(onSetUpServer).toHaveBeenCalledTimes(1);
  });

  it("says which server answers and offers no setup button", () => {
    const screen = renderWithProviders(
      <EmptySessionState
        host="pages.example.com"
        onSetUpServer={jest.fn()}
        status="connected"
      />,
    );

    expect(screen.getByText("pages.example.com answers.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no message that could pass for an answer", () => {
    const screen = renderWithProviders(
      <EmptySessionState
        host={null}
        onSetUpServer={jest.fn()}
        status="offline"
      />,
      { language: "de" },
    );

    expect(screen.getByText("Noch keine Unterhaltung")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
