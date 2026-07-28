import { Button, Text } from '@chakra-ui/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';

const RequestAirdrop = () => {
    const { publicKey } = useWallet();
    const { connection } = useConnection();
    const [balance, setBalance] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);

    const getBalance = useCallback(async () => {
        if (!publicKey) return;
        const balance = await connection.getBalance(publicKey, 'confirmed');
        setBalance(balance / LAMPORTS_PER_SOL);
    }, [publicKey, connection]);

    const onClick = useCallback(async () => {
        setIsLoading(true);
        if (!publicKey) return;
        try {
            const txSig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
            await connection.confirmTransaction(txSig);
            getBalance();
        } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
        } finally {
            setIsLoading(false);
        }
    }, [publicKey, connection, getBalance]);

    useEffect(() => {
        getBalance();
    }, [getBalance]);

    return (
        <>
            {publicKey &&
                (balance <= 0 ? (
                    <Button onClick={onClick} isLoading={isLoading}>
                        Airdrop 1
                    </Button>
                ) : (
                    <Text>Balance: {Number(balance).toFixed(3)}</Text>
                ))}
        </>
    );
};

export default RequestAirdrop;
