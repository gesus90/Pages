//! The frames of one relayed WebSocket, in both directions (PAGE-239).
//!
//! Text and binary messages pass unchanged and in order. Nothing is queued:
//! a message is read from one side only after the previous one was written to
//! the other, so a slow side slows the other through TCP and memory stays
//! bounded by two messages. A write that does not finish in time ends the
//! connection. Nothing is replayed after a loss: every protocol reconciles,
//! repeats or reports on its own after a reconnect, so a replay by the core
//! could run an input twice. Every message read but not delivered is counted
//! in the closing log line.
//!
//! Each side keeps its own heartbeat. The API's pings are answered by the
//! core; the core pings Pica Mobile and console clients itself and drops a
//! client that stayed silent too long, as the API did before.

use std::future::pending;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use hyper::upgrade::Upgraded;
use hyper_util::rt::TokioIo;
use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio::time::{Duration, Interval, MissedTickBehavior, Sleep, interval_at, sleep, timeout};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{Error as SocketError, Message};

use crate::channel::Channel;
use crate::log::{self, Severity};
use crate::relay::Slot;

/// A write to either side that takes longer means a peer that stopped reading.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// The closing handshake of each side gets this long.
const CLOSE_GRACE: Duration = Duration::from_secs(2);

type ClientSocket = WebSocketStream<TokioIo<Upgraded>>;
type ApiSocket = WebSocketStream<TcpStream>;

/// What one relayed connection is told from outside.
pub struct Pump {
    /// The channel of the connection.
    pub channel: Channel,
    /// `true` once the connection's listener closes, such as after a port change.
    pub closing: Option<watch::Receiver<bool>>,
    /// `true` once the core stops.
    pub stopping: watch::Receiver<bool>,
}

/// What ended a connection first.
enum End {
    /// The client sent a close frame, with this code.
    ClientClosed(Option<CloseFrame>),
    /// The client's connection broke without a close frame.
    ClientLost,
    /// The client sent nothing for longer than its heartbeat allows.
    ClientSilent,
    /// The client sent a message above the channel's limit.
    ClientTooLarge,
    /// A write to the client did not finish in time.
    ClientStuck,
    /// The API sent a close frame, which the client receives unchanged.
    ApiClosed(Option<CloseFrame>),
    /// The API's connection broke without a close frame, as when it stops or crashes.
    ApiLost,
    /// The listener closed or the core stops.
    Stopped(&'static str),
}

impl End {
    fn name(&self) -> &'static str {
        match self {
            Self::ClientClosed(_) => "client_closed",
            Self::ClientLost => "client_lost",
            Self::ClientSilent => "client_silent",
            Self::ClientTooLarge => "client_too_large",
            Self::ClientStuck => "client_stuck",
            Self::ApiClosed(_) => "api_closed",
            Self::ApiLost => "api_lost",
            Self::Stopped(_) => "stopped",
        }
    }
}

/// What woke the relay loop.
enum Event {
    Stop(&'static str),
    Client(Option<Result<Message, SocketError>>),
    Api(Option<Result<Message, SocketError>>),
    Silent,
    Tick,
}

/// Messages read and written per direction; the difference was not delivered.
#[derive(Default)]
struct Counts {
    from_client: u64,
    to_api: u64,
    from_api: u64,
    to_client: u64,
}

struct Connection {
    client: ClientSocket,
    api: ApiSocket,
    channel: Channel,
    counts: Counts,
}

fn close_frame(code: u16, reason: &'static str) -> CloseFrame {
    CloseFrame {
        code: CloseCode::from(code),
        reason: reason.into(),
    }
}

fn frame_code(frame: Option<&CloseFrame>) -> Option<u16> {
    frame.map(|frame| u16::from(frame.code))
}

async fn tick(ticker: &mut Option<Interval>) {
    match ticker {
        Some(ticker) => {
            ticker.tick().await;
        }
        None => pending().await,
    }
}

async fn silence(deadline: &mut Option<std::pin::Pin<Box<Sleep>>>) {
    match deadline {
        Some(deadline) => deadline.as_mut().await,
        None => pending().await,
    }
}

async fn listener_closed(closing: &mut Option<watch::Receiver<bool>>) {
    match closing {
        // A dropped listener counts as closed.
        Some(closing) => {
            let _ = closing.wait_for(|closing| *closing).await;
        }
        None => pending().await,
    }
}

async fn stop_reason(pump: &mut Pump) -> &'static str {
    // At the core's stop its listeners close too; the stop names the reason.
    tokio::select! {
        biased;
        _ = pump.stopping.wait_for(|stopping| *stopping) => "Pages core is stopping",
        () = listener_closed(&mut pump.closing) => "Pica Mobile port changed",
    }
}

