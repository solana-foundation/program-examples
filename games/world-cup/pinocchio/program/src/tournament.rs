//! Pure tournament logic: bracket tree topology, scoring, and consistency rules.
//!
//! Runtime-independent and `no_std`-friendly so it can be unit-tested on the host.
//! The bracket is a perfect binary tree stored leaves-first (Round of 32 at indices
//! `0..=15`), plus a third-place playoff at index `31` contested by the two semifinal
//! losers. Real-world team names are a client concern, on-chain a team is just a
//! positional id `0..32`.

use crate::WorldCupError;

/// Total games: 31 knockout games + the third-place playoff.
pub const GAME_COUNT: usize = 32;

/// Number of competing teams (positional identities `0..32`).
pub const TEAM_COUNT: u8 = 32;

/// `decided_mask`/`tally_mask` value once all 32 games are recorded.
pub const ALL_DECIDED: u32 = u32::MAX;

/// Sentinel for an undecided game result in the oracle.
pub const UNDECIDED: u8 = 0xFF;

/// Index of the third-place playoff game.
pub const THIRD_PLACE_GAME: u8 = 31;

/// Round a game belongs to. Derived from the game index, never stored.
#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u8)]
pub enum Round {
    R32 = 0,
    R16 = 1,
    Qf = 2,
    Sf = 3,
    Final = 4,
    ThirdPlace = 5,
}

/// Per-round score weight (classic doubling); the third-place playoff is a bonus
/// game weighted like a semifinal. Index by `round_of(game) as usize`.
pub const ROUND_WEIGHT: [u16; 6] = [1, 2, 4, 8, 16, 8];

/// The round a game index belongs to.
#[inline]
pub fn round_of(game: u8) -> Round {
    match game {
        0..=15 => Round::R32,
        16..=23 => Round::R16,
        24..=27 => Round::Qf,
        28..=29 => Round::Sf,
        30 => Round::Final,
        31 => Round::ThirdPlace,
        _ => Round::Final,
    }
}

/// The two feeder games for a non-leaf knockout game (`g` in `16..=30`).
#[inline]
pub fn children(g: u8) -> (u8, u8) {
    let base = (g - 16) * 2;
    (base, base + 1)
}

/// The two team slots contesting a Round-of-32 game (`g` in `0..=15`).
#[inline]
pub fn r32_slots(g: u8) -> (u8, u8) {
    (2 * g, 2 * g + 1)
}

/// The two competitors of the third-place game: the losers of the two semifinals.
///
/// SF game 28 has children `(24,25)`; SF game 29 has children `(26,27)`. The loser
/// of a semifinal is the child winner that the semifinal pick did *not* advance.
/// For any bracket that passes [`validate_bracket`], `slots[24] != slots[25]` and
/// `slots[26] != slots[27]` (winners come from disjoint subtrees), so each loser is
/// unambiguous. Works identically on a picks array or an oracle results array.
#[inline]
pub fn third_place_slots(slots: &[u8; GAME_COUNT]) -> (u8, u8) {
    let loser_28 = if slots[28] == slots[24] { slots[25] } else { slots[24] };
    let loser_29 = if slots[29] == slots[26] { slots[27] } else { slots[26] };
    (loser_28, loser_29)
}

/// Verifies a full bracket is internally consistent: every pick is a team that the
/// bracket itself advanced from one of the game's two feeders.
pub fn validate_bracket(picks: &[u8; GAME_COUNT]) -> Result<(), WorldCupError> {
    for (g, &pick) in picks.iter().enumerate() {
        if pick >= TEAM_COUNT {
            return Err(WorldCupError::InvalidPick);
        }
        let g = g as u8;
        if g < 16 {
            let (a, b) = r32_slots(g);
            if pick != a && pick != b {
                return Err(WorldCupError::InvalidPick);
            }
        } else if g <= 30 {
            let (c0, c1) = children(g);
            if pick != picks[c0 as usize] && pick != picks[c1 as usize] {
                return Err(WorldCupError::InvalidPick);
            }
        } else {
            let (l0, l1) = third_place_slots(picks);
            if pick != l0 && pick != l1 {
                return Err(WorldCupError::InvalidPick);
            }
        }
    }
    Ok(())
}

/// Verifies a single oracle result is consistent with the already-decided feeders,
/// enforcing that feeder games are posted before the games they feed.
///
/// `results` is the current oracle array (with [`UNDECIDED`] for unposted games).
pub fn validate_result(results: &[u8; GAME_COUNT], game: u8, winner: u8) -> Result<(), WorldCupError> {
    if game as usize >= GAME_COUNT {
        return Err(WorldCupError::InvalidGame);
    }
    if winner >= TEAM_COUNT {
        return Err(WorldCupError::InvalidResult);
    }
    if game < 16 {
        let (a, b) = r32_slots(game);
        if winner != a && winner != b {
            return Err(WorldCupError::InvalidResult);
        }
    } else if game <= 30 {
        let (c0, c1) = children(game);
        let f0 = results[c0 as usize];
        let f1 = results[c1 as usize];
        if f0 == UNDECIDED || f1 == UNDECIDED {
            return Err(WorldCupError::FeederNotDecided);
        }
        if winner != f0 && winner != f1 {
            return Err(WorldCupError::InvalidResult);
        }
    } else {
        for feeder in [24u8, 25, 26, 27, 28, 29] {
            if results[feeder as usize] == UNDECIDED {
                return Err(WorldCupError::FeederNotDecided);
            }
        }
        let (l0, l1) = third_place_slots(results);
        if winner != l0 && winner != l1 {
            return Err(WorldCupError::InvalidResult);
        }
    }
    Ok(())
}

/// Sums a bracket's weighted score against the decided games in `results`.
pub fn score_bracket(picks: &[u8; GAME_COUNT], results: &[u8; GAME_COUNT]) -> u16 {
    let mut score = 0u16;
    for g in 0..GAME_COUNT {
        if results[g] != UNDECIDED && picks[g] == results[g] {
            score += ROUND_WEIGHT[round_of(g as u8) as usize];
        }
    }
    score
}

/// Absolute difference between a tiebreaker guess and the actual Round-of-32 goal total.
#[inline]
pub fn closeness(guess: u16, actual: u16) -> u16 {
    guess.abs_diff(actual)
}
