//! Opt-in compute-unit tracking. Enable with `CU_REPORT=1 cargo test`; the minimum
//! CU observed per instruction is written to `cu_report.md`. Off by default (and in
//! CI), so it adds no overhead to normal runs.

use std::{
    collections::BTreeMap,
    fs,
    sync::{Mutex, OnceLock},
};

fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("CU_REPORT").is_ok())
}

fn tracker() -> &'static Mutex<BTreeMap<String, u64>> {
    static TRACKER: OnceLock<Mutex<BTreeMap<String, u64>>> = OnceLock::new();
    TRACKER.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Records the minimum compute units seen for an instruction.
pub fn record_cu(instruction: &str, cus: u64) {
    if !enabled() {
        return;
    }
    let mut map = tracker().lock().unwrap();
    let entry = map.entry(instruction.to_string()).or_insert(u64::MAX);
    if cus < *entry {
        *entry = cus;
    }
    let mut out = String::from("# Compute Unit Report\n\n| Instruction | Min CU |\n| --- | --- |\n");
    for (name, cu) in map.iter() {
        out.push_str(&format!("| {name} | {cu} |\n"));
    }
    let _ = fs::write("cu_report.md", out);
}
