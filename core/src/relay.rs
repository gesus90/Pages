//! The handshake of a relayed WebSocket (PAGE-239): the client's upgrade is
//! answered only after `pages-api` accepted the same upgrade.
//!
//! The API keeps every decision: a runner's credential, a console's session
//! cookie and origin, a Pica Mobile login. The core repeats the client's
//! handshake to the API with the headers that carry them and passes the
//! API's refusal back with its status. While the API cannot be reached, the
//! handshake is refused with `502`, so no connection is ever open that the
//! API has not admitted.

use std::net::IpAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::header::{
    CACHE_CONTROL, CONNECTION, CONTENT_TYPE, HOST, HeaderMap, HeaderName, HeaderValue,
    SEC_WEBSOCKET_ACCEPT, SEC_WEBSOCKET_KEY, SEC_WEBSOCKET_PROTOCOL, SEC_WEBSOCKET_VERSION,
    UPGRADE,
};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Error as SocketError;
use tokio_tungstenite::tungstenite::handshake::client::generate_key;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::{Role, WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

use crate::channel::Channel;
use crate::contract::{
    CONTRACT_VERSION, RELAY_CLIENT_HEADER, RELAY_CONTRACT_HEADER, RELAY_SECRET_HEADER,
};
use crate::log::{self, Severity};
use crate::pump::{self, Pump};

/// The longest wait for the API to accept an upgrade, connection included.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// The longest wait for the TCP connection to the API.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// The largest message of the API the core holds; far above every protocol's own.
const MAXIMUM_API_MESSAGE: usize = 16 * 1024 * 1024;
/// One notice per interval, so a peer that keeps failing cannot flood the log.
const NOTICE_INTERVAL_MILLISECONDS: u64 = 30_000;
/// The client headers the API decides with; every other header stays at the core.
const PASSED_HEADERS: [&str; 4] = ["origin", "cookie", "user-agent", "sec-websocket-protocol"];
/// What the entrance reports about the browser; only it may set these.
const ENTRANCE_HEADERS: [&str; 2] = ["x-forwarded-for", "x-forwarded-proto"];

/// What all relayed connections share: their counts, the stop signal and the secret.
pub struct RelayHub {
    counts: [AtomicUsize; 3],
    next_connection: AtomicU64,
    last_notice: AtomicU64,
    stopping: watch::Sender<bool>,
    secret: HeaderValue,
}

/// One held place in a channel's limit; dropping it frees the place.
pub struct Slot {
    hub: Arc<RelayHub>,
    channel: Channel,
    /// The connection's number in log lines.
    pub connection: u64,
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.hub.counts[index(self.channel)].fetch_sub(1, Ordering::AcqRel);
    }
}

/// Where one upgrade goes.
pub struct Route {
    /// The channel the upgrade belongs to.
    pub channel: Channel,
    /// `host:port` of the API listener that serves it.
    pub authority: String,
    /// The client's address, set for Pica Mobile only: its relay listener
    /// takes the address from the core, for its login limit per address.
    pub client: Option<IpAddr>,
    /// Becomes `true` when the listener of the connection closes; the
    /// core's own port has none, it closes only when the core stops.
    pub closing: Option<watch::Receiver<bool>>,
}

fn index(channel: Channel) -> usize {
    match channel {
        Channel::Mobile => 0,
        Channel::Runner => 1,
        Channel::Console => 2,
    }
}

fn milliseconds_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

impl RelayHub {
    /// Creates the hub.
    ///
    /// # Errors
    ///
    /// Returns an error when the secret cannot be sent as a header value.
    pub fn new(secret: &str) -> Result<Self, hyper::header::InvalidHeaderValue> {
        let mut value = HeaderValue::from_str(&format!("Bearer {secret}"))?;
        value.set_sensitive(true);
        let (stopping, _) = watch::channel(false);
        Ok(Self {
            counts: [
                AtomicUsize::new(0),
                AtomicUsize::new(0),
                AtomicUsize::new(0),
            ],
            next_connection: AtomicU64::new(1),
            last_notice: AtomicU64::new(0),
            stopping,
            secret: value,
        })
    }

