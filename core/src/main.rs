//! `pages-core` holds the live-change streams (SSE) of Pages and delivers the
//! committed events of `pages_event_outbox` to them (PAGE-237). With a status
//! target it also reports the state of the platform's services from the
//! systemd manager, independently of `pages-api` (PAGE-238). It relays the
//! WebSocket connections of runners and consoles that the entrance passes on
//! and, while `picaMobileRelayPort` is set, holds the Pica Mobile port; the
//! API keeps deciding every login and every message (PAGE-239).
//!
//! It knows no business rule and reads no business table: whether an account
//! may learn about an event is decided by `pages-api` over contract v1 of
//! `definition/PagesCoreContract.ts`, with a time limit, and every failure
//! delivers nothing. After a restart it continues from its stored outbox
//! position, and a browser continues from the opaque cursor it received last.

mod backup;
mod channel;
mod config;
mod contract;
mod cursor;
mod decisions;
mod dispatcher;
mod frames;
mod log;
mod mobile;
mod outbox;
mod pump;
mod relay;
mod ring;
mod server;
mod status;
mod stream;
mod timed_body;
mod units;

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{mpsc, oneshot};

use crate::config::Settings;
use crate::cursor::CursorCodec;
use crate::decisions::DecisionClient;
use crate::dispatcher::{Command, Dispatcher};
use crate::log::Severity;
use crate::mobile::MobileRelay;
use crate::outbox::Outbox;
use crate::relay::RelayHub;
use crate::server::Services;
use crate::status::StatusService;
use crate::units::UnitReader;

/// The longest wait for the reader position to be stored at the stop.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// The longest wait for the relayed connections' closing handshakes at the stop.
const RELAY_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

fn fail(event: &str, message: &str) -> ExitCode {
    log::record(Severity::Error, event, message, json!({}));
    ExitCode::FAILURE
}

async fn wait_for_stop() -> std::io::Result<()> {
    let mut terminate = signal(SignalKind::terminate())?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    tokio::select! {
        _ = terminate.recv() => {}
        _ = interrupt.recv() => {}
    }
    Ok(())
}

async fn run(mut settings: Settings) -> ExitCode {
    let Ok(outbox) = Outbox::new(&settings.database_url) else {
        return fail(
            "core.config.invalid",
            "\"databaseUrl\" is no valid PostgreSQL connection string",
        );
    };
    let Ok(decisions) = DecisionClient::new(settings.api.clone(), &settings.secret) else {
        return fail(
            "core.config.invalid",
            "\"pagesCoreSecret\" cannot be sent as a header",
        );
    };
    let status_target = settings.status.as_ref().map(|source| source.target.clone());
    let status = match settings.status.take() {
        None => None,
        Some(source) => match DecisionClient::new(settings.api.clone(), &settings.secret) {
            Ok(access) => Some(Arc::new(StatusService::new(
                UnitReader::new(source),
                access,
            ))),
            Err(_) => {
                return fail(
                    "core.config.invalid",
                    "\"pagesCoreSecret\" cannot be sent as a header",
                );
            }
        },
    };
    let Ok(relay) = RelayHub::new(&settings.secret).map(Arc::new) else {
        return fail(
            "core.config.invalid",
            "\"pagesCoreSecret\" cannot be sent as a header",
        );
    };
    let Ok(mobile) = MobileRelay::new(
        settings.config_path.clone(),
        Arc::clone(&relay),
        &settings.secret,
    ) else {
        return fail(
            "core.config.invalid",
            "\"pagesCoreSecret\" cannot be sent as a header",
        );
    };
    let Ok(listener) = TcpListener::bind(settings.listen).await else {
        return fail(
            "core.http.listen_failed",
            "The listen address cannot be bound",
        );
    };
    let (sender, receiver) = mpsc::unbounded_channel();
    let dispatcher = Dispatcher::new(
        (sender.clone(), receiver),
        outbox,
        decisions,
        CursorCodec::new(&settings.secret),
        settings.maximum_connections,
    );
    let delivery = tokio::spawn(dispatcher.run());
    let services = Services {
        status,
        relay: Arc::clone(&relay),
        api: Arc::from(settings.api.authority.as_str()),
    };
    tokio::spawn(server::serve(listener, sender.clone(), services));
    let mobile = tokio::spawn(mobile.run());
    log::record(
        Severity::Info,
        "core.started",
        "pages-core serves live changes",
        json!({
            "address": settings.listen.to_string(),
            "backend": settings.api.authority,
            "count": settings.maximum_connections,
            "target": status_target,
        }),
    );
    if wait_for_stop().await.is_err() {
        return fail("core.signal.failed", "The stop signals cannot be received");
    }
    // Relayed clients get a closing handshake and come back once the core runs again.
    relay.stop();
    mobile.abort();
    let _ = tokio::time::timeout(RELAY_SHUTDOWN_TIMEOUT, async {
        while !relay.is_idle() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    let (done, stored) = oneshot::channel();
    if sender.send(Command::Shutdown(done)).is_ok() {
        let _ = tokio::time::timeout(SHUTDOWN_TIMEOUT, stored).await;
    }
    delivery.abort();
    log::record(
        Severity::Info,
        "core.stopped",
        "pages-core stopped",
        json!({}),
    );
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let settings = match Settings::from_arguments(std::env::args().skip(1)) {
        Ok(settings) => settings,
        Err(error) => return fail("core.config.invalid", &error.to_string()),
    };
    // Two workers are plenty for idle streams and keep the footprint small.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build();
    match runtime {
        Ok(runtime) => runtime.block_on(run(settings)),
        Err(_) => fail("core.runtime.failed", "The async runtime cannot start"),
    }
}
