//! Codama IDL build script.

use {
    codama::Codama,
    std::{env, fs, path::Path},
};

fn main() {
    println!("cargo:rerun-if-changed=src/");
    println!("cargo:rerun-if-env-changed=GENERATE_IDL");

    if let Err(e) = generate_idl() {
        println!("cargo:warning=Failed to generate IDL: {}", e)
    }
}

fn generate_idl() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let crate_path = Path::new(&manifest_dir).join("src");
    let codama = Codama::load(&crate_path)?;
    let idl_json = codama.get_json_idl()?;

    let mut parsed: serde_json::Value = serde_json::from_str(&idl_json)?;
    if let Some(program) = parsed.get_mut("program").and_then(serde_json::Value::as_object_mut) {
        program.insert("name".to_string(), serde_json::Value::String("gacha".to_string()));
    }
    let mut formatted_json = serde_json::to_string_pretty(&parsed)?;
    formatted_json.push('\n');

    let project_root = Path::new(&manifest_dir).parent().unwrap();
    let idl_dir = project_root.join("idl");
    fs::create_dir_all(&idl_dir)?;
    let idl_path = idl_dir.join("gacha.json");
    fs::write(&idl_path, formatted_json)?;

    println!("cargo:warning=IDL written to: {}", idl_path.display());
    Ok(())
}
