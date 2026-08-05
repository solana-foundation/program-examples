import { Button } from '@chakra-ui/react';
import { useKitTransactionSigner } from '@solana/connector/react';
import { useCallback, useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { getInitPlayerInstructionAsync } from '@/generated/instructions';
import { useSendInstruction } from '@/hooks/useSendInstruction';
import { GAME_DATA_SEED } from '@/utils/anchor';

const InitPlayerButton = () => {
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const [isLoading, setIsLoading] = useState(false);
    const { gameState, playerDataPDA } = useGameState();

    // Init player button click handler
    const handleClick = useCallback(async () => {
        if (!signer || !playerDataPDA) return;

        setIsLoading(true);

        try {
            const instruction = await getInitPlayerInstructionAsync({
                player: playerDataPDA,
                signer,
                levelSeed: GAME_DATA_SEED,
            });

            const txSig = await sendInstruction(instruction, signer);

            console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        } catch (error) {
            console.log(error);
        } finally {
            setIsLoading(false); // set loading state back to false
        }
    }, [signer, playerDataPDA, sendInstruction]);

    return (
        <>
            {!gameState && signer && (
                <Button onClick={handleClick} isLoading={isLoading}>
                    Init Player
                </Button>
            )}
        </>
    );
};

export default InitPlayerButton;
