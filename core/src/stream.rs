//! The response body of one open SSE stream.

use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use hyper::body::{Body, Frame};
use tokio::sync::mpsc;

use crate::dispatcher::Command;

/// Frames for one browser; dropping it tells the dispatcher the stream is gone.
pub struct LiveBody {
    connection: u64,
    frames: mpsc::Receiver<Bytes>,
    commands: mpsc::UnboundedSender<Command>,
}

impl LiveBody {
    /// Creates the body of an accepted stream.
    pub fn new(
        connection: u64,
        frames: mpsc::Receiver<Bytes>,
        commands: mpsc::UnboundedSender<Command>,
    ) -> Self {
        Self {
            connection,
            frames,
            commands,
        }
    }
}

impl Body for LiveBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        // `None` once the dispatcher dropped the sender: the stream ends cleanly.
        self.frames
            .poll_recv(context)
            .map(|frame| frame.map(|bytes| Ok(Frame::data(bytes))))
    }
}

impl Drop for LiveBody {
    fn drop(&mut self) {
        // A stopped dispatcher needs no notice any more.
        let _ = self.commands.send(Command::Close(self.connection));
    }
}
