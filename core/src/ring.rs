//! The newest outbox events in memory: a cache, never the bound of a replay.
//!
//! A stream whose cursor lies below the cache is answered from the outbox
//! itself (`Outbox::read_after`); only the retention floor of the outbox can
//! end a replay, with an explicit resync.

use std::collections::VecDeque;

use crate::contract::OutboxEvent;

/// The newest outbox events, complete after a floor position.
///
/// Every event with a position above `floor` and up to `tail` is present.
pub struct EventRing {
    events: VecDeque<OutboxEvent>,
    capacity: usize,
    floor: u64,
    tail: u64,
}

impl EventRing {
    /// Creates an empty cache that continues after `position`.
    pub fn new(position: u64, capacity: usize) -> Self {
        Self {
            events: VecDeque::new(),
            capacity,
            floor: position,
            tail: position,
        }
    }

    /// Every event up to this position was read from the outbox.
    pub fn tail(&self) -> u64 {
        self.tail
    }

    /// Events at or below this position may be missing from the cache.
    pub fn floor(&self) -> u64 {
        self.floor
    }

    /// Adds events read after the tail, oldest first; the oldest leave beyond the capacity.
    pub fn append(&mut self, events: Vec<OutboxEvent>) {
        for event in events {
            if event.position <= self.tail {
                continue;
            }
            self.tail = event.position;
            self.events.push_back(event);
            if self.events.len() > self.capacity {
                if let Some(dropped) = self.events.pop_front() {
                    self.floor = dropped.position;
                }
            }
        }
    }

    /// Forgets everything at or below a floor retention removed beyond the tail.
    pub fn raise_floor(&mut self, floor: u64) {
        if floor <= self.floor {
            return;
        }
        while self
            .events
            .front()
            .is_some_and(|event| event.position <= floor)
        {
            self.events.pop_front();
        }
        self.floor = floor;
        self.tail = self.tail.max(floor);
    }

    /// The events after a cursor at or above the floor, oldest first, at most `limit` of them.
    pub fn after(&self, cursor: u64, limit: usize) -> Vec<OutboxEvent> {
        let start = self
            .events
            .partition_point(|event| event.position <= cursor);
        self.events.range(start..).take(limit).cloned().collect()
    }
}
