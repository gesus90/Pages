//! The HTTP side: `GET /live-changes`, `GET /health/live`, with a status
//! target `GET /service-status` and `GET /service-status/details`, and the
//! WebSocket upgrades of runners and consoles the entrance passes on (PAGE-239).

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{Either, Full};
use hyper::body::Incoming;
use hyper::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, HeaderMap, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

use crate::channel::Channel;
use crate::contract::{MAXIMUM_COOKIE_LENGTH, MAXIMUM_TEXT_LENGTH};
use crate::dispatcher::{Command, OpenOutcome, OpenRequest};
use crate::log::{self, Severity};
use crate::relay::{self, RelayHub, Route};
use crate::status::{StatusAnswer, StatusService};
use crate::stream::LiveBody;

/// The longest wait for the decision about a new stream.
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);
/// An idle request head is closed after this time; an open stream is not.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// A longer cursor value is not kept; it counts as an invalid cursor.
const MAXIMUM_CURSOR_LENGTH: usize = 128;
/// The public light of all platform services (PAGE-238).
const STATUS_PATH: &str = "/service-status";
/// The services in detail, for an admin session only.
const STATUS_DETAILS_PATH: &str = "/service-status/details";

type ResponseBody = Either<LiveBody, Full<Bytes>>;

fn plain(status: StatusCode, text: &'static str) -> Response<ResponseBody> {
    let mut response = Response::new(Either::Right(Full::new(Bytes::from_static(
        text.as_bytes(),
    ))));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn status_response(answer: StatusAnswer) -> Response<ResponseBody> {
    let mut response = Response::new(Either::Right(Full::new(Bytes::from(answer.body))));
    *response.status_mut() = answer.status;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn stream_response(body: LiveBody) -> Response<ResponseBody> {
    let mut response = Response::new(Either::Left(body));
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
}

/// All `Cookie` headers as one, as a browser over HTTP/1.1 sends them.
fn read_cookie(headers: &HeaderMap) -> Option<String> {
    let parts: Vec<&str> = headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .collect();
    let cookie = parts.join("; ");
    (!cookie.is_empty() && cookie.len() <= MAXIMUM_COOKIE_LENGTH).then_some(cookie)
}

/// A non-empty cursor value; one too long to be a cursor is kept as an invalid marker.
fn read_cursor(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    Some(if text.len() <= MAXIMUM_CURSOR_LENGTH {
        text.to_owned()
    } else {
        String::new()
    })
}

/// The page's fingerprint and the browser's cursor; `Last-Event-ID` wins over `after`.
fn read_stream_query(request: &Request<Incoming>) -> (String, Option<String>) {
    let mut version = String::new();
    let mut after = None;
    for (name, value) in form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes()) {
        match name.as_ref() {
            "version" if value.len() <= MAXIMUM_TEXT_LENGTH => version = value.into_owned(),
            "after" => after = read_cursor(&value),
            _ => {}
        }
    }
    let last_event_id = request
        .headers()
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(read_cursor);
    (version, last_event_id.or(after))
}

async fn open_stream(
    request: &Request<Incoming>,
    commands: &mpsc::UnboundedSender<Command>,
) -> Response<ResponseBody> {
    // Without a cookie there is no session to ask about.
    let Some(cookie) = read_cookie(request.headers()) else {
        return plain(StatusCode::FORBIDDEN, "Forbidden");
    };
    let (version, cursor) = read_stream_query(request);
    let (reply, outcome) = oneshot::channel();
    let open = OpenRequest {
        cookie,
        version,
        cursor,
        reply,
    };
    if commands.send(Command::Open(open)).is_err() {
        return plain(StatusCode::SERVICE_UNAVAILABLE, "Pages core unavailable");
    }
    match tokio::time::timeout(OPEN_TIMEOUT, outcome).await {
        Ok(Ok(OpenOutcome::Accepted(body))) => stream_response(body),
        Ok(Ok(OpenOutcome::Refused)) => plain(StatusCode::FORBIDDEN, "Forbidden"),
        Ok(Ok(OpenOutcome::Busy | OpenOutcome::Unavailable) | Err(_)) | Err(_) => {
            plain(StatusCode::SERVICE_UNAVAILABLE, "Pages core unavailable")
        }
    }
}

/// The status endpoints; without a status target they do not exist.
async fn answer_status(
    request: &Request<Incoming>,
    status: Option<&StatusService>,
) -> Response<ResponseBody> {
    let Some(status) = status else {
        return plain(StatusCode::NOT_FOUND, "Not Found");
    };
    if request.method() != Method::GET {
        return plain(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
    }
    if request.uri().path() == STATUS_PATH {
        return status_response(status.light().await);
    }
    status_response(status.details(read_cookie(request.headers())).await)
}

/// What the core's own port serves besides the live streams.
#[derive(Clone)]
pub struct Services {
    /// The service status; `None` without a status target.
    pub status: Option<Arc<StatusService>>,
    /// The relayed WebSocket connections.
    pub relay: Arc<RelayHub>,
    /// `host:port` of the API, where runners and consoles are relayed to.
    pub api: Arc<str>,
}

/// Relays a runner or console upgrade; any other upgrade does not exist here.
async fn relay_upgrade(request: Request<Incoming>, services: &Services) -> Response<ResponseBody> {
    let Some(channel) = Channel::of_ingress_path(request.uri().path()) else {
        return plain(StatusCode::NOT_FOUND, "Not Found");
    };
    let route = Route {
        channel,
        authority: services.api.to_string(),
        client: None,
        closing: None,
    };
    relay::open(&services.relay, request, route)
        .await
        .map(Either::Right)
}

async fn answer(
    request: Request<Incoming>,
    commands: mpsc::UnboundedSender<Command>,
    services: Services,
) -> Result<Response<ResponseBody>, Infallible> {
    if relay::is_upgrade(&request) {
        return Ok(relay_upgrade(request, &services).await);
    }
    let status = services.status;
    let is_get = request.method() == Method::GET;
    let response = match request.uri().path() {
        "/live-changes" if is_get => open_stream(&request, &commands).await,
        "/health/live" if is_get => plain(StatusCode::OK, "ok"),
        "/live-changes" | "/health/live" => {
            plain(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed")
        }
        STATUS_PATH | STATUS_DETAILS_PATH => answer_status(&request, status.as_deref()).await,
        _ => plain(StatusCode::NOT_FOUND, "Not Found"),
    };
    Ok(response)
}

/// Accepts connections until the process ends.
pub async fn serve(
    listener: TcpListener,
    commands: mpsc::UnboundedSender<Command>,
    services: Services,
) {
    loop {
        let (socket, _) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                // Running out of descriptors must not end the service; it recovers when streams close.
                log::record(
                    Severity::Warn,
                    "core.http.accept_failed",
                    "A connection could not be accepted",
                    json!({ "code": error.kind().to_string() }),
                );
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let _ = socket.set_nodelay(true);
        let commands = commands.clone();
        let services = services.clone();
        tokio::spawn(async move {
            let service =
                service_fn(move |request| answer(request, commands.clone(), services.clone()));
            let mut builder = http1::Builder::new();
            builder
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_TIMEOUT);
            // A closed browser connection is normal for a stream.
            let _ = builder
                .serve_connection(TokioIo::new(socket), service)
                .with_upgrades()
                .await;
        });
    }
}