impl Connection {
    /// One message of the client; `Some` when it ends the connection.
    async fn on_client_message(
        &mut self,
        next: Option<Result<Message, SocketError>>,
    ) -> Option<End> {
        match next {
            Some(Ok(message @ (Message::Text(_) | Message::Binary(_)))) => {
                self.counts.from_client += 1;
                match timeout(WRITE_TIMEOUT, self.api.send(message)).await {
                    Ok(Ok(())) => {
                        self.counts.to_api += 1;
                        None
                    }
                    Ok(Err(_)) | Err(_) => Some(End::ApiLost),
                }
            }
            Some(Ok(Message::Close(frame))) => Some(End::ClientClosed(frame)),
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => None,
            Some(Err(SocketError::Capacity(_))) => Some(End::ClientTooLarge),
            Some(Err(_)) | None => Some(End::ClientLost),
        }
    }

    /// One message of the API; `Some` when it ends the connection.
    async fn on_api_message(&mut self, next: Option<Result<Message, SocketError>>) -> Option<End> {
        match next {
            Some(Ok(message @ (Message::Text(_) | Message::Binary(_)))) => {
                self.counts.from_api += 1;
                match timeout(WRITE_TIMEOUT, self.client.send(message)).await {
                    Ok(Ok(())) => {
                        self.counts.to_client += 1;
                        None
                    }
                    Ok(Err(_)) | Err(_) => Some(End::ClientStuck),
                }
            }
            Some(Ok(Message::Close(frame))) => Some(End::ApiClosed(frame)),
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => None,
            Some(Err(_)) | None => Some(End::ApiLost),
        }
    }

    /// Relays until something ends the connection.
    async fn relay(&mut self, pump: &mut Pump) -> End {
        let heartbeat = self.channel.heartbeat();
        let mut ticker = heartbeat.as_ref().map(|heartbeat| {
            let mut ticker = interval_at(
                tokio::time::Instant::now() + heartbeat.interval,
                heartbeat.interval,
            );
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            ticker
        });
        let quiet = heartbeat.as_ref().map(|heartbeat| heartbeat.silence);
        let mut deadline = quiet.map(|limit| Box::pin(sleep(limit)));
        loop {
            let event = tokio::select! {
                reason = stop_reason(pump) => Event::Stop(reason),
                next = self.client.next() => Event::Client(next),
                next = self.api.next() => Event::Api(next),
                () = silence(&mut deadline) => Event::Silent,
                () = tick(&mut ticker) => Event::Tick,
            };
            let end = match event {
                Event::Stop(reason) => Some(End::Stopped(reason)),
                Event::Client(next) => {
                    if let (Some(deadline), Some(limit)) = (deadline.as_mut(), quiet) {
                        deadline.as_mut().reset(tokio::time::Instant::now() + limit);
                    }
                    self.on_client_message(next).await
                }
                Event::Api(next) => self.on_api_message(next).await,
                Event::Silent => Some(End::ClientSilent),
                Event::Tick => self.ping_client().await,
            };
            if let Some(end) = end {
                return end;
            }
        }
    }

