use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct WorkInfo {
    pub name: String,
    pub position: String,
    pub company: String,
    pub years_employed: u8,
}

impl WorkInfo {
    pub fn new(name: String, position: String, company: String, years_employed: u8) -> Self {
        WorkInfo { name, position, company, years_employed }
    }
}
