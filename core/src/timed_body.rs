//! A streamed HTTP body with an idle limit and a lifetime (PAGE-239).
//!
//! The attachment requests of Pica Mobile pass through the core unbuffered,
//! frame by frame. A body that stops moving, or one that trickles for too
//! long, ends with an error, so neither a stuck app nor a stuck API holds a
//! connection of the core forever.

use std::error::Error;
use std::fmt;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use bytes::Bytes;
use hyper::body::{Body, Frame, SizeHint};
use tokio::sync::oneshot;
use tokio::time::{Instant, Sleep, sleep};

/// A body error of the core: the body stood still or lived too long.
#[derive(Debug)]
pub struct BodyTimeout;

impl fmt::Display for BodyTimeout {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("body timeout")
    }
}

impl Error for BodyTimeout {}

/// How long a body may wait for its next frame, and live at most.
#[derive(Clone, Copy)]
pub struct BodyLimits {
    /// The longest time between two frames.
    pub idle: Duration,
    /// The longest time from wrapping the body to its end.
    pub lifetime: Duration,
}

/// A body that ends with [`BodyTimeout`] when it exceeds its [`BodyLimits`].
pub struct TimedBody<B> {
    inner: B,
    idle_limit: Duration,
    idle: Pin<Box<Sleep>>,
    lifetime: Pin<Box<Sleep>>,
    finished: Option<oneshot::Sender<()>>,
    /// The body reached its end in time; it stays ended, also after the lifetime.
    is_complete: bool,
}

impl<B: Body + Unpin> TimedBody<B> {
    /// Wraps a body; `finished` is told once the body was read to its end.
    pub fn new(inner: B, limits: BodyLimits, finished: Option<oneshot::Sender<()>>) -> Self {
        let mut body = Self {
            inner,
            idle_limit: limits.idle,
            idle: Box::pin(sleep(limits.idle)),
            lifetime: Box::pin(sleep(limits.lifetime)),
            finished,
            is_complete: false,
        };
        // An empty body may never be read; it is complete from the start.
        if body.inner.is_end_stream() {
            body.finish();
        }
        body
    }

    fn finish(&mut self) {
        self.is_complete = true;
        if let Some(finished) = self.finished.take() {
            let _ = finished.send(());
        }
    }
}

impl<B> Body for TimedBody<B>
where
    B: Body<Data = Bytes> + Unpin,
    B::Error: Into<Box<dyn Error + Send + Sync>>,
{
    type Data = Bytes;
    type Error = Box<dyn Error + Send + Sync>;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        let this = &mut *self;
        if this.is_complete {
            return Poll::Ready(None);
        }
        // The lifetime is absolute: a frame that is ready only after it ran
        // out does not pass. The clock decides, because the timer may not
        // have fired yet when the inner body never waits.
        if Instant::now() >= this.lifetime.deadline() {
            return Poll::Ready(Some(Err(Box::new(BodyTimeout))));
        }
        match Pin::new(&mut this.inner).poll_frame(context) {
            Poll::Ready(Some(Ok(frame))) => {
                let next = Instant::now() + this.idle_limit;
                this.idle.as_mut().reset(next);
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(error))) => Poll::Ready(Some(Err(error.into()))),
            Poll::Ready(None) => {
                this.finish();
                Poll::Ready(None)
            }
            Poll::Pending => {
                let is_late = this.lifetime.as_mut().poll(context).is_ready()
                    || this.idle.as_mut().poll(context).is_ready();
                if is_late {
                    Poll::Ready(Some(Err(Box::new(BodyTimeout))))
                } else {
                    Poll::Pending
                }
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}
