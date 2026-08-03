import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import { GameStateProvider } from '@/contexts/GameStateProvider';
import { NftProvider } from '@/contexts/NftProvider';
import SessionProvider from '@/contexts/SessionProvider';
import WalletContextProvider from '../contexts/WalletContextProvider';

export default function App({ Component, pageProps }: AppProps) {
    return (
        <ChakraProvider>
            <WalletContextProvider>
                <SessionProvider>
                    <GameStateProvider>
                        <NftProvider>
                            <Component {...pageProps} />
                        </NftProvider>
                    </GameStateProvider>
                </SessionProvider>
            </WalletContextProvider>
        </ChakraProvider>
    );
}
