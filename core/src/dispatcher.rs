//! Holds every open stream and delivers the outbox to them in rounds.
//!
//! One task owns all state. Every stream has a cursor: the outbox position up
//! to which it was decided. A cursor moves in exactly two ways: `pages-api`
//! decided the events after it for the stream's session, or a complete read
//! of the outbox proved that there is no event between it and the new
//! position. A failed, timed out or skipped decision leaves it where it is.
//!
//! A round first validates the sessions of new streams and the sessions due
//! for their regular check, then decides at most two windows of at most 256
//! events with one request each: one from the lowest cursor that still lags,
//! one from the lowest cursor the memory cache holds. A window comes from the
//! memory cache when it holds the range, otherwise from the outbox itself, so
//! a stream that fell behind the cache is answered without a gap. Only the
//! retention floor of the outbox ends a replay, with an explicit resync, and
//! only for a session `pages-api` has just confirmed.

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::time::Duration;

use bytes::{Bytes, BytesMut};
use serde_json::json;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, MissedTickBehavior};

use crate::contract::{
    MAXIMUM_EVENTS_PER_REQUEST, MAXIMUM_SESSIONS_PER_REQUEST, OutboxEvent, SessionQuery,
};
use crate::cursor::{CursorCodec, is_cursor_shaped};
use crate::decisions::{DecisionClient, DecisionError, Notice, SessionOutcome};
use crate::frames;
use crate::log::{self, Severity};
use crate::outbox::{Outbox, OutboxError};
use crate::ring::EventRing;
use crate::stream::LiveBody;

/// Collects a burst of events and openings into one round.
const GATHER: Duration = Duration::from_millis(50);
/// How often the outbox is read for new events.
const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Keep-alive and the regular check of every session, as on the old path.
const HEARTBEAT: Duration = Duration::from_secs(25);
/// Events kept in memory; older ranges are read from the outbox on demand.
const RING_CAPACITY: usize = 8192;
/// Events read from the outbox in one statement while following its tail.
const READ_LIMIT: i64 = 500;
/// Rounds of frames a stream may fall behind before it is dropped.
const FRAME_BUFFER: usize = 64;
/// The reader position is stored at most this often while it changes.
const SAVE_INTERVAL: Duration = Duration::from_secs(1);
/// After a start the stored position is kept at least this long, longer than
/// the longest reconnect wait of the browser, so returning streams find it.
const STARTUP_GRACE: Duration = Duration::from_secs(120);
/// Closed streams whose cursors are remembered at most; the oldest leave first.
const MAXIMUM_REMEMBERED_CLOSURES: usize = 65_536;
/// After this many failed decisions in a row a session's streams close.
const MAXIMUM_FAILED_ROUNDS: u32 = 3;
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);
const MAXIMUM_RETRY_DELAY: Duration = Duration::from_secs(10);
/// Session-event pairs one request asks about, so that the API answers well inside the 3 s limit
/// even for a catch-up window; a window of 256 events is asked session by session.
const DECISIONS_PER_REQUEST: usize = 256;

/// What the HTTP side and the stream bodies tell the dispatcher.
pub enum Command {
    /// A browser asks for a stream.
    Open(OpenRequest),
    /// A stream body was dropped.
    Close(u64),
    /// The process stops; the reader position is stored first.
    Shutdown(oneshot::Sender<()>),
}

/// One browser's request for a stream.
pub struct OpenRequest {
    /// The browser's `Cookie` header, passed to `pages-api` unread.
    pub cookie: String,
    /// The authorization fingerprint the page was loaded with.
    pub version: String,
    /// The opaque cursor from `Last-Event-ID` or `after`, unverified.
    pub cursor: Option<String>,
    /// Receives the outcome.
    pub reply: oneshot::Sender<OpenOutcome>,
}

/// How a request for a stream ends.
pub enum OpenOutcome {
    /// The stream is open.
    Accepted(LiveBody),
    /// The session does not hold: 403.
    Refused,
    /// The outbox or the API cannot be reached right now: 503.
    Unavailable,
    /// The connection limit is reached: 503.
    Busy,
}

