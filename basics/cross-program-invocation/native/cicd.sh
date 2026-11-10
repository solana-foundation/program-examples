#!/bin/bash
set -eo pipefail

# This script is for quick building & deploying of the program.
# It also serves as a reference for the commands used for building & deploying Solana programs.
# Run this bad boy with "bash cicd.sh" or "./cicd.sh"

cargo build-sbf --sbf-out-dir=./target/so
echo "Hand:"
solana program deploy ./target/so/cross_program_invocatio_native_hand.so | grep "Program Id:"
echo "Lever:"
solana program deploy ./target/so/cross_program_invocatio_native_lever.so | grep "Program Id:"
