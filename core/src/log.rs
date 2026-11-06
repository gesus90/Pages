//! One JSON line per event on standard output, read by journald.
//!
//! A line never holds a cookie, the shared secret or the database URL; the
//! callers pass only counts, positions and fixed codes as metadata.

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

/// How much attention a log line needs.
#[derive(Clone, Copy)]
pub enum Severity {
    /// Normal operation an operator may want to see.
    Info,
    /// Something failed and was handled, such as a retried read.
    Warn,
    /// The service cannot do its work.
    Error,
}

impl Severity {
    fn name(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Writes one log line.
///
/// `metadata` holds only values that are safe to keep in a log.
pub fn record(severity: Severity, event: &str, message: &str, metadata: Value) {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    let line = json!({
        "schemaVersion": 1,
        "timeMs": milliseconds,
        "severity": severity.name(),
        "event": event,
        "component": "pages-core",
        "pid": std::process::id(),
        "message": message,
        "metadata": metadata,
    });
    let mut output = std::io::stdout().lock();
    // A closed standard output must not stop the delivery of events.
    let _ = writeln!(output, "{line}");
}
