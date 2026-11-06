//! The SSE frames of the live channel, as `/live-changes` of `pages-api` writes them.
//!
//! The core adds the `id` field: an opaque cursor (`cursor.rs`) of the stream.
//! The browser sends it back as `Last-Event-ID` (or `after`) when it connects
//! again, and the core continues right after it. A stream gets a frame for a
//! notice it may see, a resync, or the keep-alive of the fixed 25 s timer;
//! events it may not see produce nothing at all.

use bytes::Bytes;
use serde_json::json;

use crate::contract::Change;

/// How long the browser waits before it connects again, as on the old path.
pub const RETRY: &[u8] = b"retry: 3000\n\n";
/// Keeps proxies from closing an idle stream; sent on a fixed timer, never per event.
pub const KEEP_ALIVE: &[u8] = b": keep-alive\n\n";

/// The timer keep-alive with a fresh cursor; sent to every stream every 25 s, whatever happened.
pub fn heartbeat(cursor: &str) -> Bytes {
    Bytes::from(format!(": keep-alive\nid: {cursor}\n\n"))
}

/// One object changed; the data is kind and id, never content.
pub fn change(cursor: &str, change: &Change) -> Bytes {
    let data = json!({ "kind": change.kind, "id": change.id });
    Bytes::from(format!("id: {cursor}\nevent: change\ndata: {data}\n\n"))
}

/// Anything may have changed; the page reads everything again.
pub fn resync(cursor: &str) -> Bytes {
    Bytes::from(format!("id: {cursor}\nevent: resync\ndata: {{}}\n\n"))
}
