//! Reads the services of the platform target from the systemd manager (PAGE-238).
//!
//! Only the services of one configured target are read, and of each only its
//! name, active state, last start and restart count, plus the load state, type
//! and result that decide the light. No other property is requested, so the
//! paths, command line, environment and credentials of a unit never reach the
//! core.

use std::collections::BTreeSet;
use std::fmt;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;
use zbus::Connection;
use zbus::zvariant::{OwnedObjectPath, OwnedValue};

use crate::config::{ManagerBus, StatusSource};
use crate::log::{self, Severity};

const DESTINATION: &str = "org.freedesktop.systemd1";
const MANAGER_PATH: &str = "/org/freedesktop/systemd1";
const MANAGER_INTERFACE: &str = "org.freedesktop.systemd1.Manager";
const UNIT_INTERFACE: &str = "org.freedesktop.systemd1.Unit";
const SERVICE_INTERFACE: &str = "org.freedesktop.systemd1.Service";
const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";

/// The longest wait for one complete reading, connection included.
const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// A reading is reused for this long, so frequent requests cost the manager nothing.
const FRESH_FOR: Duration = Duration::from_secs(2);
/// A target with more services is reported as unknown; the platform has a handful.
const MAXIMUM_SERVICES: usize = 32;
/// A longer service name is not shown; `definition/ServiceStatus.ts` has the same limit.
const MAXIMUM_PUBLIC_NAME_LENGTH: usize = 128;
/// The dependencies that make a service part of the target: `Wants=` and
/// `Requires=` of the target, and the services that are `PartOf=` it.
const MEMBER_PROPERTIES: [&str; 3] = ["Wants", "Requires", "ConsistsOf"];
/// The active states the status names; any other is shown as `unknown`.
const ACTIVE_STATES: [&str; 8] = [
    "active",
    "activating",
    "deactivating",
    "reloading",
    "refreshing",
    "inactive",
    "failed",
    "maintenance",
];

/// The light of all services together.
#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Light {
    /// Every service runs; a one-shot service also after a successful run.
    Green,
    /// A service is starting, stopping or restarting.
    Yellow,
    /// A service stopped, failed or is missing.
    Red,
    /// The manager could not be read.
    Unknown,
}

impl Light {
    /// The worse of two lights of readable services.
    fn worse(self, other: Self) -> Self {
        match (self, other) {
            (Self::Unknown, _) | (_, Self::Unknown) => Self::Unknown,
            (Self::Red, _) | (_, Self::Red) => Self::Red,
            (Self::Yellow, _) | (_, Self::Yellow) => Self::Yellow,
            (Self::Green, Self::Green) => Self::Green,
        }
    }
}

/// One service as the detailed status shows it; nothing else of the unit.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    /// The unit name, such as `pages-api@default.service`.
    pub name: String,
    /// The active state, one of [`ACTIVE_STATES`] or `unknown`.
    pub state: &'static str,
    /// Milliseconds since the epoch when the main process last started; `None` when never.
    pub last_start: Option<u64>,
    /// How often the manager restarted the service automatically.
    pub restarts: u32,
}

/// One reading of the target.
#[derive(Clone)]
pub struct Snapshot {
    /// The light of all services.
    pub light: Light,
    /// The services with a name that may be shown, sorted by name.
    pub services: Vec<ServiceState>,
}

impl Snapshot {
    fn unknown() -> Self {
        Self {
            light: Light::Unknown,
            services: Vec::new(),
        }
    }
}

