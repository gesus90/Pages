//! The Pica Mobile port, held by the core while `picaMobileRelayPort` is set
//! in the instance's `config.toml` (PAGE-239).
//!
//! The core listens on `picaMobilePort`, where the app connects, and relays
//! each connection and each attachment request to the API's relay listener
//! on the loopback port `picaMobileRelayPort`, with the shared secret and
//! the app's address. The API keeps everything else: the login, the session
//! checks and every message. The core follows the file while it runs: a port
//! the administrator stores is bound first, then the previous listener and
//! its connections close with 1001, as the protocol describes for a port
//! change. Removing the key closes the port; the API listens on it itself
//! again after its restart.

use std::convert::Infallible;
use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use http_body_util::{Either, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderName, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;

use crate::channel::Channel;
use crate::config::{MobileTarget, read_mobile_target};
use crate::contract::{
    CONTRACT_VERSION, RELAY_CLIENT_HEADER, RELAY_CONTRACT_HEADER, RELAY_SECRET_HEADER,
};
use crate::log::{self, Severity};
use crate::relay::{self, RelayHub, Route};
use crate::timed_body::{BodyLimits, TimedBody};

/// The configuration is looked at this often.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);
/// A port that could not be bound is tried again after this time.
const RETRY_INTERVAL: Duration = Duration::from_secs(5);
/// An idle request head is closed after this time.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// The longest wait for the TCP connection to the API's relay listener.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// A closing listener gives the request in progress on a connection this long.
const CLOSE_GRACE: Duration = Duration::from_secs(2);
/// The longest wait for the API's answer once the request was sent completely;
/// the same as for a WebSocket handshake.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
/// An attachment body that stands still this long, or lives this long, ends.
const BODY_LIMITS: BodyLimits = BodyLimits {
    idle: Duration::from_secs(30),
    lifetime: Duration::from_secs(15 * 60),
};
/// Headers that describe one connection and are never passed on.
const HOP_BY_HOP_HEADERS: [&str; 9] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

type MobileBody = Either<TimedBody<Incoming>, Full<Bytes>>;

/// What every connection on the Pica Mobile port needs.
struct Shared {
    hub: Arc<RelayHub>,
    client: Client<HttpConnector, TimedBody<Incoming>>,
    secret: HeaderValue,
    /// The relay listener's port; a changed key applies to new connections.
    relay_port: AtomicU16,
}

/// One bound Pica Mobile port.
struct Listener {
    listen: SocketAddr,
    closing: watch::Sender<bool>,
    accepting: JoinHandle<()>,
}

impl Drop for Listener {
    /// Stops accepting and closes the listener's connections with 1001.
    fn drop(&mut self) {
        self.accepting.abort();
        self.closing.send_replace(true);
    }
}

/// Follows the relay switch of the configuration and holds the port it names.
pub struct MobileRelay {
    config_path: PathBuf,
    shared: Arc<Shared>,
}

fn plain(status: StatusCode, text: &'static str) -> Response<MobileBody> {
    relay::refusal(status, text).map(Either::Right)
}

/// Why a port could not be bound, in the API's words for the settings card.
fn bind_reason(error: &std::io::Error) -> &'static str {
    match error.kind() {
        ErrorKind::AddrInUse => "portInUse",
        ErrorKind::PermissionDenied => "permissionDenied",
        _ => "listenFailed",
    }
}

async fn bind(listen: SocketAddr) -> std::io::Result<TcpListener> {
    match TcpListener::bind(listen).await {
        // A host without IPv6 listens on every IPv4 interface instead.
        Err(error) if listen.ip().is_unspecified() && listen.is_ipv6() => match error.kind() {
            ErrorKind::AddrNotAvailable | ErrorKind::Unsupported => {
                TcpListener::bind(SocketAddr::new(
                    IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                    listen.port(),
                ))
                .await
            }
            _ => Err(error),
        },
        result => result,
    }
}

/// The modification time and size of the file, to notice a change.
fn file_stamp(path: &Path) -> Option<(SystemTime, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.modified().ok()?, metadata.len()))
}

/// The end-to-end headers of an attachment request, with the core's proof and the app's address.
fn forwarded_headers(headers: &HeaderMap, shared: &Shared, client: IpAddr) -> Option<HeaderMap> {
    let mut forwarded = HeaderMap::with_capacity(headers.len() + 3);
    for (name, value) in headers {
        let lower = name.as_str();
        if HOP_BY_HOP_HEADERS.contains(&lower) || lower.starts_with("x-pages-core-") {
            continue;
        }
        forwarded.append(name.clone(), value.clone());
    }
    forwarded.insert(
        HeaderName::from_static(RELAY_SECRET_HEADER),
        shared.secret.clone(),
    );
    forwarded.insert(
        HeaderName::from_static(RELAY_CONTRACT_HEADER),
        HeaderValue::from(CONTRACT_VERSION),
    );
    forwarded.insert(
        HeaderName::from_static(RELAY_CLIENT_HEADER),
        HeaderValue::from_str(&client.to_string()).ok()?,
    );
    Some(forwarded)
}

