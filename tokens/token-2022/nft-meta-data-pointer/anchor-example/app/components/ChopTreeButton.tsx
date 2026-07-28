import { Button, HStack, VStack } from '@chakra-ui/react';
import { useSessionWallet } from '@magicblock-labs/gum-react-sdk';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import Image from 'next/image';
import { useCallback, useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { useNftState } from '@/contexts/NftProvider';
import { GAME_DATA_SEED, gameDataPDA, program } from '@/utils/anchor';

const ChopTreeButton = () => {
    const { publicKey, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const sessionWallet = useSessionWallet();
    const { gameState, playerDataPDA } = useGameState();
    const [isLoadingSession, setIsLoadingSession] = useState(false);
    const [isLoadingMainWallet, setIsLoadingMainWallet] = useState(false);
    const [transactionCounter, setTransactionCounter] = useState(0);
    const { nftState } = useNftState();

    const onChopClick = useCallback(async () => {
        setIsLoadingSession(true);
        if (!playerDataPDA || !sessionWallet?.publicKey) return;
        setTransactionCounter(transactionCounter + 1);

        const nftAuthority = await PublicKey.findProgramAddress([Buffer.from('nft_authority')], program.programId);

        let nft = null;

        for (let i = 0; i < nftState.items.length; i++) {
            try {
                const nftData = nftState.items[i];
                if (nftData.authorities[0] === nftAuthority[0].toBase58()) {
                    nft = nftData;
                }
                console.log('NFT data', nftData);
            } catch (error) {
                console.log(error);
            }
        }

        console.log('NFT', nft);
        if (nft == null) {
            window.alert('Mint and NFT character first');
            setIsLoadingMainWallet(false);
            return;
        }

        try {
            const transaction = await program.methods
                .chopTree(GAME_DATA_SEED, transactionCounter)
                .accounts({
                    player: playerDataPDA,
                    gameData: gameDataPDA,
                    signer: sessionWallet.publicKey,
                    sessionToken: sessionWallet.sessionToken,
                    nftAuthority: nftAuthority[0],
                    mint: nft.id,
                })
                .transaction();

            const txids = await sessionWallet.signAndSendTransaction?.(transaction);

            if (txids && txids.length > 0) {
                console.log('Transaction sent:', txids);
            } else {
                console.error('Failed to send transaction');
            }
        } catch (error) {
            console.log('error', `Chopping failed! ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsLoadingSession(false);
        }
    }, [sessionWallet, nftState, playerDataPDA, transactionCounter]);

    const onChopMainWalletClick = useCallback(async () => {
        if (!publicKey || !playerDataPDA) return;

        setIsLoadingMainWallet(true);
        const nftAuthority = await PublicKey.findProgramAddress([Buffer.from('nft_authority')], program.programId);

        if (nftState == null) {
            window.alert('Load NFT state first');
            setIsLoadingMainWallet(false);
            return;
        }

        console.log('NFT state', nftState);
        let nft = null;
        for (let i = 0; i < nftState.items.length; i++) {
            try {
                const nftData = nftState.items[i];
                console.log(`${nftData.authorities[0].address} == ${nftAuthority[0].toBase58()}`);

                if (nftData.authorities[0].address === nftAuthority[0].toBase58()) {
                    nft = nftData;
                }
                console.log('NFT data', nftData);
            } catch (error) {
                console.log(error);
            }
        }

        console.log('NFT', nft);
        if (nft == null) {
            window.alert('Mint and NFT character first');
            setIsLoadingMainWallet(false);
            return;
        }
        try {
            console.log('NFTid', nft.id, 'NFT authority', nft.authorities[0].address);
            const transaction = await program.methods
                .chopTree(GAME_DATA_SEED, transactionCounter)
                .accounts({
                    player: playerDataPDA,
                    gameData: gameDataPDA,
                    signer: publicKey,
                    sessionToken: null,
                    nftAuthority: nftAuthority[0].toBase58(),
                    mint: nft.id,
                    tokenProgram: TOKEN_2022_PROGRAM_ID,
                })
                .transaction();

            const txSig = await sendTransaction(transaction, connection, {
                skipPreflight: true,
            });
            console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        } catch (error) {
            console.log('error', `Chopping failed! ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsLoadingMainWallet(false);
        }
    }, [publicKey, playerDataPDA, connection, nftState, transactionCounter, sendTransaction]);

    return (
        <>
            {publicKey && gameState && (
                <VStack>
                    <Image src="/Beaver.png" alt="Energy Icon" width={64} height={64} />
                    <HStack>
                        {sessionWallet && sessionWallet.sessionToken != null && (
                            <Button isLoading={isLoadingSession} onClick={onChopClick} width="175px">
                                Chop tree Session
                            </Button>
                        )}
                        <Button isLoading={isLoadingMainWallet} onClick={onChopMainWalletClick} width="175px">
                            Chop tree MainWallet
                        </Button>
                    </HStack>
                </VStack>
            )}
        </>
    );
};

export default ChopTreeButton;
