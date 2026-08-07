use std::string::String;

use litesvm::types::{FailedTransactionMetadata, TransactionMetadata, TransactionResult};
use solana_instruction::error::InstructionError;
use solana_transaction_error::TransactionError;

use crate::errors::GachaError;

pub trait TransactionResultExt {
    /// Assert the transaction succeeded and return its metadata.
    fn assert_ok(self) -> TransactionMetadata;

    /// Assert the transaction failed with the expected program error.
    fn assert_err(self, expected: GachaError);
}

impl TransactionResultExt for TransactionResult {
    fn assert_ok(self) -> TransactionMetadata {
        match self {
            Ok(meta) => meta,
            Err(failed_tx) => panic!(
                "Expected transaction to succeed, but got: {}\nLogs:\n{}",
                format_error(&failed_tx),
                failed_tx.meta.logs.join("\n")
            ),
        }
    }

    fn assert_err(self, expected: GachaError) {
        match self {
            Ok(_) => panic!("Expected transaction to fail with {:?}", expected),
            Err(failed_tx) => {
                let expected_err = TransactionError::InstructionError(0, InstructionError::Custom(expected as u32));
                if failed_tx.err != expected_err {
                    panic!(
                        "Expected {:?}, got: {}\nLogs:\n{}",
                        expected,
                        format_error(&failed_tx),
                        failed_tx.meta.logs.join("\n")
                    );
                }
            }
        }
    }
}

fn format_error(failed_tx: &FailedTransactionMetadata) -> String {
    match &failed_tx.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => format!("Custom error code: {}", code),
        other => format!("{:?}", other),
    }
}
