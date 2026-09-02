use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

use crate::instructions::{Writer, MPL_BUBBLEGUM_ID};

/// Anchor discriminator of mpl-bubblegum's `mint_to_collection_v1` instruction
/// (`sha256("global:mint_to_collection_v1")[..8]`).
const MINT_TO_COLLECTION_V1_DISCRIMINATOR: [u8; 8] = [153, 18, 178, 47, 197, 158, 86, 15];

/// Name and symbol this example stamps on every cNFT it mints.
const NAME: &[u8] = b"BURGER";
const SYMBOL: &[u8] = b"BURG";

/// Largest URI accepted, matching the limit Token Metadata enforces.
const MAX_URI_LEN: usize = 200;

/// Borsh-encoded size of `MetadataArgs` with everything but the URI filled in:
/// name (4 + 6), symbol (4 + 4), the URI's own length prefix (4), seller fee (2),
/// `primary_sale_happened` and `is_mutable` (1 each), `edition_nonce` and
/// `token_standard` as `Some` (2 each), `collection` as `Some` (1 + 1 + 32),
/// `uses` as `None` (1), token program version (1), and one creator
/// (4 + 32 + 1 + 1).
const METADATA_LEN_WITHOUT_URI: usize = 10 + 8 + 4 + 2 + 1 + 1 + 2 + 2 + 34 + 1 + 1 + 38;

/// Largest CPI payload: the discriminator plus a full-length URI.
const MAX_DATA_LEN: usize = 8 + METADATA_LEN_WITHOUT_URI + MAX_URI_LEN;

/// Number of accounts bubblegum's `MintToCollectionV1` expects.
const CPI_ACCOUNTS: usize = 16;

/// Mints a compressed NFT into a Metaplex collection by CPI'ing into
/// mpl-bubblegum's `MintToCollectionV1`.
///
/// The metadata is fixed apart from the URI, which is the whole of the
/// instruction data — this mirrors the anchor example, whose only parameter is
/// the URI.
///
/// Accounts:
///   0. `[writable]` tree authority (bubblegum's PDA over the merkle tree)
///   1. `[]`         leaf owner — receives the cNFT
///   2. `[]`         leaf delegate
///   3. `[writable]` merkle tree
///   4. `[signer]`   payer
///   5. `[signer]`   tree delegate
///   6. `[signer]`   collection authority
///   7. `[]`         collection authority record PDA (or the bubblegum program)
///   8. `[]`         collection mint
///   9. `[writable]` collection metadata
///   10. `[]`        collection master edition
///   11. `[]`        bubblegum signer
///   12. `[]`        log wrapper (SPL Noop)
///   13. `[]`        SPL Account Compression program
///   14. `[]`        Token Metadata program
///   15. `[]`        mpl-bubblegum program
///   16. `[]`        system program
///
/// Instruction data: the URI, as raw UTF-8 bytes.
pub fn mint(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [tree_authority, leaf_owner, leaf_delegate, merkle_tree, payer, tree_delegate, collection_authority, collection_authority_record_pda, collection_mint, collection_metadata, edition_account, bubblegum_signer, log_wrapper, compression_program, token_metadata_program, _bubblegum_program, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let uri = instruction_data;
    if uri.is_empty() || uri.len() > MAX_URI_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    // The tree authority is bubblegum's PDA over the merkle tree. Bubblegum
    // rederives it too, but checking here fails early with a clear error rather
    // than deep inside the CPI.
    let (expected_authority, _bump) =
        Address::find_program_address(&[merkle_tree.address().as_ref()], &MPL_BUBBLEGUM_ID);
    if tree_authority.address() != &expected_authority {
        return Err(ProgramError::InvalidSeeds);
    }

    // Borsh serializes `MetadataArgs` in field-declaration order.
    let mut buffer = [0u8; MAX_DATA_LEN];
    let mut data = Writer::new(&mut buffer);
    data.write(&MINT_TO_COLLECTION_V1_DISCRIMINATOR);
    data.write_str(NAME);
    data.write_str(SYMBOL);
    data.write_str(uri);
    data.write(&0u16.to_le_bytes()); // seller_fee_basis_points
    data.write(&[0]); // primary_sale_happened: false
    data.write(&[0]); // is_mutable: false
    data.write(&[1, 0]); // edition_nonce: Some(0)
    data.write(&[1, 0]); // token_standard: Some(NonFungible)
    data.write(&[1, 0]); // collection: Some({ verified: false, .. })
    data.write(collection_mint.address().as_ref()); // collection.key
    data.write(&[0]); // uses: None
    data.write(&[0]); // token_program_version: Original
    data.write(&1u32.to_le_bytes()); // creators: one entry
    data.write(collection_authority.address().as_ref()); // creators[0].address
    data.write(&[0]); // creators[0].verified: false
    data.write(&[100]); // creators[0].share
    let written = data.written();

    let metas: [InstructionAccount; CPI_ACCOUNTS] = [
        InstructionAccount::writable(tree_authority.address()),
        InstructionAccount::readonly(leaf_owner.address()),
        InstructionAccount::readonly(leaf_delegate.address()),
        InstructionAccount::writable(merkle_tree.address()),
        InstructionAccount::readonly_signer(payer.address()),
        InstructionAccount::readonly_signer(tree_delegate.address()),
        InstructionAccount::readonly_signer(collection_authority.address()),
        InstructionAccount::readonly(collection_authority_record_pda.address()),
        InstructionAccount::readonly(collection_mint.address()),
        InstructionAccount::writable(collection_metadata.address()),
        InstructionAccount::readonly(edition_account.address()),
        InstructionAccount::readonly(bubblegum_signer.address()),
        InstructionAccount::readonly(log_wrapper.address()),
        InstructionAccount::readonly(compression_program.address()),
        InstructionAccount::readonly(token_metadata_program.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let account_views: [AccountView; CPI_ACCOUNTS] = [
        *tree_authority,
        *leaf_owner,
        *leaf_delegate,
        *merkle_tree,
        *payer,
        *tree_delegate,
        *collection_authority,
        *collection_authority_record_pda,
        *collection_mint,
        *collection_metadata,
        *edition_account,
        *bubblegum_signer,
        *log_wrapper,
        *compression_program,
        *token_metadata_program,
        *system_program,
    ];

    invoke::<CPI_ACCOUNTS, _>(
        &InstructionView { program_id: &MPL_BUBBLEGUM_ID, accounts: &metas, data: &buffer[..written] },
        &account_views,
    )
}
