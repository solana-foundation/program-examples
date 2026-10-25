#!/usr/bin/env bash
set -e

cargo build-sbf --manifest-path=./program/Cargo.toml --sbf-out-dir=./tests/fixtures
pnpm install
pnpm test
