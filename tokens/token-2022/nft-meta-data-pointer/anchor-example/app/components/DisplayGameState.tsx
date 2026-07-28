import { HStack, Text, VStack } from '@chakra-ui/react';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import { useGameState } from '@/contexts/GameStateProvider';
import { TOTAL_WOOD_AVAILABLE } from '@/utils/anchor';

const DisplayPlayerData = () => {
    const { publicKey } = useWallet();
    const { gameState, nextEnergyIn, totalWoodAvailable } = useGameState();

    return (
        <>
            {gameState && publicKey && (
                <HStack justifyContent="center" spacing={4}>
                    <HStack>
                        <Image src="/Wood.png" alt="Wood Icon" width={64} height={64} />
                        <Text>Wood: {Number(gameState.wood)}</Text>
                    </HStack>
                    <HStack>
                        <Image src="/energy.png" alt="Energy Icon" width={64} height={64} />
                        <VStack>
                            <Text>Energy: {Number(gameState.energy)}</Text>
                            <Text>Next in: {nextEnergyIn}</Text>
                        </VStack>
                    </HStack>
                    <Text>Total Wood available: {Number(TOTAL_WOOD_AVAILABLE) - Number(totalWoodAvailable)}</Text>
                </HStack>
            )}
        </>
    );
};

export default DisplayPlayerData;
