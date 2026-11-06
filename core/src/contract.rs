//! Contract v1 between `pages-core` and `pages-api`.
//!
//! The authoritative description is `definition/PagesCoreContract.ts`; this
//! module mirrors it. Both sides refuse every other contract version, so a
//! changed contract needs a new version and a new path.

use serde::{Deserialize, Serialize};

/// The contract version both sides send and require.
pub const CONTRACT_VERSION: u32 = 1;
/// The API path of the decisions; the version is part of it.
pub const DECISIONS_PATH: &str = "/api/core/v1/live-decisions";
/// The API path of the status access decision (PAGE-238).
pub const STATUS_ACCESS_PATH: &str = "/api/core/v1/status-access";
/// The most sessions one request asks about.
pub const MAXIMUM_SESSIONS_PER_REQUEST: usize = 200;
/// The most events one request asks about.
pub const MAXIMUM_EVENTS_PER_REQUEST: usize = 256;
/// The longest cookie header passed on; a longer one is refused at the stream.
pub const MAXIMUM_COOKIE_LENGTH: usize = 8192;
/// The longest authorization fingerprint, notice kind or object id accepted.
pub const MAXIMUM_TEXT_LENGTH: usize = 200;
/// The session binding is a hex HMAC-SHA-256.
pub const BINDING_LENGTH: usize = 64;

/// Where a deleted ticket was visible; the API decides with it, it is never delivered.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventAudience {
    /// Project of the deleted ticket.
    pub project_id: String,
    /// Department of the deleted ticket, if it had one.
    pub department_id: Option<String>,
}

/// One committed row of `pages_event_outbox`: kind and object, never content.
#[derive(Clone, Serialize)]
pub struct OutboxEvent {
    /// Position in the outbox; visible in commit order.
    pub position: u64,
    /// The kind, such as `ticket.updated`; the core does not interpret it.
    pub kind: String,
    /// The object the event names.
    pub id: String,
    /// Set only where the outbox stored one.
    pub audience: Option<EventAudience>,
}

/// One browser session the API is asked about.
#[derive(Serialize)]
pub struct SessionQuery<'a> {
    /// Name of the session within this request.
    pub key: &'a str,
    /// The `Cookie` header the browser sent; the API reads its session from it.
    pub cookie: &'a str,
}

/// The body of `POST /api/core/v1/live-decisions`.
#[derive(Serialize)]
pub struct DecisionRequest<'a> {
    /// Always [`CONTRACT_VERSION`].
    pub contract: u32,
    /// At most [`MAXIMUM_SESSIONS_PER_REQUEST`] sessions.
    pub sessions: &'a [SessionQuery<'a>],
    /// At most [`MAXIMUM_EVENTS_PER_REQUEST`] events, oldest first.
    pub events: &'a [OutboxEvent],
}

/// The answer of the API.
#[derive(Deserialize)]
pub struct DecisionResponse {
    /// Must equal [`CONTRACT_VERSION`], or the whole answer is refused.
    pub contract: u32,
    /// One answer per asked session.
    pub sessions: Vec<SessionAnswer>,
}

/// What the API says about one session.
#[derive(Deserialize)]
#[serde(tag = "status")]
pub enum SessionAnswer {
    /// The session holds; the decisions name what it may learn.
    #[serde(rename = "active")]
    Active {
        /// The key of the query.
        key: String,
        /// The current authorization fingerprint of the account.
        version: String,
        /// A stable value of the session that names nobody; the cursors of its streams are bound to it.
        binding: String,
        /// One entry per event the account may learn about; hidden events are absent.
        decisions: Vec<Decision>,
    },
    /// The session ended or may not hold a stream; its streams close.
    #[serde(rename = "ended")]
    Ended {
        /// The key of the query.
        key: String,
    },
}

/// What one session receives for one event.
#[derive(Deserialize)]
#[serde(tag = "notice")]
pub enum Decision {
    /// A notice naming the object.
    #[serde(rename = "change")]
    Change {
        /// The position of the decided event.
        position: u64,
        /// What the browser learns: kind and id.
        change: Change,
    },
    /// The page reads everything again; the notice names nothing.
    #[serde(rename = "resync")]
    Resync {
        /// The position of the decided event.
        position: u64,
    },
}

/// The notice a browser receives, as in `definition/LiveChange.ts`.
#[derive(Clone, Serialize, Deserialize)]
pub struct Change {
    /// `ticket`, `milestone`, `wiki` or `project`; passed on unread.
    pub kind: String,
    /// The object that changed.
    pub id: String,
}

/// The body of `POST /api/core/v1/status-access` (PAGE-238).
#[derive(Serialize)]
pub struct StatusAccessRequest<'a> {
    /// Always [`CONTRACT_VERSION`].
    pub contract: u32,
    /// The `Cookie` header the browser sent; the API reads its session from it.
    pub cookie: &'a str,
}

/// Whether a session may read the detailed service status.
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StatusAccess {
    /// An active session in the active admin mode.
    Granted,
    /// Everyone else.
    Denied,
}

/// The answer of the API about the detailed service status.
#[derive(Deserialize)]
pub struct StatusAccessResponse {
    /// Must equal [`CONTRACT_VERSION`], or the answer is refused.
    pub contract: u32,
    /// The decision; any other value refuses the whole answer.
    pub access: StatusAccess,
}

/// The header with which the core proves itself to the Pica Mobile relay
/// listener of the API, as `Bearer <pagesCoreSecret>` (PAGE-239). It is not
/// `Authorization`, which the chat attachment requests of the app use.
pub const RELAY_SECRET_HEADER: &str = "x-pages-core-authorization";
/// The header naming the contract version of a relayed Pica Mobile request.
pub const RELAY_CONTRACT_HEADER: &str = "x-pages-core-contract";
/// The header with the address of the Pica Mobile client the core accepted.
pub const RELAY_CLIENT_HEADER: &str = "x-pages-core-client";
