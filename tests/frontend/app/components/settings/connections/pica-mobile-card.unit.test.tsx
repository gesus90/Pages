import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PicaMobileCard } from "@/app/components/settings/connections/pica-mobile-card";
import { showSuccessToast } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

import type { PicaMobileSettingsView } from "@/definition/PicaMobile";

interface FetcherState {
  data: unknown;
  state: "idle" | "submitting";
  submit: ReturnType<typeof vi.fn>;
}

const fetcher = vi.hoisted((): FetcherState => ({
  data: undefined,
  state: "idle",
  submit: vi.fn(),
}));

vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
vi.mock("@/app/components/ui/toast", () => ({ showSuccessToast: vi.fn() }));

const german = createI18n("de");
const english = createI18n("en");

const FRESH: PicaMobileSettingsView = {
  port: null,
  isListening: false,
  listenError: null,
  host: "192.168.0.52",
};
const RUNNING: PicaMobileSettingsView = {
  port: 3001,
  isListening: true,
  listenError: null,
  host: "192.168.0.52",
};

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
  vi.mocked(showSuccessToast).mockReset();
});

function renderCard(
  settings: PicaMobileSettingsView,
  language = german,
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={language}>
      <PicaMobileCard settings={settings} />
    </I18nextProvider>,
  );
}

function portField(): HTMLInputElement {
  const field = screen.getByLabelText("WebSocket-Port");

  if (!(field instanceof HTMLInputElement)) {
    throw new Error("The port field is no input.");
  }

  return field;
}

function typePort(text: string): void {
  fireEvent.change(portField(), { target: { value: text } });
}

function saveButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: "Speichern" });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("The save button is no button.");
  }

  return button;
}

function addressText(): string {
  const field = screen.getByLabelText("Verbindungsadresse");

  if (!(field instanceof HTMLInputElement)) {
    throw new Error("The address field is no input.");
  }

  return field.value;
}