    /// Tells every relayed connection that the core stops.
    pub fn stop(&self) {
        self.stopping.send_replace(true);
    }

    /// Whether no relayed connection is open any more.
    pub fn is_idle(&self) -> bool {
        self.counts
            .iter()
            .all(|count| count.load(Ordering::Acquire) == 0)
    }

    fn reserve(self: &Arc<Self>, channel: Channel) -> Option<Slot> {
        let count = &self.counts[index(channel)];
        let reserved = count.fetch_add(1, Ordering::AcqRel);
        let slot = Slot {
            hub: Arc::clone(self),
            channel,
            connection: self.next_connection.fetch_add(1, Ordering::Relaxed),
        };
        // Dropping the slot gives the place back.
        (reserved < channel.maximum_connections()).then_some(slot)
    }

    /// Writes a warning at most once per interval.
    fn notice(&self, event: &str, message: &str, metadata: serde_json::Value) {
        let now = milliseconds_now();
        let last = self.last_notice.load(Ordering::Relaxed);
        if now.saturating_sub(last) < NOTICE_INTERVAL_MILLISECONDS
            || self
                .last_notice
                .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
        {
            return;
        }
        log::record(Severity::Warn, event, message, metadata);
    }
}

/// An answer without a body that ends the connection.
pub fn refusal(status: StatusCode, text: &'static str) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from_static(text.as_bytes())));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(CONNECTION, HeaderValue::from_static("close"));
    response
}

fn has_token(headers: &HeaderMap, name: HeaderName, token: &str) -> bool {
    headers.get_all(name).iter().any(|value| {
        value.to_str().is_ok_and(|text| {
            text.split(',')
                .any(|item| item.trim().eq_ignore_ascii_case(token))
        })
    })
}

/// Whether a request asks for a WebSocket.
pub fn is_upgrade(request: &Request<Incoming>) -> bool {
    has_token(request.headers(), UPGRADE, "websocket")
}

/// The client's key of a valid WebSocket handshake (RFC 6455, 4.2.1).
fn client_key(request: &Request<Incoming>) -> Option<HeaderValue> {
    let headers = request.headers();
    let is_valid = request.method() == Method::GET
        && has_token(headers, CONNECTION, "upgrade")
        && headers
            .get(SEC_WEBSOCKET_VERSION)
            .is_some_and(|version| version == "13")
        && headers.contains_key(HOST);
    if !is_valid {
        return None;
    }
    headers.get(SEC_WEBSOCKET_KEY).cloned()
}

/// The upgrade the API receives: the client's path, its host and the headers that carry its credentials.
fn upstream_request(
    request: &Request<Incoming>,
    route: &Route,
    secret: &HeaderValue,
) -> Option<Request<()>> {
    let path = request.uri().path_and_query()?.as_str();
    let mut builder = Request::builder()
        .method(Method::GET)
        .uri(format!("ws://{}{path}", route.authority))
        .header(HOST, request.headers().get(HOST)?.clone())
        .header(CONNECTION, "Upgrade")
        .header(UPGRADE, "websocket")
        .header(SEC_WEBSOCKET_VERSION, "13")
        .header(SEC_WEBSOCKET_KEY, generate_key());
    let entrance: &[&str] = if route.client.is_some() {
        &[]
    } else {
        &ENTRANCE_HEADERS
    };
    for name in PASSED_HEADERS.iter().chain(entrance) {
        for value in request.headers().get_all(*name) {
            builder = builder.header(*name, value.clone());
        }
    }
    if let Some(client) = route.client {
        builder = builder
            .header(RELAY_SECRET_HEADER, secret.clone())
            .header(RELAY_CONTRACT_HEADER, CONTRACT_VERSION.to_string())
            .header(RELAY_CLIENT_HEADER, client.to_string());
    }
    builder.body(()).ok()
}