/// Why a reading failed; only a fixed code, never a message of the manager.
struct ReadError(&'static str);

impl fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

/// The properties of one service that the status needs.
struct Reading {
    load_state: String,
    active_state: String,
    service_type: String,
    result: String,
    started_microseconds: u64,
    restarts: u32,
}

impl Reading {
    fn light(&self) -> Light {
        if self.load_state != "loaded" {
            return Light::Red;
        }
        let is_one_shot = self.service_type == "oneshot";
        match self.active_state.as_str() {
            "active" => Light::Green,
            // The restart observer runs briefly and ends; that is its normal state.
            "activating" if is_one_shot => Light::Green,
            "inactive" if is_one_shot && self.result == "success" => Light::Green,
            "activating" | "deactivating" | "reloading" | "refreshing" => Light::Yellow,
            _ => Light::Red,
        }
    }

    fn into_state(self, name: String) -> ServiceState {
        let state = ACTIVE_STATES
            .into_iter()
            .find(|known| *known == self.active_state)
            .unwrap_or("unknown");
        ServiceState {
            name,
            state,
            last_start: (self.started_microseconds > 0).then_some(self.started_microseconds / 1000),
            restarts: self.restarts,
        }
    }
}

struct ReaderState {
    connection: Option<Connection>,
    last: Option<(Instant, Snapshot)>,
}

/// Reads the target's services, at most once per [`FRESH_FOR`].
pub struct UnitReader {
    source: StatusSource,
    state: Mutex<ReaderState>,
}

impl UnitReader {
    /// Creates the reader; it connects to the manager on the first reading.
    pub fn new(source: StatusSource) -> Self {
        Self {
            source,
            state: Mutex::new(ReaderState {
                connection: None,
                last: None,
            }),
        }
    }

    /// The current reading; an unreadable manager gives [`Light::Unknown`] and no services.
    pub async fn read(&self) -> Snapshot {
        let mut state = self.state.lock().await;
        if let Some((read_at, snapshot)) = &state.last
            && read_at.elapsed() < FRESH_FOR
        {
            return snapshot.clone();
        }
        let outcome =
            tokio::time::timeout(READ_TIMEOUT, self.read_target(&mut state.connection)).await;
        let snapshot = match outcome {
            Ok(Ok(snapshot)) => snapshot,
            Ok(Err(error)) => self.fail(&mut state, &error.to_string()),
            Err(_) => self.fail(&mut state, "timeout"),
        };
        state.last = Some((Instant::now(), snapshot.clone()));
        snapshot
    }

    fn fail(&self, state: &mut ReaderState, code: &str) -> Snapshot {
        // A broken connection is opened anew on the next reading.
        state.connection = None;
        log::record(
            Severity::Warn,
            "core.status.read_failed",
            "The service manager could not be read",
            json!({ "code": code, "target": self.source.target }),
        );
        Snapshot::unknown()
    }

    async fn read_target(&self, slot: &mut Option<Connection>) -> Result<Snapshot, ReadError> {
        let connection = match slot {
            Some(connection) => connection.clone(),
            None => {
                let connection = connect(self.source.bus).await?;
                *slot = Some(connection.clone());
                connection
            }
        };
        let target = load_unit(&connection, &self.source.target).await?;
        if text(&connection, &target, UNIT_INTERFACE, "LoadState").await? != "loaded" {
            return Err(ReadError("target"));
        }
        let names = read_members(&connection, &target).await?;
        let mut light = Light::Green;
        let mut services = Vec::with_capacity(names.len());
        for name in names {
            let reading = read_service(&connection, &name).await?;
            light = light.worse(reading.light());
            if is_public_name(&name) {
                services.push(reading.into_state(name));
            } else {
                // It still counts for the light; its name could encode a path.
                log::record(
                    Severity::Warn,
                    "core.status.name_withheld",
                    "A service of the target has a name the status does not show",
                    json!({}),
                );
            }
        }
        Ok(Snapshot { light, services })
    }
}

async fn connect(bus: ManagerBus) -> Result<Connection, ReadError> {
    let connection = match bus {
        ManagerBus::System => Connection::system().await,
        ManagerBus::User => Connection::session().await,
    };
    connection.map_err(|_| ReadError("connect"))
}

async fn load_unit(connection: &Connection, name: &str) -> Result<OwnedObjectPath, ReadError> {
    let reply = connection
        .call_method(
            Some(DESTINATION),
            MANAGER_PATH,
            Some(MANAGER_INTERFACE),
            "LoadUnit",
            &(name,),
        )
        .await
        .map_err(|_| ReadError("load_unit"))?;
    reply
        .body()
        .deserialize::<OwnedObjectPath>()
        .map_err(|_| ReadError("unit_path"))
}

async fn property(
    connection: &Connection,
    path: &OwnedObjectPath,
    interface: &str,
    name: &str,
) -> Result<OwnedValue, ReadError> {
    let reply = connection
        .call_method(
            Some(DESTINATION),
            path.as_str(),
            Some(PROPERTIES_INTERFACE),
            "Get",
            &(interface, name),
        )
        .await
        .map_err(|_| ReadError("property"))?;
    reply
        .body()
        .deserialize::<OwnedValue>()
        .map_err(|_| ReadError("property_value"))
}

async fn text(
    connection: &Connection,
    path: &OwnedObjectPath,
    interface: &str,
    name: &str,
) -> Result<String, ReadError> {
    String::try_from(property(connection, path, interface, name).await?)
        .map_err(|_| ReadError("property_type"))
}

async fn number<T: TryFrom<OwnedValue>>(
    connection: &Connection,
    path: &OwnedObjectPath,
    name: &str,
) -> Result<T, ReadError> {
    T::try_from(property(connection, path, SERVICE_INTERFACE, name).await?)
        .map_err(|_| ReadError("property_type"))
}

/// The services the target wants, requires or consists of, without other unit types.
async fn read_members(
    connection: &Connection,
    target: &OwnedObjectPath,
) -> Result<BTreeSet<String>, ReadError> {
    let mut names = BTreeSet::new();
    for name in MEMBER_PROPERTIES {
        let members =
            Vec::<String>::try_from(property(connection, target, UNIT_INTERFACE, name).await?)
                .map_err(|_| ReadError("property_type"))?;
        names.extend(
            members
                .into_iter()
                .filter(|member| member.ends_with(".service")),
        );
    }
    if names.is_empty() || names.len() > MAXIMUM_SERVICES {
        return Err(ReadError("members"));
    }
    Ok(names)
}

async fn read_service(connection: &Connection, name: &str) -> Result<Reading, ReadError> {
    let path = load_unit(connection, name).await?;
    Ok(Reading {
        load_state: text(connection, &path, UNIT_INTERFACE, "LoadState").await?,
        active_state: text(connection, &path, UNIT_INTERFACE, "ActiveState").await?,
        service_type: text(connection, &path, SERVICE_INTERFACE, "Type").await?,
        result: text(connection, &path, SERVICE_INTERFACE, "Result").await?,
        started_microseconds: number(connection, &path, "ExecMainStartTimestamp").await?,
        restarts: number(connection, &path, "NRestarts").await?,
    })
}

/// A plain unit name; an escaped one (`\x2d`) could encode a path and is not shown.
fn is_public_name(name: &str) -> bool {
    name.len() <= MAXIMUM_PUBLIC_NAME_LENGTH
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":_.@-".contains(&byte))
}
