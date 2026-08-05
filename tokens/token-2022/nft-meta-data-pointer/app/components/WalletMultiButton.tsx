import { Button, Menu, MenuButton, MenuItem, MenuList } from '@chakra-ui/react';
import { useConnectWallet, useDisconnectWallet, useWallet, useWalletConnectors } from '@solana/connector/react';

function ellipsify(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const WalletMultiButton = () => {
    const { account, isConnected, isConnecting } = useWallet();
    const connectors = useWalletConnectors();
    const { connect, isConnecting: connectPending } = useConnectWallet();
    const { disconnect, isDisconnecting } = useDisconnectWallet();

    const pending = isConnecting || connectPending || isDisconnecting;

    if (isConnected && account) {
        return (
            <Menu>
                <MenuButton as={Button} isLoading={pending}>
                    {ellipsify(account)}
                </MenuButton>
                <MenuList>
                    <MenuItem onClick={() => void disconnect()}>Disconnect</MenuItem>
                </MenuList>
            </Menu>
        );
    }

    return (
        <Menu>
            <MenuButton as={Button} isLoading={pending}>
                Select Wallet
            </MenuButton>
            <MenuList>
                {connectors.length === 0 && <MenuItem isDisabled>No Wallet Standard wallets detected</MenuItem>}
                {connectors.map(connector => (
                    <MenuItem
                        key={connector.id}
                        isDisabled={pending || !connector.ready}
                        onClick={() => void connect(connector.id)}
                    >
                        {connector.name}
                    </MenuItem>
                ))}
            </MenuList>
        </Menu>
    );
};

export default WalletMultiButton;