/// Waits until the request was sent completely, then for the answer's time limit.
async fn answer_overdue(sent: oneshot::Receiver<()>) {
    // A body that fails or outlives its limits ends the exchange on its own.
    let _ = tokio::time::timeout(BODY_LIMITS.lifetime, sent).await;
    tokio::time::sleep(ANSWER_TIMEOUT).await;
}

/// Passes a plain HTTP request, such as an attachment of `chat.v1`, to the relay listener.
///
/// Both bodies stream unbuffered with [`BODY_LIMITS`]. Once the request is
/// sent, the API has [`ANSWER_TIMEOUT`] for its answer, or the app gets
/// `504`; an unreachable API gives `502`. An app that goes away cancels the
/// exchange and closes the connection to the API.
async fn forward_request(
    request: Request<Incoming>,
    shared: &Shared,
    client: IpAddr,
) -> Response<MobileBody> {
    let port = shared.relay_port.load(Ordering::Acquire);
    let path = request
        .uri()
        .path_and_query()
        .map_or("/", |path| path.as_str());
    let Ok(uri) = format!("http://127.0.0.1:{port}{path}").parse::<Uri>() else {
        return plain(StatusCode::BAD_REQUEST, "Bad Request");
    };
    let (mut parts, body) = request.into_parts();
    let Some(headers) = forwarded_headers(&parts.headers, shared, client) else {
        return plain(StatusCode::BAD_REQUEST, "Bad Request");
    };
    parts.uri = uri;
    parts.headers = headers;
    let (finished, sent) = oneshot::channel();
    let body = TimedBody::new(body, BODY_LIMITS, Some(finished));
    let exchange = shared.client.request(Request::from_parts(parts, body));
    let answer = tokio::select! {
        answer = exchange => answer,
        () = answer_overdue(sent) => {
            return plain(StatusCode::GATEWAY_TIMEOUT, "Pages backend timeout");
        }
    };
    match answer {
        Ok(answer) => {
            let (mut parts, body) = answer.into_parts();
            for name in HOP_BY_HOP_HEADERS {
                parts.headers.remove(name);
            }
            Response::from_parts(parts, Either::Left(TimedBody::new(body, BODY_LIMITS, None)))
        }
        Err(_) => plain(StatusCode::BAD_GATEWAY, "Pages backend unavailable"),
    }
}

async fn answer(
    request: Request<Incoming>,
    shared: Arc<Shared>,
    peer: IpAddr,
    closing: watch::Receiver<bool>,
) -> Result<Response<MobileBody>, Infallible> {
    if !relay::is_upgrade(&request) {
        return Ok(forward_request(request, &shared, peer).await);
    }
    let route = Route {
        channel: Channel::Mobile,
        authority: format!("127.0.0.1:{}", shared.relay_port.load(Ordering::Acquire)),
        client: Some(peer),
        closing: Some(closing),
    };
    Ok(relay::open(&shared.hub, request, route)
        .await
        .map(Either::Right))
}

/// Returns once the listener closed; a dropped listener counts as closed.
async fn listener_closed(closing: &mut watch::Receiver<bool>) {
    let _ = closing.wait_for(|closed| *closed).await;
}

/// Serves one connection of the app's port until it ends or its listener closes.
///
/// A closing listener ends its plain HTTP connections too, after the request
/// in progress and within [`CLOSE_GRACE`]; a relayed WebSocket has left this
/// connection already and closes with 1001 on its own.
async fn serve(
    socket: TcpStream,
    peer: IpAddr,
    shared: Arc<Shared>,
    mut closing: watch::Receiver<bool>,
) {
    let requests = closing.clone();
    let service =
        service_fn(move |request| answer(request, Arc::clone(&shared), peer, requests.clone()));
    let mut builder = http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT);
    let connection = builder
        .serve_connection(TokioIo::new(socket), service)
        .with_upgrades();
    tokio::pin!(connection);
    tokio::select! {
        _ = connection.as_mut() => {}
        () = listener_closed(&mut closing) => {
            connection.as_mut().graceful_shutdown();
            let _ = tokio::time::timeout(CLOSE_GRACE, connection).await;
        }
    }
}

