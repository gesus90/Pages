//! Reads `pages_event_outbox` and stores the core's reader position.
//!
//! These are the only statements of `pages-core`: the outbox, its retention
//! floor and the reader position, never a business table. Positions become
//! visible in commit order (migration 015), so continuing after the highest
//! position read never skips a later commit.

use std::time::Duration;

use tokio_postgres::{Client, Config, IsolationLevel, NoTls, Row};

use crate::contract::{EventAudience, OutboxEvent};
use crate::log::{self, Severity};

/// The fixed reader name of the core in `pages_event_outbox_readers`.
const READER: &str = "pages-core";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

const READ_FLOOR: &str = "
    SELECT
        COALESCE(MAX(pruned_through), 0) AS pruned_through
    FROM pages_event_outbox_floor;
";

const READ_AFTER: &str = "
    SELECT
        position,
        kind,
        object_id,
        audience_project_id,
        ARRAY(SELECT jsonb_array_elements_text(audience_department_ids::jsonb))
    FROM pages_event_outbox
    WHERE position > $1
    ORDER BY position
    LIMIT $2;
";

const READ_HEAD: &str = "
    SELECT
        COALESCE(MAX(position), 0) AS head
    FROM pages_event_outbox;
";

const READ_READER_POSITION: &str = "
    SELECT
        position
    FROM pages_event_outbox_readers
    WHERE reader = $1;
";

const SAVE_READER_POSITION: &str = "
    INSERT INTO pages_event_outbox_readers (
        reader,
        position
    )
    VALUES (
        $1,
        $2
    )
    ON CONFLICT (reader) DO UPDATE
    SET position = EXCLUDED.position,
        updated_at = clock_timestamp();
";

/// Events read on one snapshot together with the retention floor.
pub struct OutboxBatch {
    /// Oldest first.
    pub events: Vec<OutboxEvent>,
    /// The highest position retention removed, `0` when it removed nothing.
    pub pruned_through: u64,
}

/// A failed outbox statement; the connection is opened again on the next use.
#[derive(Debug)]
pub enum OutboxError {
    /// PostgreSQL refused a statement or the connection failed.
    Database(tokio_postgres::Error),
    /// No connection is open.
    NotConnected,
}

impl std::fmt::Display for OutboxError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Only the SQLSTATE is named: a connection error can quote the host.
        match self {
            Self::Database(error) => match error.code() {
                Some(code) => write!(formatter, "sqlstate_{}", code.code()),
                None => formatter.write_str("connection"),
            },
            Self::NotConnected => formatter.write_str("not_connected"),
        }
    }
}

impl From<tokio_postgres::Error> for OutboxError {
    fn from(error: tokio_postgres::Error) -> Self {
        Self::Database(error)
    }
}

/// One connection to the instance's PostgreSQL, opened on demand.
pub struct Outbox {
    config: Config,
    client: Option<Client>,
}

fn position_of(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn database_position(position: u64) -> i64 {
    i64::try_from(position).unwrap_or(i64::MAX)
}

fn read_event(row: &Row) -> Result<OutboxEvent, tokio_postgres::Error> {
    let project_id: Option<String> = row.try_get(3)?;
    let department_ids: Vec<String> = row.try_get(4)?;
    Ok(OutboxEvent {
        position: position_of(row.try_get(0)?),
        kind: row.try_get(1)?,
        id: row.try_get(2)?,
        audience: project_id.map(|project_id| EventAudience {
            project_id,
            department_ids,
        }),
    })
}

impl Outbox {
    /// Prepares the connection settings without connecting.
    ///
    /// # Errors
    ///
    /// Returns an error when the URL is no valid PostgreSQL connection string.
    pub fn new(database_url: &str) -> Result<Self, tokio_postgres::Error> {
        let mut config: Config = database_url.parse()?;
        config.application_name("pages-core");
        config.connect_timeout(CONNECT_TIMEOUT);
        // Bounded statements: a stuck read must not hold the delivery forever.
        config.options("-c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000");
        Ok(Self {
            config,
            client: None,
        })
    }

    async fn client(&mut self) -> Result<&mut Client, OutboxError> {
        let is_usable = self
            .client
            .as_ref()
            .is_some_and(|client| !client.is_closed());
        if !is_usable {
            let (client, connection) = self.config.connect(NoTls).await?;
            tokio::spawn(async move {
                if let Err(error) = connection.await {
                    log::record(
                        Severity::Warn,
                        "core.outbox.connection_closed",
                        "The PostgreSQL connection ended",
                        serde_json::json!({ "code": OutboxError::Database(error).to_string() }),
                    );
                }
            });
            self.client = Some(client);
        }
        self.client.as_mut().ok_or(OutboxError::NotConnected)
    }

    /// Reads committed events after a position, oldest first, with the floor of the same snapshot.
    ///
    /// # Errors
    ///
    /// Returns an [`OutboxError`] when PostgreSQL cannot answer.
    pub async fn read_after(&mut self, after: u64, limit: i64) -> Result<OutboxBatch, OutboxError> {
        self.read_snapshot(after, limit).await
    }

    async fn read_snapshot(&mut self, after: u64, limit: i64) -> Result<OutboxBatch, OutboxError> {
        let client = self.client().await?;
        let transaction = client
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .await?;
        let floor = transaction.query_one(READ_FLOOR, &[]).await?;
        let rows = transaction
            .query(READ_AFTER, &[&database_position(after), &limit])
            .await?;
        transaction.commit().await?;
        let events = rows.iter().map(read_event).collect::<Result<Vec<_>, _>>()?;
        Ok(OutboxBatch {
            events,
            pruned_through: position_of(floor.try_get(0)?),
        })
    }

    /// Returns the highest position in the outbox, `0` when it is empty.
    ///
    /// # Errors
    ///
    /// Returns an [`OutboxError`] when PostgreSQL cannot answer.
    pub async fn head(&mut self) -> Result<u64, OutboxError> {
        let row = self.client().await?.query_one(READ_HEAD, &[]).await?;
        Ok(position_of(row.try_get(0)?))
    }

    /// Returns the stored position of the core, `None` before its first start.
    ///
    /// # Errors
    ///
    /// Returns an [`OutboxError`] when PostgreSQL cannot answer.
    pub async fn reader_position(&mut self) -> Result<Option<u64>, OutboxError> {
        let row = self
            .client()
            .await?
            .query_opt(READ_READER_POSITION, &[&READER])
            .await?;
        match row {
            Some(row) => Ok(Some(position_of(row.try_get(0)?))),
            None => Ok(None),
        }
    }

    /// Stores the highest position the core read; retention keeps everything after it.
    ///
    /// # Errors
    ///
    /// Returns an [`OutboxError`] when PostgreSQL cannot answer.
    pub async fn save_reader_position(&mut self, position: u64) -> Result<(), OutboxError> {
        self.client()
            .await?
            .execute(
                SAVE_READER_POSITION,
                &[&READER, &database_position(position)],
            )
            .await?;
        Ok(())
    }

    /// Forgets the connection after a failure, so the next use opens a new one.
    pub fn reset(&mut self) {
        self.client = None;
    }
}
