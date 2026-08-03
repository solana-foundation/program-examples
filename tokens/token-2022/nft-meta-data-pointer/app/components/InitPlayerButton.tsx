import { Button } from '@chakra-ui/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SystemProgram } from '@solana/web3.js';
import { useCallback, useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { GAME_DATA_SEED, gameDataPDA, program } from '@/utils/anchor';

const InitPlayerButton = () => {
    const { publicKey, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const [isLoading, setIsLoading] = useState(false);
    const { gameState, playerDataPDA } = useGameState();

    // Init player button click handler
    const handleClick = useCallback(async () => {
        if (!publicKey || !playerDataPDA) return;

        setIsLoading(true);

        try {
            const transaction = await program.methods
                .initPlayer(GAME_DATA_SEED)
                .accounts({
                    player: playerDataPDA,
                    gameData: gameDataPDA,
                    signer: publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .transaction();

            const txSig = await sendTransaction(transaction, connection, {
                skipPreflight: true,
            });

            console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
        } catch (error) {
            console.log(error);
        } finally {
            setIsLoading(false); // set loading state back to false
        }
    }, [publicKey, playerDataPDA, connection, sendTransaction]);

    return (
        <>
            {!gameState && publicKey && (
                <Button onClick={handleClick} isLoading={isLoading}>
                    Init Player
                </Button>
            )}
        </>
    );
};

export default InitPlayerButton;
