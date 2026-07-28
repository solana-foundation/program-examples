# Anchor 1.0.0-rc.5 Migration Reference

## Proven pattern (from basics/counter/anchor)

### Cargo.toml

- Change `anchor-lang = "0.32.1"` → `anchor-lang = "1.0.0-rc.5"`
- Change `anchor-lang = { version = "0.32.1", ... }` → `anchor-lang = { version = "1.0.0-rc.5", ... }`
- Same for `anchor-spl` if present — change to `1.0.0-rc.5`
- Add comment: `# Anchor 1.0.0-rc.5 — pin to RC until stable release`
- **REMOVE `interface-instructions` feature** if present (removed in Anchor 1.0). This affects transfer-hook projects.
- Keep all other features as-is (`idl-build`, `init-if-needed`, `cpi`, etc.)

### Anchor.toml

- Remove `[registry]` section if present (no longer used in Anchor 1.0)
- Keep everything else

### package.json

- Replace `"@coral-xyz/anchor": "..."` with `"@anchor-lang/core": "1.0.0-rc.5"`
- Bump `"typescript"` to `"^5.3.3"` if it's on 4.x (required for @solana/web3.js peer dep)
- Keep everything else

### TypeScript files (tests/_.ts, migrations/_.ts)

- Replace `import ... from "@coral-xyz/anchor"` → `import ... from "@anchor-lang/core"`
- Replace `import ... from '@coral-xyz/anchor'` → `import ... from '@anchor-lang/core'`
- Replace `require("@coral-xyz/anchor")` → `require("@anchor-lang/core")` if any

### Rust source code (lib.rs etc.)

- Usually NO changes needed
- If `AccountInfo` is used in an Accounts struct, replace with `UncheckedAccount`
- If duplicate mutable accounts exist, add `#[account(dup)]` constraint

### Build verification

- Run `cargo build-sbf` in the anchor project directory to verify Rust builds
- Run `pnpm install` to verify deps install
- Do NOT run tests (no validator available)

### interface-instructions removal (transfer-hook projects)

For projects that had `features = ["interface-instructions"]`:

- Remove that feature from Cargo.toml
- The `#[interface]` attribute is removed — check if the program source uses it
- If it does, this needs manual intervention to refactor
