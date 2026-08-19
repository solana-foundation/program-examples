# AllowBlockList Token

An example of a allow / block list token using token extensions.

## Features

Allows the creation of an allow block list with a list authority.
The allow/block list is then consumed by a transfer-hook.

The list is managed by a single authority and can be used by several token mints. This enables a separation of concerns between token management and allow/block list management, ideal for scenarios where an issuer wants a 3rd party managed allow/block list or wants to share the same list across a group of assets.

Initializes new tokens with several configuration options:

- Permanent delegate
- Allow list
- Block list
- Metadata
- Authorities

The issuer can configure the allow and block list with 3 distinct configurations:

- Force Allow: requires everyone receiving tokens to be explicitly allowed in
- Block: allows everyone to receive tokens unless explicitly blocked
- Threshold Allow: allows everyone to receive tokens unless explicitly blocked up until a given transfer amount threshold. Transfers larger than the threshold require explicitly allow

These configurations are saved in the token mint metadata.

This repo includes a UI to manage the allow/block list based on the `legacy-next-tailwind-basic` template. It also allows creating new token mints on the spot with transfer-hook enabled along with token transfers given that most wallets fail to fetch transfer-hook dependencies on devnet and locally.

## Setup

Install dependencies:
`yarn install`

Compile the program (make sure to replace your program ID):
`anchor build`

Compile the UI:
`yarn run build`

The UI talks to the program through a Codama-generated client under `src/generated`, rebuilt by
`pnpm run generate-client` (which `dev` and `build` run for you). It reads the IDL emitted by
`anchor build` when one is present, falling back to the committed copy in `idl/`, so a program ID
change picks up automatically — commit the refreshed `idl/abl_token.json` and `src/generated` when
the change is meant to be permanent.

Serve the UI:
`yarn run dev`

### Local testing

There are a couple scripts to manage the local validator and deployment.

To start the local validator and deploy the program (uses the anchor CLI and default anchor keypair):
`./scripts/start.sh`

To stop the local validator:
`./scripts/stop.sh`
