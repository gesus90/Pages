const MESSAGES = {
  de: {
    heading: "Pages-MCP-Pairing mit",
    link: "Link",
    code: "Code",
    instructions:
      "Öffnen Sie den Link, melden Sie sich an, vergleichen Sie den Code und bestätigen Sie die Verbindung ausdrücklich.",
    fallback:
      "Öffnen Sie den Link auf einem Gerät mit Browser oder geben Sie den Code auf dieser Pages-Seite ein:",
    waiting: "Warten auf Bestätigung …",
    opened: "Browser geöffnet.",
    expires: "Gültig bis",
    cancelHint: "Abbrechen mit Strg+C.",
    connected: "Verbunden als",
    saved: "Zugang gespeichert",
    configuration: "Im MCP-Client genügt jetzt PAGES_URL=",
    denied: "Pairing abgelehnt. Es wurde kein Zugang erteilt.",
    expired: "Der Code ist abgelaufen. Starten Sie das Pairing neu.",
    cancelled: "Pairing abgebrochen.",
    wrong: "Hier antwortet keine Pages-Instanz. Prüfen Sie Adresse und Port.",
    failed:
      "Pairing fehlgeschlagen. Prüfen Sie die Adresse und starten Sie pair erneut.",
    handoff:
      "Die Übergabe ist fehlgeschlagen. Widerrufen Sie den ungenutzten Eintrag unter Einstellungen › Verbindungen und koppeln Sie neu.",
    network: "Pages ist nicht erreichbar. Neuer Versuch in",
    seconds: "s …",
    remaining: "Verbleibende Zeit in Sekunden:",
    unlimited: "unbegrenzt",
    paired: "Gekoppelt mit",
    unpaired: "Nicht gekoppelt. Starten Sie pair.",
    rotated: "Zugang erneuert.",
    removed: "Verbindung widerrufen und lokal entfernt.",
    offlineRemoved:
      "Lokal entfernt. Widerrufen Sie die Verbindung zusätzlich unter Einstellungen › Verbindungen.",
  },
  en: {
    heading: "Pages MCP pairing with",
    link: "Link",
    code: "Code",
    instructions:
      "Open the link, sign in, compare the code and explicitly approve the connection.",
    fallback:
      "Open the link on a device with a browser or enter the code on this Pages page:",
    waiting: "Waiting for confirmation …",
    opened: "Browser opened.",
    expires: "Valid until",
    cancelHint: "Cancel with Ctrl+C.",
    connected: "Connected as",
    saved: "Access saved",
    configuration: "In the MCP client, only PAGES_URL is needed: ",
    denied: "Pairing denied. No access was granted.",
    expired: "The code has expired. Start pairing again.",
    cancelled: "Pairing cancelled.",
    wrong:
      "This address does not respond as a Pages instance. Check address and port.",
    failed: "Pairing failed. Check the address and run pair again.",
    handoff:
      "The handoff failed. Revoke the unused entry under Settings › Connections and pair again.",
    network: "Pages is unavailable. Retrying in",
    seconds: "s …",
    remaining: "Remaining time in seconds:",
    unlimited: "unlimited",
    paired: "Paired with",
    unpaired: "Not paired. Run pair first.",
    rotated: "Access renewed.",
    removed: "Connection revoked and removed locally.",
    offlineRemoved:
      "Removed locally. Also revoke the connection under Settings › Connections.",
  },
} as const;

/** Chooses terminal messages by POSIX locale precedence; no input or credential is reflected. */
export function credentialMessages(
  environment: Readonly<Record<string, string | undefined>>,
): typeof MESSAGES.de | typeof MESSAGES.en {
  const locale =
    [environment.LC_ALL, environment.LC_MESSAGES, environment.LANG].find(
      (candidate) => Boolean(candidate),
    ) ?? "";
  return locale.toLowerCase().startsWith("de") ? MESSAGES.de : MESSAGES.en;
}