struct Session {
    cookie: String,
    connections: HashSet<u64>,
    binding: Option<String>,
    is_account_due: bool,
    failures: u32,
    retry_at: Option<Instant>,
}

struct Connection {
    session: u64,
    /// Decided up to here; moves only after a decision or a proof of no events.
    cursor: u64,
    /// The position of the newest cursor handed to the browser; it reconnects from here.
    sent: u64,
    version: String,
    frames: mpsc::Sender<Bytes>,
}

struct PendingOpen {
    request: OpenRequest,
    session: u64,
}

/// A complete range of the outbox: every event in `start..=through` after `start`.
struct Window {
    start: u64,
    events: Vec<OutboxEvent>,
    through: u64,
    /// Set when retention removed events after `start`: its floor.
    pruned_through: Option<u64>,
}

/// What a session's answer means for its streams in one window.
struct Decided<'a> {
    version: &'a str,
    binding: &'a str,
    decisions: &'a HashMap<u64, Notice>,
}

/// The state of all streams and the reading of the outbox.
pub struct Dispatcher {
    commands: mpsc::UnboundedReceiver<Command>,
    body_commands: mpsc::UnboundedSender<Command>,
    outbox: Outbox,
    decisions: DecisionClient,
    cursors: CursorCodec,
    ring: Option<EventRing>,
    is_caught_up: bool,
    sessions: HashMap<u64, Session>,
    session_ids: HashMap<String, u64>,
    connections: HashMap<u64, Connection>,
    pending: Vec<PendingOpen>,
    next_id: u64,
    maximum_connections: usize,
    round_at: Option<Instant>,
    started: Instant,
    startup_position: Option<u64>,
    /// When streams closed and the cursor they held; protected for the grace time.
    recent_closures: VecDeque<(Instant, u64)>,
    saved_position: Option<u64>,
    last_save: Instant,
    outbox_failures: u32,
    outbox_retry_at: Instant,
}

async fn wait_until(moment: Option<Instant>) {
    match moment {
        Some(moment) => tokio::time::sleep_until(moment).await,
        None => std::future::pending().await,
    }
}

fn backoff(failures: u32) -> Duration {
    FIRST_RETRY_DELAY
        .saturating_mul(2_u32.saturating_pow(failures.saturating_sub(1)))
        .min(MAXIMUM_RETRY_DELAY)
}

fn sessions_per_request(events: usize) -> usize {
    (DECISIONS_PER_REQUEST / events.max(1)).clamp(1, MAXIMUM_SESSIONS_PER_REQUEST)
}

/// The frames of one stream for one decided window; the cursor moves to `through`.
fn window_frames(
    codec: &CursorCodec,
    connection: &mut Connection,
    decided: &Decided<'_>,
    window: &Window,
) -> Option<(Bytes, u64)> {
    let mut must_resync = connection.version != decided.version;
    if must_resync {
        decided.version.clone_into(&mut connection.version);
    }
    let mut output = BytesMut::new();
    let mut last_sealed = None;
    for event in window
        .events
        .iter()
        .filter(|event| event.position > connection.cursor)
    {
        match decided.decisions.get(&event.position) {
            Some(Notice::Change(change)) => {
                let cursor = codec.seal(event.position, decided.binding)?;
                output.extend_from_slice(&frames::change(&cursor, change));
                last_sealed = Some(event.position);
            }
            Some(Notice::Resync) => must_resync = true,
            None => {}
        }
    }
    connection.cursor = window.through.max(connection.cursor);
    if must_resync {
        let cursor = codec.seal(connection.cursor, decided.binding)?;
        output.extend_from_slice(&frames::resync(&cursor));
        last_sealed = Some(connection.cursor);
    }
    last_sealed.map(|position| (output.freeze(), position))
}

