import { Button } from '@chakra-ui/react';
import { useSessionWallet } from '@magicblock-labs/gum-react-sdk';
import { useKitTransactionSigner } from '@solana/connector/react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { useState } from 'react';
import { useGameState } from '@/contexts/GameStateProvider';
import { PROGRAM_ADDRESS } from '@/utils/anchor';

const SessionKeyButton = () => {
    const { signer } = useKitTransactionSigner();
    const { gameState } = useGameState();
    const sessionWallet = useSessionWallet();
    const [isLoading, setIsLoading] = useState(false);

    const handleCreateSession = async () => {
        setIsLoading(true);
        const topUpLamports = 0.01 * LAMPORTS_PER_SOL;
        const expiryInMinutes = 600;

        try {
            const session = await sessionWallet.createSession(
                new PublicKey(PROGRAM_ADDRESS),
                topUpLamports,
                expiryInMinutes,
            );
            console.log('Session created:', session);
        } catch (error) {
            console.error('Failed to create session:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRevokeSession = async () => {
        setIsLoading(true);
        try {
            await sessionWallet.revokeSession();
            console.log('Session revoked');
        } catch (error) {
            console.error('Failed to revoke session:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {signer && gameState && (
                <Button
                    isLoading={isLoading}
                    onClick={
                        sessionWallet && sessionWallet.sessionToken == null ? handleCreateSession : handleRevokeSession
                    }
                >
                    {sessionWallet && sessionWallet.sessionToken == null ? 'Create session' : 'Revoke Session'}
                </Button>
            )}
        </>
    );
};

export default SessionKeyButton;
