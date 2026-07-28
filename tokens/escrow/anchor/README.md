# Anchor Escrow

## Introduction

This Solana program is called an **_escrow_** - it allows a user to swap a specific amount of one token for a desired amount of another token.

For example, Alice is offering 10 USDC, and wants 100 WIF in return.

Without our program, users would have to engage in manual token swapping. Imagine the potential problems if Bob promised to send Alice 100 WIF, but instead took the 10 USDC and ran? Or what if Alice was dishonest, received the 10 USDC from Bob, and decided not to send the 100 WIF? Our Escrow program handles these complexities by acting a trusted entity that will only release tokens to both parties at the right time.

Our Escrow program is designed to provide a secure environment for users to swap a specific amount of one token with a specific amount of another token without having to trust each other.

Better yet, since our program allows Alice and Bob to transact directly with each other, they both get a hundred percent of the token they desire!

## Usage

`anchor test`, `anchor deploy` etc.

## Credit

This project is based on [Dean Little's Anchor Escrow,](https://github.com/deanmlittle/anchor-escrow-2024) with a few changes to make discussion in class easier.

### Changes from original

One of the challenges when teaching is avoiding ambiguity — names have to be carefully chosen to be clear and not possible to confuse with other times.

- Custom instructions were replaced by `@solana-developers/helpers` for many tasks to reduce the file size.
- Shared functionality to transfer tokens is now in `instructions/shared.rs`
- The upstream project has a custom file layout. We use the 'multiple files' Anchor layout.
- Contexts are separate data structures from functions that use the contexts. There is no need for OO-like `impl` patterns here - there's no mutable state stored in the Context, and the 'methods' do not mutate that state. Besides, it's easier to type!
- The name 'deposit' was being used in multiple contexts, and `deposit` can be tough because it's a verb and a noun:

    - Renamed deposit #1 -> 'token_a_offered_amount'
    - Renamed deposit #2 (in make() ) -> 'send_offered_tokens_to_vault'
    - Renamed deposit #3 (in take() ) -> 'send_wanted_tokens_to_maker'

- 'seed' was renamed to 'id' because 'seed' as it conflicted with the 'seeds' used for PDA address generation.
- 'Escrow' was used for the program's name and the account that records details of the offer. This wasn't great because people would confuse 'Escrow' with the 'Vault'.

    - Escrow (the program) -> remains Escrow
    - Escrow (the offer) -> Offer.

- 'receive' was renamed to 'token_b_wanted_amount' as 'receive' is a verb and not a suitable name for an integer.
- mint_a -> token_mint_a (ie, what the maker has offered and what the taker wants)
- mint_b -> token_mint_b (ie, what that maker wants and what the taker must offer)
- makerAtaA -> makerTokenAccountA,
- makerAtaB -> makerTokenAccountB
- takerAtaA -> takerTokenAccountA
- takerAtaB -> takerTokenAccountB