type ApiSocket = WebSocketStream<TcpStream>;

async fn connect_api(
    authority: &str,
    request: Request<()>,
) -> Result<(ApiSocket, Option<HeaderValue>), SocketError> {
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(authority))
        .await
        .map_err(|_| SocketError::Io(std::io::ErrorKind::TimedOut.into()))??;
    stream.set_nodelay(true)?;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAXIMUM_API_MESSAGE))
        .max_frame_size(Some(MAXIMUM_API_MESSAGE));
    let (socket, response) = client_async_with_config(request, stream, Some(config)).await?;
    Ok((
        socket,
        response.headers().get(SEC_WEBSOCKET_PROTOCOL).cloned(),
    ))
}

fn switching_response(key: &HeaderValue, protocol: Option<HeaderValue>) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::new()));
    *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    let headers = response.headers_mut();
    headers.insert(UPGRADE, HeaderValue::from_static("websocket"));
    headers.insert(CONNECTION, HeaderValue::from_static("Upgrade"));
    if let Ok(accept) = HeaderValue::from_str(&derive_accept_key(key.as_bytes())) {
        headers.insert(SEC_WEBSOCKET_ACCEPT, accept);
    }
    if let Some(protocol) = protocol {
        headers.insert(SEC_WEBSOCKET_PROTOCOL, protocol);
    }
    response
}

/// Answers a client's upgrade by opening the same upgrade at the API first.
///
/// Returns `101` and relays the frames once the API accepted, the API's own
/// status when it refused, `502` when it cannot be reached in time and `503`
/// when the channel's limit is reached.
pub async fn open(
    hub: &Arc<RelayHub>,
    mut request: Request<Incoming>,
    route: Route,
) -> Response<Full<Bytes>> {
    let Some(key) = client_key(&request) else {
        return refusal(StatusCode::BAD_REQUEST, "Bad Request");
    };
    if *hub.stopping.borrow() {
        return refusal(StatusCode::SERVICE_UNAVAILABLE, "Service Unavailable");
    }
    let Some(slot) = hub.reserve(route.channel) else {
        return refusal(StatusCode::SERVICE_UNAVAILABLE, "Service Unavailable");
    };
    let Some(upstream) = upstream_request(&request, &route, &hub.secret) else {
        return refusal(StatusCode::BAD_REQUEST, "Bad Request");
    };
    let channel = route.channel.name();
    let (api, protocol) = match tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        connect_api(&route.authority, upstream),
    )
    .await
    {
        Ok(Ok(accepted)) => accepted,
        Ok(Err(SocketError::Http(answer))) => {
            // The API refused the client: its status goes back, its body does not matter.
            return refusal(answer.status(), "");
        }
        Ok(Err(_)) | Err(_) => {
            hub.notice(
                "core.relay.api_unavailable",
                "pages-api did not accept a relayed connection in time",
                json!({ "channel": channel }),
            );
            return refusal(StatusCode::BAD_GATEWAY, "Pages backend unavailable");
        }
    };
    let upgrade = hyper::upgrade::on(&mut request);
    let pump = Pump {
        channel: route.channel,
        closing: route.closing,
        stopping: hub.stopping.subscribe(),
    };
    tokio::spawn(async move {
        let Ok(upgraded) = upgrade.await else {
            return;
        };
        let config = WebSocketConfig::default()
            .max_message_size(Some(route.channel.maximum_client_message()))
            .max_frame_size(Some(route.channel.maximum_client_message()));
        let client =
            WebSocketStream::from_raw_socket(TokioIo::new(upgraded), Role::Server, Some(config))
                .await;
        pump::run(client, api, pump, slot).await;
    });
    switching_response(&key, protocol)
}
