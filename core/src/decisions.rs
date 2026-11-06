//! Asks `pages-api` who may learn about which event and who may read the
//! detailed service status, with a time limit.
//!
//! Every failure is closed: a timeout, a refused or malformed answer, an
//! unknown contract version or a missing session means "no decision", and the
//! caller delivers nothing for the affected sessions.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::header::{AUTHORIZATION, CONTENT_TYPE, HOST, HeaderValue};
use hyper::{Method, Request, StatusCode};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;

use crate::config::ApiOrigin;
use crate::contract::{
    BINDING_LENGTH, CONTRACT_VERSION, Change, DECISIONS_PATH, Decision, DecisionRequest,
    DecisionResponse, MAXIMUM_TEXT_LENGTH, OutboxEvent, STATUS_ACCESS_PATH, SessionAnswer,
    SessionQuery, StatusAccess, StatusAccessRequest, StatusAccessResponse,
};

/// The longest wait for one answer, connection included.
const DECISION_TIMEOUT: Duration = Duration::from_secs(3);
/// Larger answers are refused unread.
const MAXIMUM_ANSWER_BYTES: usize = 4 * 1024 * 1024;
/// A status access answer is a few bytes; a larger one is refused unread.
const MAXIMUM_ACCESS_ANSWER_BYTES: usize = 1024;

/// Why no decision arrived.
#[derive(Debug)]
pub enum DecisionError {
    /// The API did not answer in time.
    Timeout,
    /// The API could not be reached or the connection broke.
    Transport,
    /// The API answered with another status than 200.
    Status(u16),
    /// The answer did not follow contract v1.
    Contract(&'static str),
}

impl fmt::Display for DecisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => formatter.write_str("timeout"),
            Self::Transport => formatter.write_str("transport"),
            Self::Status(status) => write!(formatter, "status_{status}"),
            Self::Contract(reason) => write!(formatter, "contract_{reason}"),
        }
    }
}

/// What a session may learn, by event position.
pub enum SessionOutcome {
    /// The session holds.
    Active {
        /// The current authorization fingerprint.
        version: String,
        /// The session binding the cursors are sealed with.
        binding: String,
        /// Decided events; an absent position is hidden from the session.
        decisions: HashMap<u64, Notice>,
    },
    /// The session's streams close.
    Ended,
}

/// What one event means for one session.
pub enum Notice {
    /// A notice naming the object.
    Change(Change),
    /// The page reads everything again.
    Resync,
}

/// The client of the decision endpoint.
pub struct DecisionClient {
    client: Client<HttpConnector, Full<Bytes>>,
    api: ApiOrigin,
    authorization: HeaderValue,
}

impl DecisionClient {
    /// Creates the client; connections to the API are reused.
    ///
    /// # Errors
    ///
    /// Returns an error when the secret cannot be sent as a header value.
    pub fn new(api: ApiOrigin, secret: &str) -> Result<Self, hyper::header::InvalidHeaderValue> {
        let mut authorization = HeaderValue::from_str(&format!("Bearer {secret}"))?;
        authorization.set_sensitive(true);
        let mut connector = HttpConnector::new();
        connector.set_nodelay(true);
        connector.set_connect_timeout(Some(DECISION_TIMEOUT));
        Ok(Self {
            client: Client::builder(TokioExecutor::new()).build(connector),
            api,
            authorization,
        })
    }

