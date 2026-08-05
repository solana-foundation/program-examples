This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Solana client stack

The on-chain client is [`@solana/kit`](https://github.com/anza-xyz/kit), generated from `idl/extension_nft.json` via [Codama](https://github.com/codama-idl/codama) (`pnpm generate-client`, wired as a `predev`/`prebuild` step) into a gitignored `generated/` directory — see `scripts/generate-client.ts`. Wallet connection is [`@solana/connector`](https://www.npmjs.com/package/@solana/connector) (wallet-standard, no per-wallet adapter packages).

One legacy pocket remains: the session-key feature (`@magicblock-labs/gum-react-sdk`) is pinned to `@solana/web3.js` and `@solana/wallet-adapter-react` in its own published API and predates kit. Rather than run a second, separately-connected wallet-adapter-react instance alongside the kit-native wallet connection, `contexts/SessionProvider.tsx` and `utils/legacyBridge.ts` bridge the single kit-connected wallet into the `AnchorWallet` shape gum-sdk needs. `@solana/web3.js` and `@solana/wallet-adapter-react` stay in `package.json`, but only for that one boundary — nothing else in the app touches them.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
