## What is Pyth ?

Pyth is an Oracle that offers on-chain low-latency market data from institutional sources.
This means you can use prices from real-life assets in your Solana programs.

The price for each asset will be represented inside of a Solana account. We call those accounts price feeds.

For example, the price feed for SOL/USD on mainnet is represented on this account address: `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG`.

You can find more of these price feeds [here](https://pyth.network/price-feeds?cluster=mainnet-beta).

To use such a price feed, you need to pass its account into your instructions context.

You can get an asset's information by reading the account's data. The feed will consist of:

- A price
- A confidence interval
- An exponent

To read more about Pyth, please navigate to [the Pyth documentation](https://docs.pyth.network/solana-price-feeds).
