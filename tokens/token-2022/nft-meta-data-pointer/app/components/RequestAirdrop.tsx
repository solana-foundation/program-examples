import { Button, Text } from '@chakra-ui/react';
import { useKitTransactionSigner } from '@solana/connector/react';
import { airdropFactory, lamports } from '@solana/kit';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, rpcSubscriptions } from '@/utils/anchor';

const LAMPORTS_PER_SOL = 1_000_000_000n;

const RequestAirdrop = () => {
    const { signer } = useKitTransactionSigner();
    const [balance, setBalance] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);
    const airdrop = useMemo(() => airdropFactory({ rpc, rpcSubscriptions }), []);

    const getBalance = useCallback(async () => {
        if (!signer) return;
        const { value: lamportsBalance } = await rpc.getBalance(signer.address, { commitment: 'confirmed' }).send();
        setBalance(Number(lamportsBalance) / Number(LAMPORTS_PER_SOL));
    }, [signer]);

    const onClick = useCallback(async () => {
        setIsLoading(true);
        if (!signer) return;
        try {
            await airdrop({
                commitment: 'confirmed',
                recipientAddress: signer.address,
                lamports: lamports(LAMPORTS_PER_SOL),
            });
            await getBalance();
        } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
        } finally {
            setIsLoading(false);
        }
    }, [signer, airdrop, getBalance]);

    useEffect(() => {
        getBalance();
    }, [getBalance]);

    return (
        <>
            {signer &&
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