async fn accept(listener: TcpListener, shared: Arc<Shared>, closing: watch::Receiver<bool>) {
    loop {
        let (socket, peer) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                log::record(
                    Severity::Warn,
                    "core.mobile.accept_failed",
                    "A Pica Mobile connection could not be accepted",
                    json!({ "code": error.kind().to_string() }),
                );
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let _ = socket.set_nodelay(true);
        let shared = Arc::clone(&shared);
        let closing = closing.clone();
        tokio::spawn(serve(socket, peer.ip(), shared, closing));
    }
}

impl MobileRelay {
    /// Creates the relay; it binds nothing before [`MobileRelay::run`].
    ///
    /// # Errors
    ///
    /// Returns an error when the secret cannot be sent as a header value.
    pub fn new(
        config_path: PathBuf,
        hub: Arc<RelayHub>,
        secret: &str,
    ) -> Result<Self, hyper::header::InvalidHeaderValue> {
        let mut value = HeaderValue::from_str(&format!("Bearer {secret}"))?;
        value.set_sensitive(true);
        let mut connector = HttpConnector::new();
        connector.set_nodelay(true);
        connector.set_connect_timeout(Some(CONNECT_TIMEOUT));
        Ok(Self {
            config_path,
            shared: Arc::new(Shared {
                hub,
                client: Client::builder(TokioExecutor::new()).build(connector),
                secret: value,
                relay_port: AtomicU16::new(0),
            }),
        })
    }

    /// Binds the target's port and starts accepting on it.
    async fn open(&self, target: MobileTarget) -> std::io::Result<Listener> {
        let listener = bind(target.listen).await?;
        let (closing, closed) = watch::channel(false);
        let accepting = tokio::spawn(accept(listener, Arc::clone(&self.shared), closed));
        Ok(Listener {
            listen: target.listen,
            closing,
            accepting,
        })
    }

    /// Brings the bound port in line with the configuration.
    async fn apply(
        &self,
        active: &mut Option<Listener>,
        target: Option<MobileTarget>,
        last_failure: &mut Option<(u16, &'static str)>,
    ) {
        let Some(target) = target else {
            if let Some(listener) = active.take() {
                log::record(
                    Severity::Info,
                    "core.mobile.stopped",
                    "pages-core no longer serves Pica Mobile",
                    json!({ "port": listener.listen.port() }),
                );
                drop(listener);
            }
            return;
        };
        self.shared
            .relay_port
            .store(target.relay_port, Ordering::Release);
        if active
            .as_ref()
            .is_some_and(|listener| listener.listen == target.listen)
        {
            return;
        }
        match self.open(target).await {
            Ok(listener) => {
                *last_failure = None;
                log::record(
                    Severity::Info,
                    "core.mobile.listening",
                    "pages-core serves Pica Mobile",
                    json!({ "port": target.listen.port(), "relay": target.relay_port }),
                );
                // The new port works; only now the previous one closes.
                drop(active.replace(listener));
            }
            Err(error) => {
                let failure = (target.listen.port(), bind_reason(&error));
                if last_failure.replace(failure) != Some(failure) {
                    log::record(
                        Severity::Warn,
                        "core.mobile.listen_failed",
                        "pages-core cannot listen on the Pica Mobile port",
                        json!({ "port": failure.0, "reason": failure.1 }),
                    );
                }
            }
        }
    }

    /// Follows the configuration until the process ends.
    pub async fn run(self) {
        let mut active: Option<Listener> = None;
        let mut target: Option<MobileTarget> = None;
        let mut stamp = None;
        let mut last_failure = None;
        let mut last_attempt = tokio::time::Instant::now();
        let mut ticker = tokio::time::interval(WATCH_INTERVAL);
        loop {
            ticker.tick().await;
            let current = file_stamp(&self.config_path);
            let is_changed = current != stamp;
            if is_changed {
                stamp = current;
                match read_mobile_target(&self.config_path) {
                    Ok(read) => target = read,
                    Err(error) => log::record(
                        Severity::Warn,
                        "core.mobile.config_invalid",
                        &error.to_string(),
                        json!({}),
                    ),
                }
            }
            let is_bound = match (&active, target) {
                (Some(listener), Some(target)) => listener.listen == target.listen,
                (None, None) => true,
                _ => false,
            };
            if is_bound && !is_changed {
                continue;
            }
            let is_retry_due = last_attempt.elapsed() >= RETRY_INTERVAL;
            if is_changed || is_retry_due || target.is_none() {
                last_attempt = tokio::time::Instant::now();
                self.apply(&mut active, target, &mut last_failure).await;
            }
        }
    }
}
