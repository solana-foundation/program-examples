import { Box, Flex, Heading, Spacer, Text, VStack } from '@chakra-ui/react';
import { useKitTransactionSigner } from '@solana/connector/react';
import ChopTreeButton from '@/components/ChopTreeButton';
import DisplayGameState from '@/components/DisplayGameState';
import DisplayNfts from '@/components/DisplayNfts';
import InitPlayerButton from '@/components/InitPlayerButton';
import MintNftButton from '@/components/MintNftButton';
import RequestAirdrop from '@/components/RequestAirdrop';
import SessionKeyButton from '@/components/SessionKeyButton';
import WalletMultiButton from '@/components/WalletMultiButton';

export default function Home() {
    const { signer } = useKitTransactionSigner();

    return (
        <Box>
            <Flex px={4} py={4}>
                <Spacer />
                <WalletMultiButton />
            </Flex>
            <VStack>
                <Heading>ExtensionNft</Heading>
                {!signer && <Text>Connect to devnet wallet!</Text>}
                <DisplayGameState />
                <InitPlayerButton />
                <SessionKeyButton />
                <ChopTreeButton />
                <MintNftButton />
                <RequestAirdrop />
                <DisplayNfts />
            </VStack>
        </Box>
    );
}