    /// Asks for the decisions of some sessions about some events.
    ///
    /// # Errors
    ///
    /// Returns a [`DecisionError`] when no complete, valid answer arrived in time.
    pub async fn decide(
        &self,
        sessions: &[SessionQuery<'_>],
        events: &[OutboxEvent],
    ) -> Result<HashMap<String, SessionOutcome>, DecisionError> {
        let body = serde_json::to_vec(&DecisionRequest {
            contract: CONTRACT_VERSION,
            sessions,
            events,
        })
        .map_err(|_| DecisionError::Contract("request"))?;
        let answer = tokio::time::timeout(
            DECISION_TIMEOUT,
            self.post(DECISIONS_PATH, body, MAXIMUM_ANSWER_BYTES),
        )
        .await
        .map_err(|_| DecisionError::Timeout)??;
        let response: DecisionResponse =
            serde_json::from_slice(&answer).map_err(|_| DecisionError::Contract("shape"))?;
        validate(response, sessions, events)
    }

    /// Asks whether a browser session may read the detailed service status (PAGE-238).
    ///
    /// The answer is never kept: every detailed request asks again, so a
    /// revoked admin right or an ended session shows no details at once.
    ///
    /// # Errors
    ///
    /// Returns a [`DecisionError`] when no complete, valid answer arrived in time;
    /// the caller then shows no details.
    pub async fn status_access(&self, cookie: &str) -> Result<bool, DecisionError> {
        let body = serde_json::to_vec(&StatusAccessRequest {
            contract: CONTRACT_VERSION,
            cookie,
        })
        .map_err(|_| DecisionError::Contract("request"))?;
        let answer = tokio::time::timeout(
            DECISION_TIMEOUT,
            self.post(STATUS_ACCESS_PATH, body, MAXIMUM_ACCESS_ANSWER_BYTES),
        )
        .await
        .map_err(|_| DecisionError::Timeout)??;
        let response: StatusAccessResponse =
            serde_json::from_slice(&answer).map_err(|_| DecisionError::Contract("shape"))?;
        if response.contract != CONTRACT_VERSION {
            return Err(DecisionError::Contract("version"));
        }
        Ok(response.access == StatusAccess::Granted)
    }

    async fn post(
        &self,
        path: &str,
        body: Vec<u8>,
        maximum_bytes: usize,
    ) -> Result<Bytes, DecisionError> {
        let uri = format!("http://{}{path}", self.api.authority);
        let request = Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(HOST, self.api.authority.as_str())
            .header(AUTHORIZATION, self.authorization.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from(body)))
            .map_err(|_| DecisionError::Contract("request"))?;
        let response = self
            .client
            .request(request)
            .await
            .map_err(|_| DecisionError::Transport)?;
        if response.status() != StatusCode::OK {
            return Err(DecisionError::Status(response.status().as_u16()));
        }
        let collected = Limited::new(response.into_body(), maximum_bytes)
            .collect()
            .await
            .map_err(|_| DecisionError::Transport)?;
        Ok(collected.to_bytes())
    }
}

fn is_short_text(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAXIMUM_TEXT_LENGTH
}

fn read_decisions(
    decisions: Vec<Decision>,
    positions: &HashSet<u64>,
) -> Result<HashMap<u64, Notice>, DecisionError> {
    let mut notices = HashMap::with_capacity(decisions.len());
    for decision in decisions {
        let (position, notice) = match decision {
            Decision::Change { position, change } => {
                if !is_short_text(&change.kind) || !is_short_text(&change.id) {
                    return Err(DecisionError::Contract("change"));
                }
                (position, Notice::Change(change))
            }
            Decision::Resync { position } => (position, Notice::Resync),
        };
        if !positions.contains(&position) || notices.insert(position, notice).is_some() {
            return Err(DecisionError::Contract("position"));
        }
    }
    Ok(notices)
}

/// Accepts only an answer that decides exactly the asked sessions about asked events.
fn validate(
    response: DecisionResponse,
    sessions: &[SessionQuery<'_>],
    events: &[OutboxEvent],
) -> Result<HashMap<String, SessionOutcome>, DecisionError> {
    if response.contract != CONTRACT_VERSION {
        return Err(DecisionError::Contract("version"));
    }
    let asked: HashSet<&str> = sessions.iter().map(|session| session.key).collect();
    let positions: HashSet<u64> = events.iter().map(|event| event.position).collect();
    let mut outcomes = HashMap::with_capacity(response.sessions.len());
    for answer in response.sessions {
        let (key, outcome) = match answer {
            SessionAnswer::Ended { key } => (key, SessionOutcome::Ended),
            SessionAnswer::Active {
                key,
                version,
                binding,
                decisions,
            } => {
                if version.len() > MAXIMUM_TEXT_LENGTH {
                    return Err(DecisionError::Contract("version_length"));
                }
                if binding.len() != BINDING_LENGTH
                    || !binding.bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    return Err(DecisionError::Contract("binding"));
                }
                let decisions = read_decisions(decisions, &positions)?;
                (
                    key,
                    SessionOutcome::Active {
                        version,
                        binding,
                        decisions,
                    },
                )
            }
        };
        if !asked.contains(key.as_str()) || outcomes.insert(key, outcome).is_some() {
            return Err(DecisionError::Contract("session"));
        }
    }
    if outcomes.len() != asked.len() {
        return Err(DecisionError::Contract("missing_session"));
    }
    Ok(outcomes)
}