describe("the design brief", () => {
  it("shows the card with its title, subtitle and administrator badge", () => {
    renderCard(FRESH);

    expect(screen.getByRole("heading", { name: "Pica Mobile" })).toBeTruthy();
    expect(screen.getByText("Verbinde Pica Mobile mit Pages.")).toBeTruthy();
    expect(screen.getByText("Nur Administratoren")).toBeTruthy();
  });

  it("names the fields without star or range hint and explains the address", () => {
    const { container } = renderCard(FRESH);

    expect(screen.getByText("WebSocket-Port").textContent).toBe(
      "WebSocket-Port",
    );
    expect(screen.getByText("Verbindungsadresse")).toBeTruthy();
    expect(screen.getByText("Diese Adresse in der App eingeben.")).toBeTruthy();
    expect(container.textContent).not.toContain("*");
    expect(container.textContent).not.toMatch(/65535|TLS|Layoutvorschau/u);
  });

  it("puts a smartphone icon in front of the title", () => {
    const { container } = renderCard(FRESH);

    expect(container.querySelector("svg.lucide-smartphone")).not.toBeNull();
  });

  it("has an English wording as well", () => {
    renderCard(RUNNING, english);

    expect(screen.getByText("Connect Pica Mobile to Pages.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("the address", () => {
  it("is a read-only field, so it can only be copied", () => {
    renderCard(RUNNING);

    expect(
      screen.getByLabelText("Verbindungsadresse").hasAttribute("readonly"),
    ).toBe(true);
  });

  it("is empty until a valid port is typed", () => {
    renderCard(FRESH);

    expect(addressText()).toBe("");
    typePort("3001");
    expect(addressText()).toBe("ws://192.168.0.52:3001/pica-mobile");
  });

  it("shows the stored address at once", () => {
    renderCard(RUNNING);

    expect(addressText()).toBe("ws://192.168.0.52:3001/pica-mobile");
  });

  it("brackets an IPv6 host", () => {
    renderCard({ ...RUNNING, host: "fd00::5" });

    expect(addressText()).toBe("ws://[fd00::5]:3001/pica-mobile");
  });

  it("says why there is no address when the server has no network address", () => {
    renderCard({ ...RUNNING, host: null });

    expect(addressText()).toBe("");
    expect(screen.queryByText("Diese Adresse in der App eingeben.")).toBeNull();
    expect(screen.getByText(/Netzwerkadresse dieses Servers/u)).toBeTruthy();
  });
});

describe("validation", () => {
  it.each(["abc", "0", "65536", "-5", "30.5", "3 0"])(
    "refuses to save the input %j and says what is expected",
    (text) => {
      renderCard(RUNNING);
      typePort(text);

      expect(saveButton().disabled).toBe(true);
      expect(screen.getByRole("alert").textContent).toBe(
        "Gib eine ganze Zahl von 1 bis 65535 ein.",
      );
      expect(addressText()).toBe("");
      fireEvent.submit(saveButton());
      expect(fetcher.submit).not.toHaveBeenCalled();
    },
  );

  it("does not scold an empty field but cannot save it", () => {
    renderCard(FRESH);

    expect(saveButton().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("saves only a changed port, or any port while the endpoint is not listening", () => {
    const { unmount } = renderCard(RUNNING);

    expect(saveButton().disabled).toBe(true);
    typePort("3002");
    expect(saveButton().disabled).toBe(false);
    unmount();

    renderCard({ ...RUNNING, isListening: false, listenError: "portInUse" });
    expect(saveButton().disabled).toBe(false);
  });

  it.each(["1", "65535", " 3001 "])("accepts %j", (text) => {
    renderCard(FRESH);
    typePort(text);

    expect(saveButton().disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("");
  });
});

describe("saving", () => {
  it("posts the intent and the port as one form", () => {
    renderCard(FRESH);
    typePort(" 3001 ");
    fireEvent.click(saveButton());

    const form: unknown = fetcher.submit.mock.calls[0]?.[0];

    expect(form).toBeInstanceOf(FormData);
    expect(Object.fromEntries(form instanceof FormData ? form : [])).toEqual({
      intent: "update-pica-mobile-port",
      port: "3001",
    });
    expect(fetcher.submit.mock.calls[0]?.[1]).toEqual({ method: "post" });
  });

  it("disables the form while the request runs", () => {
    fetcher.state = "submitting";
    renderCard(FRESH);

    expect(saveButton().disabled).toBe(true);
    expect(portField().disabled).toBe(true);
  });

  it("confirms a stored port once", () => {
    const { rerender } = renderCard(FRESH);
    const wrap = (settings: PicaMobileSettingsView): React.ReactElement => (
      <I18nextProvider i18n={german}>
        <PicaMobileCard settings={settings} />
      </I18nextProvider>
    );

    typePort("3001");
    fireEvent.click(saveButton());
    fetcher.state = "submitting";
    rerender(wrap(FRESH));
    fetcher.state = "idle";
    fetcher.data = { picaMobile: { ok: true, port: 3001 } };
    rerender(wrap(RUNNING));
    rerender(wrap(RUNNING));

    expect(showSuccessToast).toHaveBeenCalledExactlyOnceWith(
      "Pica Mobile gespeichert.",
    );
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it.each([
    ["portInUse", "Port 3001 ist bereits belegt. Wähle einen anderen Port."],
    ["portOfPages", "Port 3001 nutzt Pages selbst. Wähle einen anderen Port."],
    [
      "permissionDenied",
      "Port 3001 erfordert höhere Rechte. Wähle einen Port ab 1024.",
    ],
    [
      "listenFailed",
      "Auf Port 3001 kann Pages nicht lauschen. Wähle einen anderen Port.",
    ],
    [
      "general",
      "Der Port konnte nicht gespeichert werden. Versuche es erneut.",
    ],
  ])("explains the refusal %s next to the field", (error, message) => {
    const { rerender } = renderCard(FRESH);

    typePort("3001");
    fireEvent.click(saveButton());
    fetcher.data = { picaMobile: { ok: false, error } };
    rerender(
      <I18nextProvider i18n={german}>
        <PicaMobileCard settings={FRESH} />
      </I18nextProvider>,
    );

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(portField().getAttribute("aria-invalid")).toBe("true");
    expect(showSuccessToast).not.toHaveBeenCalled();

    typePort("3002");
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("reports a refused request as a general failure", () => {
    const { rerender } = renderCard(FRESH);

    typePort("3001");
    fireEvent.click(saveButton());
    fetcher.data = { error: "access_denied" };
    rerender(
      <I18nextProvider i18n={german}>
        <PicaMobileCard settings={FRESH} />
      </I18nextProvider>,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Der Port konnte nicht gespeichert werden. Versuche es erneut.",
    );
  });
});

describe("an endpoint that is not listening", () => {
  it("says so with the reason", () => {
    renderCard({
      port: 3001,
      isListening: false,
      listenError: "portInUse",
      host: "192.168.0.52",
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Der Endpunkt ist derzeit nicht aktiv. Port 3001 ist bereits belegt. Wähle einen anderen Port.",
    );
  });

  it("stays quiet while the endpoint listens", () => {
    renderCard(RUNNING);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not repeat itself while a typed port is wrong", () => {
    renderCard({
      port: 3001,
      isListening: false,
      listenError: "portInUse",
      host: "192.168.0.52",
    });
    act(() => typePort("abc"));

    expect(screen.queryByRole("status")).toBeNull();
  });
});
