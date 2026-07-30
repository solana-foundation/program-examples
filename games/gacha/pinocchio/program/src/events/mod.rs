//! Event types emitted by the gacha program via self-CPI.
//!
//! Each event struct implements [`EventDiscriminator`](crate::event_engine::EventDiscriminator)
//! and [`EventSerialize`](crate::event_engine::EventSerialize): an 8-byte tag prefix,
//! a 1-byte discriminator, then the event-specific payload.

pub mod fees_withdrawn;
pub mod pool_initialized;
pub mod prize_claimed;
pub mod pull_refunded;
pub mod pull_requested;
pub mod pull_settled;

pub use fees_withdrawn::FeesWithdrawnEvent;
pub use pool_initialized::PoolInitializedEvent;
pub use prize_claimed::PrizeClaimedEvent;
pub use pull_refunded::PullRefundedEvent;
pub use pull_requested::PullRequestedEvent;
pub use pull_settled::PullSettledEvent;