impl Dispatcher {
    /// Creates the dispatcher; it reads the outbox once it runs.
    pub fn new(
        commands: (
            mpsc::UnboundedSender<Command>,
            mpsc::UnboundedReceiver<Command>,
        ),
        outbox: Outbox,
        decisions: DecisionClient,
        cursors: CursorCodec,
        maximum_connections: usize,
    ) -> Self {
        let now = Instant::now();
        Self {
            commands: commands.1,
            body_commands: commands.0,
            outbox,
            decisions,
            cursors,
            ring: None,
            is_caught_up: false,
            sessions: HashMap::new(),
            session_ids: HashMap::new(),
            connections: HashMap::new(),
            pending: Vec::new(),
            next_id: 1,
            maximum_connections,
            round_at: None,
            started: now,
            startup_position: None,
            recent_closures: VecDeque::new(),
            saved_position: None,
            last_save: now,
            outbox_failures: 0,
            outbox_retry_at: now,
        }
    }

    /// Runs until shutdown or until every command sender is gone.
    pub async fn run(mut self) {
        let mut poll = tokio::time::interval(POLL_INTERVAL);
        poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut heartbeat = tokio::time::interval_at(Instant::now() + HEARTBEAT, HEARTBEAT);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                command = self.commands.recv() => match command {
                    Some(Command::Shutdown(done)) => {
                        self.save_position(true).await;
                        let _ = done.send(());
                        return;
                    }
                    Some(command) => self.handle(command),
                    None => return,
                },
                _ = poll.tick() => self.poll_outbox().await,
                _ = heartbeat.tick() => self.beat(),
                () = wait_until(self.round_at) => {
                    self.round_at = None;
                    self.run_round().await;
                }
            }
        }
    }

    fn schedule(&mut self, delay: Duration) {
        let moment = Instant::now() + delay;
        self.round_at = Some(self.round_at.map_or(moment, |current| current.min(moment)));
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Open(request) => self.queue_open(request),
            Command::Close(connection) => self.close_connection(connection),
            Command::Shutdown(_) => {}
        }
    }

    fn queue_open(&mut self, request: OpenRequest) {
        if self.ring.is_none() {
            let _ = request.reply.send(OpenOutcome::Unavailable);
            return;
        }
        if self.connections.len() + self.pending.len() >= self.maximum_connections {
            let _ = request.reply.send(OpenOutcome::Busy);
            return;
        }
        let session = self.session_for(&request.cookie);
        self.pending.push(PendingOpen { request, session });
        self.schedule(GATHER);
    }

    fn session_for(&mut self, cookie: &str) -> u64 {
        if let Some(session) = self.session_ids.get(cookie) {
            return *session;
        }
        let session = self.next_id;
        self.next_id += 1;
        self.session_ids.insert(cookie.to_owned(), session);
        self.sessions.insert(
            session,
            Session {
                cookie: cookie.to_owned(),
                connections: HashSet::new(),
                binding: None,
                is_account_due: true,
                failures: 0,
                retry_at: None,
            },
        );
        session
    }

    fn close_connection(&mut self, connection: u64) {
        let Some(closed) = self.connections.remove(&connection) else {
            return;
        };
        if self.recent_closures.len() >= MAXIMUM_REMEMBERED_CLOSURES {
            self.recent_closures.pop_front();
        }
        self.recent_closures
            .push_back((Instant::now(), closed.sent));
        if let Some(session) = self.sessions.get_mut(&closed.session) {
            session.connections.remove(&connection);
        }
        self.forget_idle_session(closed.session);
    }

    fn forget_idle_session(&mut self, session: u64) {
        let is_idle = self
            .sessions
            .get(&session)
            .is_some_and(|entry| entry.connections.is_empty())
            && !self.pending.iter().any(|open| open.session == session);
        if !is_idle {
            return;
        }
        if let Some(entry) = self.sessions.remove(&session) {
            self.session_ids.remove(&entry.cookie);
        }
    }

    /// Queues frames; `sealed` is the position of the newest cursor among them.
    fn send(&mut self, connection: u64, chunk: Bytes, sealed: Option<u64>) {
        let Some(entry) = self.connections.get_mut(&connection) else {
            return;
        };
        if entry.frames.try_send(chunk).is_ok() {
            if let Some(position) = sealed {
                entry.sent = position;
            }
            return;
        }
        // A reader that falls behind is dropped instead of buffered; it reconnects with its cursor.
        self.close_connection(connection);
    }

    /// The fixed 25 s timer: every stream gets a keep-alive with a fresh cursor of its decided position.
    ///
    /// Sent to every stream on the timer alone, whatever happened, so it tells nothing about
    /// activity; it keeps the browser's cursor close to the decided position.
    fn beat(&mut self) {
        let connections: Vec<(u64, u64, u64)> = self
            .connections
            .iter()
            .map(|(id, connection)| (*id, connection.session, connection.cursor))
            .collect();
        for (id, session, cursor) in connections {
            let sealed = self
                .sessions
                .get(&session)
                .and_then(|entry| entry.binding.as_deref())
                .and_then(|binding| self.cursors.seal(cursor, binding));
            match sealed {
                Some(sealed) => self.send(id, frames::heartbeat(&sealed), Some(cursor)),
                None => self.send(id, Bytes::from_static(frames::KEEP_ALIVE), None),
            }
        }
        for session in self.sessions.values_mut() {
            session.is_account_due = true;
        }
        self.schedule(GATHER);
    }

    fn is_retrying(&self, session: u64) -> bool {
        let now = Instant::now();
        self.sessions
            .get(&session)
            .is_some_and(|entry| entry.retry_at.is_some_and(|moment| moment > now))
    }

    async fn poll_outbox(&mut self) {
        if Instant::now() < self.outbox_retry_at {
            return;
        }
        let result = if self.ring.is_some() {
            self.read_new().await
        } else {
            self.initialize().await
        };
        match result {
            Ok(()) => {
                self.outbox_failures = 0;
                self.save_position(false).await;
            }
            Err(error) => self.outbox_failed(&error),
        }
    }

    fn outbox_failed(&mut self, error: &OutboxError) {
        self.outbox.reset();
        self.outbox_failures = self.outbox_failures.saturating_add(1);
        self.outbox_retry_at = Instant::now() + backoff(self.outbox_failures);
        log::record(
            Severity::Warn,
            "core.outbox.read_failed",
            "The outbox could not be read; the read is repeated",
            json!({ "code": error.to_string(), "count": self.outbox_failures }),
        );
    }

    /// Continues after the stored reader position; the cache fills from there.
    async fn initialize(&mut self) -> Result<(), OutboxError> {
        let stored = self.outbox.reader_position().await?;
        let position = match stored {
            Some(position) => position,
            None => self.outbox.head().await?,
        };
        log::record(
            Severity::Info,
            "core.outbox.ready",
            "The outbox is read from the stored position",
            json!({ "sequence": position, "isStored": stored.is_some() }),
        );
        self.ring = Some(EventRing::new(position, RING_CAPACITY));
        self.startup_position = Some(position);
        self.saved_position = stored;
        // Read on at once: openings wait until the tail reached the outbox's head.
        self.outbox_retry_at = Instant::now();
        Ok(())
    }

    async fn read_new(&mut self) -> Result<(), OutboxError> {
        let Some(tail) = self.ring.as_ref().map(EventRing::tail) else {
            return Ok(());
        };
        let batch = self.outbox.read_after(tail, READ_LIMIT).await?;
        let is_full = i64::try_from(batch.events.len()).is_ok_and(|count| count >= READ_LIMIT);
        let has_events = !batch.events.is_empty();
        let Some(ring) = self.ring.as_mut() else {
            return Ok(());
        };
        if batch.pruned_through > tail {
            // Retention passed the tail; the streams below the floor get their resync in a round.
            ring.raise_floor(batch.pruned_through);
        }
        ring.append(batch.events);
        let new_tail = ring.tail();
        if has_events {
            self.schedule(GATHER);
        }
        if is_full {
            // More events wait; the next read must not be 200 ms away.
            self.outbox_retry_at = Instant::now();
        } else if !self.is_caught_up {
            self.is_caught_up = true;
            self.schedule(Duration::ZERO);
            log::record(
                Severity::Info,
                "core.outbox.caught_up",
                "The core read the outbox up to its head",
                json!({ "sequence": new_tail }),
            );
        }
        Ok(())
    }

    /// The lowest cursor a browser may come back with; retention keeps everything after it.
    ///
    /// Counted are the cursors the open streams hold, those of streams closed within the
    /// grace time, and after a start the previous position; a stream that reconnects in
    /// time therefore finds every event after its cursor.
    fn durable_position(&mut self) -> Option<u64> {
        let tail = self.ring.as_ref().map(EventRing::tail)?;
        while self
            .recent_closures
            .front()
            .is_some_and(|(closed, _)| closed.elapsed() >= STARTUP_GRACE)
        {
            self.recent_closures.pop_front();
        }
        let startup = self
            .startup_position
            .filter(|_| self.started.elapsed() < STARTUP_GRACE);
        let lowest = self
            .connections
            .values()
            .map(|connection| connection.sent)
            .chain(self.recent_closures.iter().map(|(_, sent)| *sent))
            .chain(startup)
            .fold(tail, u64::min);
        Some(lowest)
    }

    async fn save_position(&mut self, is_forced: bool) {
        let Some(position) = self.durable_position() else {
            return;
        };
        let is_due = is_forced || self.last_save.elapsed() >= SAVE_INTERVAL;
        if self.saved_position == Some(position) || !is_due {
            return;
        }
        match self.outbox.save_reader_position(position).await {
            Ok(()) => {
                self.saved_position = Some(position);
                self.last_save = Instant::now();
            }
            Err(error) => self.outbox_failed(&error),
        }
    }

    /// One round: validations, then windows from the lowest lagging cursor upwards.
    async fn run_round(&mut self) {
        let Some(tail) = self.ring.as_ref().map(EventRing::tail) else {
            for open in std::mem::take(&mut self.pending) {
                let _ = open.request.reply.send(OpenOutcome::Unavailable);
            }
            return;
        };
        if self.is_caught_up {
            self.validate_sessions(tail).await;
        }
        // At most two windows of one request each, so new streams and the timer never wait
        // long: the oldest lag first, then the lowest cursor the cache holds, so that live
        // streams keep receiving while another stream catches up from the outbox.
        if let Some(through) = self.work_window(0, tail).await {
            let cache_floor = self.ring.as_ref().map_or(through, EventRing::floor);
            self.work_window(through.max(cache_floor), tail).await;
        }
        self.schedule_next_round(tail);
    }

    /// Reads and decides the window of the lowest lagging cursor at or above `lower_bound`.
    ///
    /// Returns the window's end, or `None` when nothing lags or the outbox failed.
    async fn work_window(&mut self, lower_bound: u64, tail: u64) -> Option<u64> {
        let start = self.lowest_lagging(lower_bound, tail)?;
        match self.read_window(start, tail).await {
            Ok(window) => {
                self.decide_window(&window, tail).await;
                Some(window.through)
            }
            Err(error) => {
                self.outbox_failed(&error);
                None
            }
        }
    }

    /// The lowest cursor below the tail of a stream whose session is not waiting for a retry.
    fn lowest_lagging(&self, lower_bound: u64, tail: u64) -> Option<u64> {
        self.connections
            .values()
            .filter(|connection| connection.cursor >= lower_bound && connection.cursor < tail)
            .filter(|connection| !self.is_retrying(connection.session))
            .map(|connection| connection.cursor)
            .min()
    }

    /// The events after `start`: from the cache when it holds the range, else from the outbox.
    async fn read_window(&mut self, start: u64, tail: u64) -> Result<Window, OutboxError> {
        if let Some(ring) = self.ring.as_ref().filter(|ring| start >= ring.floor()) {
            let events = ring.after(start, MAXIMUM_EVENTS_PER_REQUEST);
            return Ok(Self::window(start, events, tail));
        }
        let limit = i64::try_from(MAXIMUM_EVENTS_PER_REQUEST).unwrap_or(i64::MAX);
        let batch = self.outbox.read_after(start, limit).await?;
        if batch.pruned_through > start {
            return Ok(Window {
                start,
                events: Vec::new(),
                through: start,
                pruned_through: Some(batch.pruned_through),
            });
        }
        Ok(Self::window(start, batch.events, tail))
    }

    /// A full window ends at its last event; a shorter one proves that nothing follows up to the tail.
    fn window(start: u64, events: Vec<OutboxEvent>, tail: u64) -> Window {
        let last = events.last().map_or(start, |event| event.position);
        let through = if events.len() >= MAXIMUM_EVENTS_PER_REQUEST {
            last
        } else {
            last.max(tail)
        };
        Window {
            start,
            events,
            through,
            pruned_through: None,
        }
    }

    /// The streams a window covers: not waiting for a retry, cursor in `start..through`.
    fn window_members(&self, window: &Window) -> Vec<u64> {
        self.connections
            .iter()
            .filter(|(_, connection)| {
                connection.cursor >= window.start && connection.cursor < window.through
            })
            .filter(|(_, connection)| !self.is_retrying(connection.session))
            .map(|(id, _)| *id)
            .collect()
    }

    async fn decide_window(&mut self, window: &Window, tail: u64) {
        if let Some(floor) = window.pruned_through {
            self.resync_pruned(window, floor, tail).await;
            return;
        }
        let mut asked = BTreeSet::new();
        for id in self.window_members(window) {
            let Some(connection) = self.connections.get_mut(&id) else {
                continue;
            };
            let has_share = window
                .events
                .iter()
                .any(|event| event.position > connection.cursor);
            if has_share {
                asked.insert(connection.session);
            } else {
                // The window is complete after its start: no event lies between this cursor and `through`.
                connection.cursor = window.through;
            }
        }
        let asked: Vec<u64> = asked.into_iter().collect();
        // One request per window and round; the other sessions keep their cursors and follow in
        // the next rounds, where the same window is read again.
        let Some(group) = asked
            .chunks(sessions_per_request(window.events.len()))
            .next()
        else {
            return;
        };
        let result = self.decide(group, &window.events).await;
        for session in group {
            let outcome = result
                .as_ref()
                .ok()
                .and_then(|outcomes| outcomes.get(&session.to_string()));
            self.apply_window(*session, outcome, window);
        }
    }

    fn apply_window(&mut self, session: u64, outcome: Option<&SessionOutcome>, window: &Window) {
        match outcome {
            Some(SessionOutcome::Active {
                version,
                binding,
                decisions,
            }) => {
                self.confirm_session(session, binding);
                let decided = Decided {
                    version,
                    binding,
                    decisions,
                };
                for id in self.session_members(session) {
                    let is_member = self.connections.get(&id).is_some_and(|connection| {
                        connection.cursor >= window.start && connection.cursor < window.through
                    });
                    if !is_member {
                        continue;
                    }
                    let chunk = self.connections.get_mut(&id).and_then(|connection| {
                        window_frames(&self.cursors, connection, &decided, window)
                    });
                    if let Some((chunk, sealed)) = chunk {
                        self.send(id, chunk, Some(sealed));
                    }
                }
            }
            Some(SessionOutcome::Ended) => self.close_session(session),
            None => self.session_failed(session),
        }
        self.forget_idle_session(session);
    }

    /// Retention removed events these streams still lacked: after a confirmation of their
    /// session, they read everything again and continue at the tail.
    async fn resync_pruned(&mut self, window: &Window, floor: u64, tail: u64) {
        // The window ends at its start; the streams it concerns lie between its start and the floor.
        let affected: Vec<u64> = self
            .connections
            .iter()
            .filter(|(_, connection)| {
                connection.cursor >= window.start && connection.cursor < floor
            })
            .filter(|(_, connection)| !self.is_retrying(connection.session))
            .map(|(id, _)| *id)
            .collect();
        let sessions: BTreeSet<u64> = affected
            .iter()
            .filter_map(|id| {
                self.connections
                    .get(id)
                    .map(|connection| connection.session)
            })
            .collect();
        let sessions: Vec<u64> = sessions.into_iter().collect();
        for group in sessions.chunks(MAXIMUM_SESSIONS_PER_REQUEST) {
            let result = self.decide(group, &[]).await;
            for session in group {
                let outcome = result
                    .as_ref()
                    .ok()
                    .and_then(|outcomes| outcomes.get(&session.to_string()));
                match outcome {
                    Some(SessionOutcome::Active { binding, .. }) => {
                        self.confirm_session(*session, binding);
                        let members: Vec<u64> = affected
                            .iter()
                            .copied()
                            .filter(|id| {
                                self.connections
                                    .get(id)
                                    .is_some_and(|c| c.session == *session)
                            })
                            .collect();
                        for id in members {
                            self.resync_at(id, tail, binding);
                        }
                    }
                    Some(SessionOutcome::Ended) => self.close_session(*session),
                    None => self.session_failed(*session),
                }
                self.forget_idle_session(*session);
            }
        }
        log::record(
            Severity::Warn,
            "core.outbox.floor_passed",
            "Retention removed events open streams lacked; they read everything again",
            json!({ "deleted": floor, "count": affected.len() }),
        );
    }

    fn resync_at(&mut self, id: u64, position: u64, binding: &str) {
        let Some(cursor) = self.cursors.seal(position, binding) else {
            return;
        };
        if let Some(connection) = self.connections.get_mut(&id) {
            connection.cursor = position;
        }
        self.send(id, frames::resync(&cursor), Some(position));
    }

    fn session_members(&self, session: u64) -> Vec<u64> {
        self.sessions
            .get(&session)
            .map(|entry| entry.connections.iter().copied().collect())
            .unwrap_or_default()
    }

    fn confirm_session(&mut self, session: u64, binding: &str) {
        if let Some(entry) = self.sessions.get_mut(&session) {
            entry.failures = 0;
            entry.retry_at = None;
            entry.is_account_due = false;
            entry.binding = Some(binding.to_owned());
        }
    }

    /// Asks for the sessions of new streams and the sessions due for their regular check.
    async fn validate_sessions(&mut self, tail: u64) {
        let mut openings: HashMap<u64, Vec<OpenRequest>> = HashMap::new();
        for open in std::mem::take(&mut self.pending) {
            openings.entry(open.session).or_default().push(open.request);
        }
        let mut asked: BTreeSet<u64> = openings.keys().copied().collect();
        for (id, session) in &self.sessions {
            if session.is_account_due && !self.is_retrying(*id) {
                asked.insert(*id);
            }
        }
        let asked: Vec<u64> = asked.into_iter().collect();
        for group in asked.chunks(MAXIMUM_SESSIONS_PER_REQUEST) {
            let result = self.decide(group, &[]).await;
            for session in group {
                let opens = openings.remove(session).unwrap_or_default();
                let outcome = result
                    .as_ref()
                    .ok()
                    .and_then(|outcomes| outcomes.get(&session.to_string()));
                self.apply_validation(*session, outcome, opens, tail);
            }
        }
    }

    fn apply_validation(
        &mut self,
        session: u64,
        outcome: Option<&SessionOutcome>,
        openings: Vec<OpenRequest>,
        tail: u64,
    ) {
        match outcome {
            Some(SessionOutcome::Active {
                version, binding, ..
            }) => {
                self.confirm_session(session, binding);
                for id in self.session_members(session) {
                    self.resync_if_version_changed(id, version, binding);
                }
                for opening in openings {
                    self.accept(session, opening, (version, binding), tail);
                }
            }
            Some(SessionOutcome::Ended) => {
                for opening in openings {
                    let _ = opening.reply.send(OpenOutcome::Refused);
                }
                self.close_session(session);
            }
            None => {
                for opening in openings {
                    let _ = opening.reply.send(OpenOutcome::Unavailable);
                }
                self.session_failed(session);
            }
        }
        self.forget_idle_session(session);
    }

    fn resync_if_version_changed(&mut self, id: u64, version: &str, binding: &str) {
        let Some(connection) = self.connections.get_mut(&id) else {
            return;
        };
        if connection.version == version {
            return;
        }
        version.clone_into(&mut connection.version);
        let position = connection.cursor;
        self.resync_at(id, position, binding);
    }

    /// Opens the stream after its session was confirmed; an unusable cursor gets a resync.
    fn accept(&mut self, session: u64, opening: OpenRequest, outcome: (&str, &str), tail: u64) {
        let (version, binding) = outcome;
        let opened = opening.cursor.as_deref().map(|cursor| {
            is_cursor_shaped(cursor)
                .then(|| self.cursors.open(cursor, binding))
                .flatten()
                // A sealed position beyond the outbox's head comes from another database state.
                .filter(|position| *position <= tail)
        });
        let (cursor, is_cursor_usable) = match opened {
            None => (tail, true),
            Some(Some(position)) => (position, true),
            Some(None) => (tail, false),
        };
        let mut first = BytesMut::from(frames::RETRY);
        if !is_cursor_usable || opening.version != version {
            let Some(sealed) = self.cursors.seal(cursor, binding) else {
                let _ = opening.reply.send(OpenOutcome::Unavailable);
                return;
            };
            first.extend_from_slice(&frames::resync(&sealed));
        }
        let (sender, receiver) = mpsc::channel(FRAME_BUFFER);
        if sender.try_send(first.freeze()).is_err() {
            return;
        }
        let id = self.next_id;
        self.next_id += 1;
        let body = LiveBody::new(id, receiver, self.body_commands.clone());
        if opening.reply.send(OpenOutcome::Accepted(body)).is_err() {
            return;
        }
        let connection = Connection {
            session,
            cursor,
            sent: cursor,
            version: version.to_owned(),
            frames: sender,
        };
        self.connections.insert(id, connection);
        if let Some(entry) = self.sessions.get_mut(&session) {
            entry.connections.insert(id);
        }
    }

    async fn decide(
        &self,
        group: &[u64],
        events: &[OutboxEvent],
    ) -> Result<HashMap<String, SessionOutcome>, DecisionError> {
        let keys: Vec<(String, &str)> = group
            .iter()
            .filter_map(|id| {
                self.sessions
                    .get(id)
                    .map(|session| (id.to_string(), session.cookie.as_str()))
            })
            .collect();
        let queries: Vec<SessionQuery<'_>> = keys
            .iter()
            .map(|(key, cookie)| SessionQuery { key, cookie })
            .collect();
        let result = self.decisions.decide(&queries, events).await;
        if let Err(error) = &result {
            log::record(
                Severity::Warn,
                "core.decisions.failed",
                "pages-api gave no valid decision; nothing is delivered and no cursor moves",
                json!({ "code": error.to_string(), "count": queries.len() }),
            );
        }
        result
    }

    fn close_session(&mut self, session: u64) {
        for id in self.session_members(session) {
            self.close_connection(id);
        }
    }

    /// Fail closed: cursors stay, the session waits for a retry, its streams close after repeated failures.
    fn session_failed(&mut self, session: u64) {
        let Some(entry) = self.sessions.get_mut(&session) else {
            return;
        };
        entry.failures = entry.failures.saturating_add(1);
        if entry.failures >= MAXIMUM_FAILED_ROUNDS {
            self.close_session(session);
            return;
        }
        let delay = backoff(entry.failures);
        entry.retry_at = Some(Instant::now() + delay);
        self.schedule(delay);
    }

    fn schedule_next_round(&mut self, tail: u64) {
        self.schedule_retries();
        if !self.is_caught_up && !self.pending.is_empty() {
            self.schedule(GATHER);
            return;
        }
        let has_lagging = self.lowest_lagging(0, tail).is_some();
        let is_due = self
            .sessions
            .iter()
            .any(|(id, session)| session.is_account_due && !self.is_retrying(*id));
        if !(has_lagging || is_due || !self.pending.is_empty()) {
            return;
        }
        // While the outbox fails, the next window waits for its retry.
        let now = Instant::now();
        let delay = if self.outbox_retry_at > now && self.outbox_failures > 0 {
            self.outbox_retry_at - now
        } else {
            Duration::ZERO
        };
        self.schedule(delay);
    }

    /// A round may run before a session's retry is due; its retry is scheduled again, never dropped.
    fn schedule_retries(&mut self) {
        let now = Instant::now();
        let next = self
            .sessions
            .values()
            .filter(|session| !session.connections.is_empty())
            .filter_map(|session| session.retry_at)
            .filter(|moment| *moment > now)
            .min();
        if let Some(moment) = next {
            self.schedule(moment - now);
        }
    }
}
