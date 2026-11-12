use solana_signer::Signer;

use crate::{
    tests::{
        asserts::TransactionResultExt,
        utils::{
            chalk_bracket, chalk_bracket_wrong_third, finalize, funded_keypair, init_config, lock,
            post_full_chalk_oracle, read_config, refresh_score, set_unix_timestamp, setup, submit_bracket, LOCK_TS,
        },
    },
    TournamentState, WorldCupError,
};

/// Two entrants: `winner` plays perfect chalk (88), `runner_up` misses only the
/// third-place game (80). Returns both keypairs with the oracle fully posted.
fn two_entrant_tournament(
    litesvm: &mut litesvm::LiteSVM,
    admin: &solana_keypair::Keypair,
) -> (solana_keypair::Keypair, solana_keypair::Keypair) {
    init_config(litesvm, admin, LOCK_TS).assert_ok();

    let winner = funded_keypair(litesvm);
    let runner_up = funded_keypair(litesvm);
    submit_bracket(litesvm, &winner, &chalk_bracket(), 87).0.assert_ok();
    submit_bracket(litesvm, &runner_up, &chalk_bracket_wrong_third(), 87).0.assert_ok();

    set_unix_timestamp(litesvm, LOCK_TS);
    lock(litesvm, admin).assert_ok();
    post_full_chalk_oracle(litesvm, admin, 87);
    (winner, runner_up)
}

#[test]
fn finalize_records_unique_winner() {
    let (mut litesvm, admin) = setup();
    let (winner, runner_up) = two_entrant_tournament(&mut litesvm, &admin);

    let cranker = funded_keypair(&mut litesvm);
    refresh_score(&mut litesvm, &cranker, &winner.pubkey()).assert_ok();
    refresh_score(&mut litesvm, &cranker, &runner_up.pubkey()).assert_ok();

    let view = read_config(&litesvm);
    assert_eq!(view.best_score, 88);
    assert_eq!(view.best_index, 0, "winner is the first submission");

    finalize(&mut litesvm, &admin, &winner.pubkey()).assert_ok();

    let view = read_config(&litesvm);
    assert_eq!(view.state, TournamentState::Finalized as u8);
    assert_eq!(view.winner, winner.pubkey().to_bytes());
}

#[test]
fn finalize_with_a_non_winning_bracket_fails() {
    let (mut litesvm, admin) = setup();
    let (winner, runner_up) = two_entrant_tournament(&mut litesvm, &admin);

    let cranker = funded_keypair(&mut litesvm);
    refresh_score(&mut litesvm, &cranker, &winner.pubkey()).assert_ok();
    refresh_score(&mut litesvm, &cranker, &runner_up.pubkey()).assert_ok();

    // runner_up scored 80, the best is 88, cannot be finalized as the winner.
    finalize(&mut litesvm, &admin, &runner_up.pubkey()).assert_err(WorldCupError::BracketNotBest);
}

#[test]
fn finalize_requires_every_bracket_refreshed() {
    let (mut litesvm, admin) = setup();
    let (winner, _runner_up) = two_entrant_tournament(&mut litesvm, &admin);

    let cranker = funded_keypair(&mut litesvm);
    // Only one of the two brackets refreshed.
    refresh_score(&mut litesvm, &cranker, &winner.pubkey()).assert_ok();

    finalize(&mut litesvm, &admin, &winner.pubkey()).assert_err(WorldCupError::NotFullyRefreshed);
}

#[test]
fn finalize_requires_complete_oracle() {
    let (mut litesvm, admin) = setup();
    init_config(&mut litesvm, &admin, LOCK_TS).assert_ok();

    let entrant = funded_keypair(&mut litesvm);
    submit_bracket(&mut litesvm, &entrant, &chalk_bracket(), 87).0.assert_ok();
    set_unix_timestamp(&mut litesvm, LOCK_TS);
    lock(&mut litesvm, &admin).assert_ok();

    // No results posted at all.
    finalize(&mut litesvm, &admin, &entrant.pubkey()).assert_err(WorldCupError::OracleNotComplete);
}

#[test]
fn earliest_submission_breaks_an_otherwise_identical_key() {
    let (mut litesvm, admin) = setup();
    init_config(&mut litesvm, &admin, LOCK_TS).assert_ok();

    let first = funded_keypair(&mut litesvm);
    let second = funded_keypair(&mut litesvm);
    // Identical brackets and identical tiebreaker: only submission order separates them.
    submit_bracket(&mut litesvm, &first, &chalk_bracket(), 87).0.assert_ok();
    submit_bracket(&mut litesvm, &second, &chalk_bracket(), 87).0.assert_ok();

    set_unix_timestamp(&mut litesvm, LOCK_TS);
    lock(&mut litesvm, &admin).assert_ok();
    post_full_chalk_oracle(&mut litesvm, &admin, 87);

    let cranker = funded_keypair(&mut litesvm);
    // Refresh out of submission order to prove the fold is order-independent.
    refresh_score(&mut litesvm, &cranker, &second.pubkey()).assert_ok();
    refresh_score(&mut litesvm, &cranker, &first.pubkey()).assert_ok();

    assert_eq!(read_config(&litesvm).best_index, 0, "the earlier submission holds the best key");

    // The later submitter cannot finalize; the earlier one can.
    finalize(&mut litesvm, &admin, &second.pubkey()).assert_err(WorldCupError::BracketNotBest);
    finalize(&mut litesvm, &admin, &first.pubkey()).assert_ok();
    assert_eq!(read_config(&litesvm).winner, first.pubkey().to_bytes());
}
