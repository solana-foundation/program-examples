/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DEFAULT_CLUSTER?: string;
    readonly VITE_DEVNET_RPC_URL?: string;
    readonly VITE_MAINNET_RPC_URL?: string;
    readonly VITE_POOL_ADMIN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
