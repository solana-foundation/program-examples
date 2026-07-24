//! Reads the generated IDL so tests can assert on-chain account requirements
//! (writable/signer flags) match what the program enforces.

const IDL: &str = include_str!("../../../../idl/gacha.json");

pub struct IdlAccount {
    pub index: usize,
    pub name: String,
    pub is_writable: bool,
    pub is_signer: bool,
}

/// The ordered account metas the IDL declares for an instruction.
pub fn instruction_accounts(instruction: &str) -> Vec<IdlAccount> {
    let value: serde_json::Value = serde_json::from_str(IDL).expect("valid IDL json");
    let program = value.get("program").unwrap_or(&value);
    let instructions = program["instructions"].as_array().expect("instructions array");
    let ix = instructions
        .iter()
        .find(|i| i["name"].as_str() == Some(instruction))
        .unwrap_or_else(|| panic!("instruction {instruction} not in IDL"));
    ix["accounts"]
        .as_array()
        .expect("accounts array")
        .iter()
        .enumerate()
        .map(|(index, a)| IdlAccount {
            index,
            name: a["name"].as_str().unwrap_or_default().to_string(),
            is_writable: a.get("isWritable").and_then(|v| v.as_bool()).unwrap_or(false),
            is_signer: a.get("isSigner").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect()
}
