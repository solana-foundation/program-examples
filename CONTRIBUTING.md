# Contributing

Thank you for considering contributing to the Solana Program Examples repository. These examples are a teaching resource: every one of them should be small enough to read in one sitting, runnable standalone, and correct enough that someone can copy it into their own project.

We believe that a welcoming and inclusive environment fosters collaboration and encourages participation from developers of all backgrounds and skill levels.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For substantial changes, such as a new example or a new framework flavor, open an issue or discussion first so maintainers can confirm the approach. Small PRs are preferred.
- Do not include secrets, private keys, seed phrases, or production credentials in issues, pull requests, commits, logs, or screenshots. Program keypairs belong in gitignored `keys/` directories, never in the diff.
- All commits into a Solana Foundation repository require [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) to be enabled. Your PRs will not be merged without this.

## Security vulnerabilities

Do not report security vulnerabilities in public issues. Use [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository instead.

Note that the examples here are educational and deliberately minimal. A missing production hardening measure in an example is a normal issue or PR, not a vulnerability report.

## How to contribute

- **Code contributions:** new examples that demonstrate a Solana program pattern, or improvements to existing ones such as bug fixes, optimizations, or additional coverage.
- **Bug reports, ideas, or feedback:** if an example does not build, is out of date, or is missing, open an issue.

## Development setup

Use the toolchain versions checked into the repository: `rust-toolchain.toml`, `.nvmrc`, `packageManager` in the root `package.json`, and the `anchor_version` / `solana_version` fields in each `Anchor.toml`. Do not bump language runtimes, the Solana CLI, Anchor, or the package manager as an incidental part of another change.

```bash
pnpm install            # at the root, for formatting tooling
pnpm format             # prettier write
pnpm check              # prettier check
pnpm sync-package-json  # align dependency versions across examples
```

Per example, run the commands documented in that example's `package.json` or `Anchor.toml`: `anchor test` for Anchor projects, `pnpm build-and-test` for native and Pinocchio projects.

## General coding and writing guidelines

Please follow the [Contributing and Style Guide from the Developer Content Repo](https://github.com/solana-foundation/developer-content/blob/main/CONTRIBUTING.md).

Specifically for code in this repo:

1. Use pnpm as the default package manager for the project. You can [install pnpm by following the instructions](https://pnpm.io/installation). Commit `pnpm-lock.yaml` to the repository.

    Note: this repository is intentionally **not** a pnpm workspace. Every example keeps its own `package.json` and lockfile so it can be copied out and run standalone. Dependency versions across examples are kept aligned with `pnpm sync-package-json`.

2. Solana Programs written for the Anchor framework should be in directory [`anchor`](https://www.anchor-lang.com), Solana Native in [`native`](https://solana.com/developers/guides/getstarted/intro-to-native-rust), respectively.

- Project path structure: `/program-examples/category/example-name/<framework_name>`
    - Project path structure example for anchor: `/program-examples/category/example-name/anchor`

3. Tests for Anchor and Solana native programs should be written with [LiteSVM](https://github.com/LiteSVM/litesvm). Non-Anchor tests use [@solana/kit](https://github.com/anza-xyz/kit) with litesvm 1.x; Anchor tests use [anchor-litesvm](https://www.npmjs.com/package/anchor-litesvm) with @solana/web3.js (until the Anchor JS client moves to kit).

4. For Solana native programs ensure adding these mandatory pnpm run scripts to your `package.json` file for successful CI/CD builds:

```json
"scripts": {
  "test": "mocha --import=tsx -t 1000000 ./tests/realloc.test.ts",
  "build-and-test": "cargo build-sbf --manifest-path=./program/Cargo.toml --sbf-out-dir=./tests/fixtures && pnpm test",
  "build": "cargo build-sbf --manifest-path=./program/Cargo.toml --sbf-out-dir=./program/target/so",
  "deploy": "solana program deploy ./program/target/so/program.so"
},
```

5. Test command for Anchor should execute `pnpm test` instead of `yarn run test` for anchor programs. Replace `yarn` with `pnpm` in `[script]` table inside [Anchor.toml file.](https://www.anchor-lang.com/docs/manifest#scripts-required-for-testing)

```
[scripts]
test = "pnpm mocha --import=tsx -t 1000000 tests/**/*.ts"
```

6. TypeScript, JavaScript and JSON files are formatted using
   [Prettier](https://prettier.io/). Execute the following command to format your code at the root of this project before submitting a pull request:

```bash
pnpm format
```

7. Some projects can be ignored from the building and testing process by adding the project name to the `.ghaignore` file.
   When removing or updating an example, please ensure that the example is removed from the `.ghaignore` file
   and there's a change in that example's directory.

## Making a change

Keep changes focused. A pull request should solve one problem and carry the tests, documentation, and generated artifacts needed to keep the repository usable.

Before opening a pull request:

- Format, lint, build, and test the affected examples with the commands above. `cargo fmt` at the root for Rust; clippy runs with `-D warnings` in CI.
- Add or update tests when behavior changes. Tests must assert real post-state (account data, lamport deltas) and fail loudly: break an assertion once to confirm the test can actually fail.
- Update the README and any example-level docs when the user-facing contract changes.
- Regenerate committed derived files (IDLs, generated clients) with the repository's documented tooling, and commit updated lockfiles.
- Explain any new dependency and why the existing dependency set is insufficient.

Because these are onchain programs, document the account validation, authority checks, state transitions, and value movement your change relies on. Include a threat-model note when the change creates or modifies a trust boundary. An example that teaches an unsafe pattern without flagging it is a bug.

## Pull requests

Write a clear title and description that explain the problem, the approach, and how you tested it. Link related issues and call out behavior changes, compatibility concerns, or follow-up work. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit and PR titles. See [AI use](#ai-use) for how to disclose AI assistance.

By default, [Greptile](https://www.greptile.com) is enabled on all Solana Foundation repositories. Before maintainers review, all Greptile comments must be resolved with either a code fix or an explanation of why no change is needed.

Once CI is approved to run by maintainers, all CI errors must be addressed before the PR will be merged.

Maintainers may ask you to rebase, split a broad change, add tests, or revise documentation before merging.

## AI use

You may use AI-assisted tools, but you should review the generated code, understand its behavior, and run the same checks expected of any other contribution.

If you are building with AI on Solana, check out the [Solana Dev Skill](https://github.com/solana-foundation/solana-dev-skill) or the [Solana MCP](https://mcp.solana.com/) to aid in your work.

Ensure that the generated code adheres to the project's coding standards and best practices. Maintainers can close PRs if they appear to be low-effort AI slop. In particular, audit your changes for the following AI code smells that increase maintenance burden:

- Comments that explain why the _previous_ behavior was wrong and the new behavior is correct. This can be helpful context for reviewers as a GitHub comment in the review, but we do not need a history of every code change living in the codebase.
- Large blocks of comments with a high density of technical jargon; comments should be distilled to clearly explain _why_ this code is doing something (if it's not obvious), not _what_ (the code should speak for itself).
- Drive-by refactoring of code that is not relevant to the actual change being made.

Two more that matter specifically here:

- Examples are read as teaching material, so generated code that works but obscures the pattern being taught is worse than none. Prefer the shortest version that shows the mechanism.
- Do not let a tool spread a change across every framework flavor or every example unless the change genuinely applies to all of them. Bulk edits are hard to review and easy to get subtly wrong per example.

### Disclosure

It can be helpful to note the extent to which AI was used in the change. For example, adding

> I wrote all of the code for this feature, and had Claude update the documentation and create tests accordingly

or

> I architected the change and handed all implementation over to Codex

to the pull request description can be helpful context for reviewers.

### Communication

If maintainers have suggested changes, feedback, or questions about your code, you should not be copy/pasting the questions to an LLM and copy/pasting the response. You being able to distill the information that AI produces is what makes your contribution valuable.

## Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all contributors, regardless of their background, experience level, or personal characteristics. As a contributor, you are expected to:

Be respectful and inclusive in your interactions with others.
Refrain from engaging in any form of harassment, discrimination, or offensive behavior. Be open to constructive feedback and be willing to learn from others.
Help create a positive and supportive community where everyone feels valued and respected.

If you encounter any behavior that violates our code of conduct, please report it to the project maintainers immediately.

## License

By contributing, you agree that your contributions are licensed under the project's [LICENSE](./LICENSE).
