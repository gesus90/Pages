//! The three WebSocket channels `pages-core` relays to `pages-api` (PAGE-239):
//! their paths, limits and the close code that tells a client to come back.
//!
//! The protocols themselves stay with the API and its clients
//! (`docs/PicaMobileWebSocket.md`, `docs/PagesRunner.md`, the console of
//! `definition/RemoteConsole.ts`); the core reads no frame of them.

use std::time::Duration;

/// The relayed channels; each one is switched over on its own.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Pica Mobile on its own port (`/pica-mobile`).
    Mobile,
    /// A Pages runner (`/runner/v1/channel/<connection>`).
    Runner,
    /// A console of a workspace, connection or runner setup.
    Console,
}

/// How the core watches a client that may have gone silently.
pub struct Heartbeat {
    /// A WebSocket ping goes to the client at this interval.
    pub interval: Duration,
    /// A client that sent nothing for this long is dropped without a closing handshake.
    pub silence: Duration,
}

/// The paths of the console channels below `/agents/workspaces/`, around one UUID.
const CONSOLE_PATHS: [(&str, &str); 3] = [
    ("/agents/workspaces/", "/console/socket"),
    ("/agents/workspaces/remote/connections/", "/console/socket"),
    ("/agents/workspaces/remote/connections/", "/setup/socket"),
];
const RUNNER_PREFIX: &str = "/runner/v1/channel/";

impl Channel {
    /// The channel of a path on the core's own port, which the entrance passes on.
    ///
    /// Pica Mobile is not among them: it has a port of its own.
    pub fn of_ingress_path(path: &str) -> Option<Self> {
        if path
            .strip_prefix(RUNNER_PREFIX)
            .is_some_and(is_runner_connection)
        {
            return Some(Self::Runner);
        }
        CONSOLE_PATHS
            .iter()
            .any(|(prefix, suffix)| {
                path.strip_prefix(prefix)
                    .and_then(|rest| rest.strip_suffix(suffix))
                    .is_some_and(is_uuid)
            })
            .then_some(Self::Console)
    }

    /// The name in log lines.
    pub fn name(self) -> &'static str {
        match self {
            Self::Mobile => "mobile",
            Self::Runner => "runner",
            Self::Console => "console",
        }
    }

    /// Connections held at once; the API has the same limit of its own.
    pub fn maximum_connections(self) -> usize {
        match self {
            Self::Mobile | Self::Console => 100,
            Self::Runner => 200,
        }
    }

    /// The largest client message; the API's limit, so the API decides what a frame below it means.
    pub fn maximum_client_message(self) -> usize {
        match self {
            // `chat_send` of `chat.v1`; every other frame is held to 16 KiB by the API.
            Self::Mobile => 128 * 1024,
            Self::Runner => 2 * 1024 * 1024,
            Self::Console => 64 * 1024,
        }
    }

    /// The close code a client receives when `pages-api` went away without closing.
    ///
    /// Each is the code after which the client's protocol reconnects on its
    /// own: Pica Mobile after 1001, a runner and a console after any code but
    /// their final ones (1008 for a runner packet, 4001 and 4003 for a console).
    pub fn api_lost_close(self) -> (u16, &'static str) {
        match self {
            Self::Mobile => (1001, "Pages is restarting"),
            Self::Runner | Self::Console => (1012, "Pages is restarting"),
        }
    }

    /// The core's own WebSocket pings, where the API pinged the client before.
    ///
    /// A runner sends its own heartbeat messages, which the core passes on, so
    /// the API keeps watching it.
    pub fn heartbeat(self) -> Option<Heartbeat> {
        match self {
            Self::Mobile => Some(Heartbeat {
                interval: Duration::from_secs(20),
                silence: Duration::from_secs(45),
            }),
            Self::Console => Some(Heartbeat {
                interval: Duration::from_secs(15),
                silence: Duration::from_secs(30),
            }),
            Self::Runner => None,
        }
    }
}

fn is_hex(text: &str) -> bool {
    text.bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A runner connection id as the API's pattern `[a-f0-9-]{36}` accepts it.
fn is_runner_connection(text: &str) -> bool {
    text.len() == 36
        && text
            .bytes()
            .all(|byte| byte == b'-' || byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A lowercase UUID, `8-4-4-4-12` hex digits.
fn is_uuid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(group, length)| group.len() == length && is_hex(group))
}
