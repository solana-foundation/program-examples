import { Button, HStack, VStack } from '@chakra-ui/react';
import { useSessionWallet } from '@magicblock-labs/gum-react-sdk';
import { useKitTransactionSigner } from '@solana/connector/react';
import { createNoopSigner, type Address } from '@solana/kit';
import Image from 'next/image';
import { useCallback, useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { useNftState } from '@/contexts/NftProvider';
import { getChopTreeInstructionAsync } from '@/generated/instructions';
import { findNftAuthorityPda } from '@/generated/pdas';
import { useSendInstruction } from '@/hooks/useSendInstruction';
import { GAME_DATA_SEED } from '@/utils/anchor';
import { kitInstructionToLegacyTransaction } from '@/utils/legacyBridge';

const ChopTreeButton = () => {
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const sessionWallet = useSessionWallet();
    const { gameState, playerDataPDA } = useGameState();
    const [isLoadingSession, setIsLoadingSession] = useState(false);
    const [isLoadingMainWallet, setIsLoadingMainWallet] = useState(false);
    const [transactionCounter, setTransactionCounter] = useState(0);
    const { nftState } = useNftState();

    const onChopClick = useCallback(async () => {
        setIsLoadingSession(true);
        if (!playerDataPDA || !sessionWallet?.publicKey || !sessionWallet.sessionToken) {
            setIsLoadingSession(false);
            return;
        }
        setTransactionCounter(transactionCounter + 1);

        const [nftAuthority] = await findNftAuthorityPda();

        if (nftState == null) {
            window.alert('Load NFT state first');
            setIsLoadingSession(false);
            return;
        }

        let nft = null;
        for (let i = 0; i < nftState.items.length; i++) {
            try {
                const nftData = nftState.items[i];
                if (nftData.authorities[0] === nftAuthority) {
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
            setIsLoadingSession(false);
            return;
        }

        try {
            const instruction = await getChopTreeInstructionAsync({
                sessionToken: sessionWallet.sessionToken as Address,
                player: playerDataPDA,
                signer: createNoopSigner(sessionWallet.publicKey.toBase58() as Address),
                mint: nft.id as Address,
                nftAuthority,
                levelSeed: GAME_DATA_SEED,
                counter: transactionCounter,
            });

            const transaction = kitInstructionToLegacyTransaction(instruction);

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
        if (!signer || !playerDataPDA) return;

        setIsLoadingMainWallet(true);
        const [nftAuthority] = await findNftAuthorityPda();

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
                const authority = nftData.authorities[0];
                const authorityAddress = typeof authority === 'string' ? authority : authority.address;
                console.log(`${authorityAddress} == ${nftAuthority}`);

                if (authorityAddress === nftAuthority) {
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
            const nftAuthorityAddress =
                typeof nft.authorities[0] === 'string' ? nft.authorities[0] : nft.authorities[0].address;
            console.log('NFTid', nft.id, 'NFT authority', nftAuthorityAddress);

            const instruction = await getChopTreeInstructionAsync({
                player: playerDataPDA,
                signer,
                mint: nft.id as Address,
                nftAuthority: nftAuthorityAddress as Address,
                levelSeed: GAME_DATA_SEED,
                counter: transactionCounter,
            });

            const txSig = await sendInstruction(instruction, signer);
            console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        } catch (error) {
            console.log('error', `Chopping failed! ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsLoadingMainWallet(false);
        }
    }, [signer, playerDataPDA, nftState, transactionCounter, sendInstruction]);

    return (
        <>
            {signer && gameState && (
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
