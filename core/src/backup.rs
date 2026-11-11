//! The time of the last successful PostgreSQL base backup (PAGE-282), shown in
//! the fact line of the system dashboard.
//!
//! The backup of `docs/PostgresMigration.md` runs as a one-shot unit whose
//! name ends with `-base-backup.service`, in the user manager of the account
//! running the core or in the system manager. Both managers are read the way
//! the services are: of the loaded units with that ending only the result and
//! the exit time of the main process, at most once a minute and within two
//! seconds per manager. No other unit is listed and no other property is read.

use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use zbus::Connection;
use zbus::zvariant::OwnedObjectPath;

use crate::config::ManagerBus;
use crate::units::{
    DESTINATION, MANAGER_INTERFACE, MANAGER_PATH, ReadError, SERVICE_INTERFACE, connect, property,
};

/// The units of the backup; the manager matches the pattern.
const PATTERN: &str = "*-base-backup.service";
/// A reading is reused for this long; the backup runs once a day.
const FRESH_FOR: Duration = Duration::from_secs(60);
/// The longest wait for one manager, connection included.
const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// More backup units than this are not read; an instance has one.
const MAXIMUM_UNITS: usize = 8;
/// The user manager of the account first, where an isolated instance keeps it.
const BUSES: [ManagerBus; 2] = [ManagerBus::User, ManagerBus::System];

/// One entry of `ListUnitsByPatterns`: name, description, load, active and
/// sub state, followed unit, object path, job id, job type and job path.
type ListedUnit = (
    String,
    String,
    String,
    String,
    String,
    String,
    OwnedObjectPath,
    u32,
    String,
    OwnedObjectPath,
);

struct BackupState {
    connections: [Option<Connection>; 2],
    read_at: Option<Instant>,
    last_success: Option<u64>,
}

/// Reads when the backup last succeeded, at most once per [`FRESH_FOR`].
pub struct BackupReader {
    state: Mutex<BackupState>,
}

impl Default for BackupReader {
    fn default() -> Self {
        Self::new()
    }
}

impl BackupReader {
    /// Creates the reader; it connects to the managers on the first reading.
    pub fn new() -> Self {
        Self {
            state: Mutex::new(BackupState {
                connections: [None, None],
                read_at: None,
                last_success: None,
            }),
        }
    }

    /// Milliseconds since the epoch when a backup run last ended successfully.
    ///
    /// `None` without a backup unit in either manager and before the first
    /// successful run. A run that is under way or failed keeps the last
    /// success this process saw; the manager remembers only the latest run.
    pub async fn last_success(&self) -> Option<u64> {
        let mut state = self.state.lock().await;
        if state
            .read_at
            .is_some_and(|read_at| read_at.elapsed() < FRESH_FOR)
        {
            return state.last_success;
        }
        let mut has_unit = false;
        let mut is_complete = true;
        let mut latest = state.last_success;
        for (slot, bus) in state.connections.iter_mut().zip(BUSES) {
            match tokio::time::timeout(READ_TIMEOUT, read_bus(bus, slot)).await {
                Ok(Ok(successes)) => {
                    has_unit |= !successes.is_empty();
                    latest = successes.into_iter().flatten().chain(latest).max();
                }
                // A manager that is missing or broken is asked again with a new connection.
                Ok(Err(_)) | Err(_) => {
                    *slot = None;
                    is_complete = false;
                }
            }
        }
        state.last_success = if has_unit || !is_complete {
            latest
        } else {
            None
        };
        state.read_at = Some(Instant::now());
        state.last_success
    }
}

/// The successful end of every backup unit one manager holds; `None` for a unit without one.
async fn read_bus(
    bus: ManagerBus,
    slot: &mut Option<Connection>,
) -> Result<Vec<Option<u64>>, ReadError> {
    let connection = match slot {
        Some(connection) => connection.clone(),
        None => {
            let connection = connect(bus).await?;
            *slot = Some(connection.clone());
            connection
        }
    };
    let states: &[&str] = &[];
    let patterns: &[&str] = &[PATTERN];
    let reply = connection
        .call_method(
            Some(DESTINATION),
            MANAGER_PATH,
            Some(MANAGER_INTERFACE),
            "ListUnitsByPatterns",
            &(states, patterns),
        )
        .await
        .map_err(|_| ReadError("list_units"))?;
    let units = reply
        .body()
        .deserialize::<Vec<ListedUnit>>()
        .map_err(|_| ReadError("unit_list"))?;
    let mut successes = Vec::new();
    for unit in units.into_iter().take(MAXIMUM_UNITS) {
        successes.push(read_success(&connection, &unit.6).await?);
    }
    Ok(successes)
}

/// When the latest run of one unit ended, if it succeeded.
async fn read_success(
    connection: &Connection,
    path: &OwnedObjectPath,
) -> Result<Option<u64>, ReadError> {
    let result = String::try_from(property(connection, path, SERVICE_INTERFACE, "Result").await?)
        .map_err(|_| ReadError("property_type"))?;
    let exited_microseconds = u64::try_from(
        property(connection, path, SERVICE_INTERFACE, "ExecMainExitTimestamp").await?,
    )
    .map_err(|_| ReadError("property_type"))?;
    // The exit time is zero while a run is under way.
    Ok((result == "success" && exited_microseconds > 0).then_some(exited_microseconds / 1000))
}
