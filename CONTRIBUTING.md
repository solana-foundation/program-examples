# Contribution Guidelines

Thank you for considering contributing to the Solana Program Examples repository. We greatly appreciate your interest and efforts in helping us improve and expand this valuable resource for the Solana developer community.

We believe that a welcoming and inclusive environment fosters collaboration and encourages participation from developers of all backgrounds and skill levels.

To ensure a smooth and effective contribution process, please take a moment to review and follow the guidelines outlined below.

## How to Contribute

We welcome contributions in the form of code, documentation, bug reports, feature requests, and other forms of feedback. Here are some ways you can contribute:

- **Code Contributions:** You can contribute code examples in Rust that demonstrate various Solana program functionalities. You can also contribute improvements to existing examples, such as bug fixes, optimizations, or additional features.

- **Bug Reports, Ideas or Feedback:** If you encounter any issues or have ideas for new examples, please submit a bug report or feature request. Your feedback is valuable and helps us improve the quality and relevance of the examples.

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

## Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for all contributors, regardless of their background, experience level, or personal characteristics. As a contributor, you are expected to:

Be respectful and inclusive in your interactions with others.
Refrain from engaging in any form of harassment, discrimination, or offensive behavior. Be open to constructive feedback and be willing to learn from others.
Help create a positive and supportive community where everyone feels valued and respected.

If you encounter any behavior that violates our code of conduct, please report it to the project maintainers immediately.
