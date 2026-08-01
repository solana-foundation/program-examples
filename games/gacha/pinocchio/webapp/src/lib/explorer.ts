import type { ClusterMoniker } from './solana-client';

export function getExplorerUrl(path: string, cluster: ClusterMoniker): string {
    const url = new URL(path, 'https://explorer.solana.com');
    if (cluster === 'devnet') {
        url.searchParams.set('cluster', 'devnet');
    } else if (cluster === 'localnet') {
        url.searchParams.set('cluster', 'custom');
        url.searchParams.set('customUrl', 'http://localhost:8899');
    }
    return url.toString();
}
