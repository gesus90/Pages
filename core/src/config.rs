//! Start parameters and the two values read from the instance's `config.toml`.

use std::fmt;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};

use hyper::Uri;

const USAGE: &str = "Usage: pages-core --config /absolute/config.toml --listen <address>:<port> --api http://127.0.0.1:<port> [--max-connections <count>] [--status-target <name>.target [--status-bus system|user]]";

/// Streams held at once unless `--max-connections` names another limit.
///
/// 4096 idle streams stay far below the 256 MB budget of the unit.
const DEFAULT_MAXIMUM_CONNECTIONS: usize = 4096;
const HIGHEST_MAXIMUM_CONNECTIONS: usize = 65_536;
/// The shared secret has at least 256 bits when it holds random hex or base64.
const MINIMUM_SECRET_LENGTH: usize = 32;
const MAXIMUM_SECRET_LENGTH: usize = 512;
/// The longest unit name systemd accepts.
const MAXIMUM_UNIT_NAME_LENGTH: usize = 255;

/// A start parameter or the configuration is unusable; the message names no secret.
#[derive(Debug)]
pub struct ConfigError(String);

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

fn usage() -> ConfigError {
    ConfigError(USAGE.to_owned())
}

/// Where the API answers the decisions of contract v1.
#[derive(Clone)]
pub struct ApiOrigin {
    /// `host:port` of the API, sent as `Host`.
    pub authority: String,
}

/// Which systemd manager holds the platform target.
#[derive(Clone, Copy)]
pub enum ManagerBus {
    /// The system manager, as in production (`pages.target`).
    System,
    /// The manager of the user running the core, for an isolated instance.
    User,
}

/// Where the service status comes from (PAGE-238).
pub struct StatusSource {
    /// The target whose services are reported, such as `pages.target`.
    pub target: String,
    /// The manager that holds the target.
    pub bus: ManagerBus,
}

/// Everything `pages-core` starts with.
pub struct Settings {
    /// The address the streams are served on, normally a loopback port behind `pages-ingress`.
    pub listen: SocketAddr,
    /// The API that decides who sees which event.
    pub api: ApiOrigin,
    /// The PostgreSQL connection URL of the instance; a secret.
    pub database_url: String,
    /// The secret `pages-api` admits the core with; never logged.
    pub secret: String,
    /// Streams held at once; further ones are refused with 503.
    pub maximum_connections: usize,
    /// Set by `--status-target`: the core serves the service status.
    pub status: Option<StatusSource>,
    /// The instance's `config.toml`; the Pica Mobile relay follows it while running.
    pub config_path: PathBuf,
}

impl Settings {
    /// Reads the start parameters and the instance configuration they name.
    ///
    /// # Errors
    ///
    /// Returns a [`ConfigError`] when a parameter is missing or invalid, or when
    /// the configuration holds no finished setup with `databaseUrl` and
    /// `pagesCoreSecret`.
    pub fn from_arguments(arguments: impl Iterator<Item = String>) -> Result<Self, ConfigError> {
        let named = read_named_arguments(arguments)?;
        let config_path = PathBuf::from(named.config.ok_or_else(usage)?);
        if !config_path.is_absolute() {
            return Err(usage());
        }
        let listen = named
            .listen
            .ok_or_else(usage)?
            .parse::<SocketAddr>()
            .map_err(|_| usage())?;
        let api = read_api_origin(&named.api.ok_or_else(usage)?)?;
        let maximum_connections = match named.maximum_connections {
            None => DEFAULT_MAXIMUM_CONNECTIONS,
            Some(text) => read_maximum_connections(&text)?,
        };
        let status = read_status_source(named.status_target, named.status_bus)?;
        let instance = read_instance_config(&config_path)?;
        Ok(Self {
            listen,
            api,
            database_url: instance.database_url,
            secret: instance.secret,
            maximum_connections,
            status,
            config_path,
        })
    }
}

#[derive(Default)]
struct NamedArguments {
    config: Option<String>,
    listen: Option<String>,
    api: Option<String>,
    maximum_connections: Option<String>,
    status_target: Option<String>,
    status_bus: Option<String>,
}

fn read_named_arguments(
    mut arguments: impl Iterator<Item = String>,
) -> Result<NamedArguments, ConfigError> {
    let mut named = NamedArguments::default();
    while let Some(name) = arguments.next() {
        let value = arguments.next().ok_or_else(usage)?;
        let slot = match name.as_str() {
            "--config" => &mut named.config,
            "--listen" => &mut named.listen,
            "--api" => &mut named.api,
            "--max-connections" => &mut named.maximum_connections,
            "--status-target" => &mut named.status_target,
            "--status-bus" => &mut named.status_bus,
            _ => return Err(usage()),
        };
        if slot.replace(value).is_some() {
            return Err(usage());
        }
    }
    Ok(named)
}

fn read_api_origin(text: &str) -> Result<ApiOrigin, ConfigError> {
    let uri = text.parse::<Uri>().map_err(|_| usage())?;
    let is_bare_origin = uri.path() == "/" && uri.query().is_none();
    match (uri.scheme_str(), uri.authority()) {
        (Some("http"), Some(authority)) if authority.port().is_some() && is_bare_origin => {
            Ok(ApiOrigin {
                authority: authority.as_str().to_owned(),
            })
        }
        _ => Err(usage()),
    }
}

