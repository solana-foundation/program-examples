import { Button, HStack, VStack } from '@chakra-ui/react';
import { useKitTransactionSigner } from '@solana/connector/react';
import { generateKeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import Image from 'next/image';
import { useCallback, useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { getMintNftInstructionAsync } from '@/generated/instructions';
import { useSendInstruction } from '@/hooks/useSendInstruction';

const MintNftButton = () => {
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const { gameState, playerDataPDA } = useGameState();
    const [isLoadingMainWallet, showSpinner] = useState(false);

    const onMintNftClick = useCallback(async () => {
        if (!signer || !playerDataPDA) return;

        showSpinner(true);

        try {
            const mint = await generateKeyPairSigner();

            const [tokenAccount] = await findAssociatedTokenPda({
                owner: signer.address,
                mint: mint.address,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

            const instruction = await getMintNftInstructionAsync({
                signer,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                tokenAccount,
                mint,
            });

            const txSig = await sendInstruction(instruction, signer);

            console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        } catch (error) {
            console.log('error', `Minting failed! ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            showSpinner(false);
        }
    }, [signer, playerDataPDA, sendInstruction]);

    return (
        <>
            {signer && gameState && (
                <VStack>
                    <Image src="/Beaver.png" alt="Energy Icon" width={64} height={64} />
                    <HStack>
                        <Button isLoading={isLoadingMainWallet} onClick={onMintNftClick} width="175px">
                            Mint Nft
                        </Button>
                    </HStack>
                </VStack>
            )}
        </>
    );
};

export default MintNftButton;
