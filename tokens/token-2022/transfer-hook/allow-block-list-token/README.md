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

## Setup

```shell
cd anchor
anchor build
anchor test
```