    /// The core's heartbeat ping to the client.
    async fn ping_client(&mut self) -> Option<End> {
        match timeout(
            WRITE_TIMEOUT,
            self.client.send(Message::Ping(Vec::new().into())),
        )
        .await
        {
            Ok(Ok(())) => None,
            Ok(Err(_)) | Err(_) => Some(End::ClientStuck),
        }
    }

    /// Sends a close frame to the client and waits for its answer.
    async fn close_client(&mut self, frame: Option<CloseFrame>) {
        let client = &mut self.client;
        let counts = &mut self.counts;
        let _ = timeout(CLOSE_GRACE, async {
            if client.close(frame).await.is_err() {
                return;
            }
            // Messages still on their way are not delivered any more; they are counted.
            while let Some(Ok(message)) = client.next().await {
                match message {
                    Message::Close(_) => break,
                    Message::Text(_) | Message::Binary(_) => counts.from_client += 1,
                    _ => {}
                }
            }
        })
        .await;
    }

    /// Sends a close frame to the API and waits for its answer.
    async fn close_api(&mut self, frame: Option<CloseFrame>) {
        let api = &mut self.api;
        let counts = &mut self.counts;
        let _ = timeout(CLOSE_GRACE, async {
            if api.close(frame).await.is_err() {
                return;
            }
            while let Some(Ok(message)) = api.next().await {
                match message {
                    Message::Close(_) => break,
                    Message::Text(_) | Message::Binary(_) => counts.from_api += 1,
                    _ => {}
                }
            }
        })
        .await;
    }

    /// Ends both sides as the cause requires; returns the code the client got or sent.
    async fn finish(&mut self, end: &End) -> Option<u16> {
        match end {
            End::ClientClosed(frame) => {
                // Reading the close frame queued its answer; a flush sends it, `close` would refuse.
                let _ = timeout(CLOSE_GRACE, self.client.flush()).await;
                self.close_api(frame.clone()).await;
                frame_code(frame.as_ref())
            }
            End::ApiClosed(frame) => {
                let _ = timeout(CLOSE_GRACE, self.api.flush()).await;
                self.close_client(frame.clone()).await;
                frame_code(frame.as_ref())
            }
            End::ApiLost => {
                let (code, reason) = self.channel.api_lost_close();
                self.close_client(Some(close_frame(code, reason))).await;
                Some(code)
            }
            End::ClientTooLarge => {
                self.close_client(Some(close_frame(1009, "Message too big")))
                    .await;
                Some(1009)
            }
            End::Stopped(reason) => {
                self.close_client(Some(close_frame(1001, reason))).await;
                self.close_api(Some(close_frame(1001, reason))).await;
                Some(1001)
            }
            // A vanished or silent client gets no closing handshake, as from the API before.
            End::ClientLost | End::ClientSilent | End::ClientStuck => None,
        }
    }
}

/// Relays one accepted connection until either side or the core ends it.
pub async fn run(client: ClientSocket, api: ApiSocket, mut pump: Pump, slot: Slot) {
    let started = Instant::now();
    let channel = pump.channel;
    log::record(
        Severity::Info,
        "core.relay.opened",
        "A relayed connection opened",
        json!({ "channel": channel.name(), "connection": slot.connection }),
    );
    let mut connection = Connection {
        client,
        api,
        channel,
        counts: Counts::default(),
    };
    let end = connection.relay(&mut pump).await;
    let code = connection.finish(&end).await;
    let counts = &connection.counts;
    log::record(
        Severity::Info,
        "core.relay.closed",
        "A relayed connection closed",
        json!({
            "channel": channel.name(),
            "connection": slot.connection,
            "end": end.name(),
            "code": code,
            "toApi": counts.to_api,
            "toClient": counts.to_client,
            "undeliveredToApi": counts.from_client - counts.to_api,
            "undeliveredToClient": counts.from_api - counts.to_client,
            "milliseconds": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        }),
    );
    drop(slot);
}
