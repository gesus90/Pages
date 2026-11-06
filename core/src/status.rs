//! The service status of the platform (PAGE-238): `GET /service-status` and
//! `GET /service-status/details`, as described in `definition/ServiceStatus.ts`.
//!
//! The public status is one light and needs neither `pages-api` nor a
//! session, so it stays visible while the API is down. The details need an
//! admin session, which `pages-api` confirms for every request over contract
//! v1; without its answer in time there are no details, only the light.

use hyper::StatusCode;
use serde::Serialize;
use serde_json::json;

use crate::decisions::DecisionClient;
use crate::log::{self, Severity};
use crate::units::{Light, ServiceState, UnitReader};

/// The version `definition/ServiceStatus.ts` names.
const STATUS_VERSION: u32 = 1;

#[derive(Serialize)]
struct LightBody {
    version: u32,
    light: Light,
}

#[derive(Serialize)]
struct DetailsBody<'a> {
    version: u32,
    light: Light,
    services: &'a [ServiceState],
}

/// One JSON answer of the status endpoints.
pub struct StatusAnswer {
    /// `200`, or `403` and `503` for details that are not shown.
    pub status: StatusCode,
    /// The JSON body; nothing but the fields of `definition/ServiceStatus.ts`.
    pub body: Vec<u8>,
}

fn light_answer(status: StatusCode, light: Light) -> StatusAnswer {
    let body = serde_json::to_vec(&LightBody {
        version: STATUS_VERSION,
        light,
    })
    .unwrap_or_default();
    StatusAnswer { status, body }
}

/// Serves the status from the manager's reading and the API's access decision.
pub struct StatusService {
    units: UnitReader,
    access: DecisionClient,
}

impl StatusService {
    /// Creates the service.
    pub fn new(units: UnitReader, access: DecisionClient) -> Self {
        Self { units, access }
    }

    /// The light of all services, for everyone.
    pub async fn light(&self) -> StatusAnswer {
        light_answer(StatusCode::OK, self.units.read().await.light)
    }

    /// The services in detail for an admin session; otherwise only the light.
    ///
    /// `403` without a session or for a session that is not granted, `503`
    /// when the API gave no valid answer in time. The decision is never kept.
    pub async fn details(&self, cookie: Option<String>) -> StatusAnswer {
        let Some(cookie) = cookie else {
            return light_answer(StatusCode::FORBIDDEN, self.units.read().await.light);
        };
        let access = self.access.status_access(&cookie).await;
        let snapshot = self.units.read().await;
        match access {
            Ok(true) => {
                let body = serde_json::to_vec(&DetailsBody {
                    version: STATUS_VERSION,
                    light: snapshot.light,
                    services: &snapshot.services,
                })
                .unwrap_or_default();
                StatusAnswer {
                    status: StatusCode::OK,
                    body,
                }
            }
            Ok(false) => light_answer(StatusCode::FORBIDDEN, snapshot.light),
            Err(error) => {
                log::record(
                    Severity::Warn,
                    "core.status.access_failed",
                    "pages-api did not decide about the service status details",
                    json!({ "code": error.to_string() }),
                );
                light_answer(StatusCode::SERVICE_UNAVAILABLE, snapshot.light)
            }
        }
    }
}