fn read_maximum_connections(text: &str) -> Result<usize, ConfigError> {
    match text.parse::<usize>() {
        Ok(count) if (1..=HIGHEST_MAXIMUM_CONNECTIONS).contains(&count) => Ok(count),
        _ => Err(usage()),
    }
}

/// A target name as systemd writes it, without escapes that could encode a path.
fn is_target_name(name: &str) -> bool {
    name.len() <= MAXIMUM_UNIT_NAME_LENGTH
        && name.len() > ".target".len()
        && name.ends_with(".target")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":_.@-".contains(&byte))
}

fn read_status_source(
    target: Option<String>,
    bus: Option<String>,
) -> Result<Option<StatusSource>, ConfigError> {
    let Some(target) = target else {
        // A bus without a target is a mistake, not a default.
        return if bus.is_some() {
            Err(usage())
        } else {
            Ok(None)
        };
    };
    if !is_target_name(&target) {
        return Err(usage());
    }
    let bus = match bus.as_deref() {
        None | Some("system") => ManagerBus::System,
        Some("user") => ManagerBus::User,
        Some(_) => return Err(usage()),
    };
    Ok(Some(StatusSource { target, bus }))
}

struct InstanceConfig {
    database_url: String,
    secret: String,
}

fn invalid(path: &Path, detail: &str) -> ConfigError {
    ConfigError(format!(
        "The configuration file \"{}\" is invalid: {detail}",
        path.display()
    ))
}

fn read_instance_config(path: &Path) -> Result<InstanceConfig, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|_| invalid(path, "it cannot be read."))?;
    // The parser error may quote the file, and the file holds secrets.
    let table = text
        .parse::<toml::Table>()
        .map_err(|_| invalid(path, "it is no valid TOML."))?;
    if table.get("firstRun").and_then(toml::Value::as_bool) != Some(false) {
        return Err(invalid(path, "the setup of the instance is not finished."));
    }
    let database_url = match table.get("databaseUrl").and_then(toml::Value::as_str) {
        Some(url) if url.starts_with("postgres://") || url.starts_with("postgresql://") => {
            url.to_owned()
        }
        _ => return Err(invalid(path, "\"databaseUrl\" must be a postgres:// URL.")),
    };
    let secret = match table.get("pagesCoreSecret").and_then(toml::Value::as_str) {
        Some(secret) if is_valid_secret(secret) => secret.to_owned(),
        _ => {
            return Err(invalid(
                path,
                "\"pagesCoreSecret\" must hold 32 to 512 visible ASCII characters.",
            ));
        }
    };
    Ok(InstanceConfig {
        database_url,
        secret,
    })
}

/// The same rule as `readPagesCoreSecret` of `pages-api`.
fn is_valid_secret(secret: &str) -> bool {
    (MINIMUM_SECRET_LENGTH..=MAXIMUM_SECRET_LENGTH).contains(&secret.len())
        && secret.bytes().all(|byte| byte.is_ascii_graphic())
}

/// Where Pica Mobile is served while the core relays it (PAGE-239).
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MobileTarget {
    /// The app's address: `listenAddress` (every interface without it) and `picaMobilePort`.
    pub listen: SocketAddr,
    /// The loopback port of the API's relay listener, `picaMobileRelayPort`.
    pub relay_port: u16,
}

fn read_port(table: &toml::Table, key: &str) -> Option<u16> {
    table
        .get(key)
        .and_then(toml::Value::as_integer)
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
}

/// Reads the Pica Mobile relay switch of the instance.
///
/// Returns `None` while the switch is off: no finished setup, no
/// `picaMobileRelayPort` or no `picaMobilePort` (the endpoint itself is off).
///
/// # Errors
///
/// Returns a [`ConfigError`] when the file cannot be read or parsed, or
/// when `listenAddress` is no IP address; the caller keeps its current state.
pub fn read_mobile_target(path: &Path) -> Result<Option<MobileTarget>, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|_| invalid(path, "it cannot be read."))?;
    let table = text
        .parse::<toml::Table>()
        .map_err(|_| invalid(path, "it is no valid TOML."))?;
    if table.get("firstRun").and_then(toml::Value::as_bool) != Some(false) {
        return Ok(None);
    }
    let (Some(port), Some(relay_port)) = (
        read_port(&table, "picaMobilePort"),
        read_port(&table, "picaMobileRelayPort"),
    ) else {
        return Ok(None);
    };
    let address = match table.get("listenAddress").and_then(toml::Value::as_str) {
        // Every interface, IPv4 included, as the API listens without an address.
        None => IpAddr::V6(Ipv6Addr::UNSPECIFIED),
        Some(text) => text
            .parse::<IpAddr>()
            .map_err(|_| invalid(path, "\"listenAddress\" is no IP address."))?,
    };
    Ok(Some(MobileTarget {
        listen: SocketAddr::new(address, port),
        relay_port,
    }))
}
