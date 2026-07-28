import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { createContext, useContext, useEffect, useState } from 'react';
import {
    GAME_DATA_SEED,
    type GameData,
    MAX_ENERGY,
    type PlayerData,
    program,
    TIME_TO_REFILL_ENERGY,
} from '@/utils/anchor';

const GameStateContext = createContext<{
    playerDataPDA: PublicKey | null;
    gameState: PlayerData | null;
    nextEnergyIn: number;
    totalWoodAvailable: number | null;
}>({
    playerDataPDA: null,
    gameState: null,
    nextEnergyIn: 0,
    totalWoodAvailable: 0,
});

export const useGameState = () => useContext(GameStateContext);

export const GameStateProvider = ({ children }: { children: React.ReactNode }) => {
    const { publicKey } = useWallet();
    const { connection } = useConnection();

    const [playerDataPDA, setPlayerData] = useState<PublicKey | null>(null);
    const [playerState, setPlayerState] = useState<PlayerData | null>(null);
    const [_timePassed, setTimePassed] = useState<number>(0);
    const [nextEnergyIn, setEnergyNextIn] = useState<number>(0);
    const [gameDataPDA, setGameDataPDA] = useState<PublicKey | null>(null);
    const [_gameData, setGameData] = useState<GameData | null>(null);
    const [totalWoodAvailable, setTotalWoodAvailable] = useState<number | null>(0);

    useEffect(() => {
        setPlayerState(null);
        if (!publicKey) {
            return;
        }
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from('player', 'utf8'), publicKey.toBuffer()],
            program.programId,
        );
        setPlayerData(pda);

        program.account.playerData
            .fetch(pda)
            .then(data => {
                setPlayerState(data);
            })
            .catch(_error => {
                window.alert('No player data found, please init!');
            });

        connection.onAccountChange(pda, account => {
            setPlayerState(program.coder.accounts.decode('playerData', account.data));
        });
    }, [publicKey, connection.onAccountChange]);

    useEffect(() => {
        setGameData(null);
        if (!publicKey) {
            return;
        }
        const [pda] = PublicKey.findProgramAddressSync([Buffer.from(GAME_DATA_SEED, 'utf8')], program.programId);
        setGameDataPDA(gameDataPDA);

        program.account.gameData
            .fetch(pda)
            .then(data => {
                setGameData(data);
                setTotalWoodAvailable(data.totalWoodCollected.toNumber());
            })
            .catch(_error => {
                window.alert('No game data found, please init!');
            });

        connection.onAccountChange(pda, account => {
            const newGameData = program.coder.accounts.decode('gameData', account.data);
            setGameData(newGameData);
            setTotalWoodAvailable(newGameData.totalWoodCollected.toNumber());
        });
    }, [publicKey, connection.onAccountChange, gameDataPDA]);

    useEffect(() => {
        const interval = setInterval(async () => {
            if (
                playerState == null ||
                playerState.lastLogin === undefined ||
                playerState.energy.toNumber() >= MAX_ENERGY
            ) {
                return;
            }

            const lastLoginTime = playerState.lastLogin.toNumber() * 1000;
            const currentTime = Date.now();
            let timePassed = (currentTime - lastLoginTime) / 1000;

            while (timePassed >= TIME_TO_REFILL_ENERGY.toNumber() && playerState.energy.toNumber() < MAX_ENERGY) {
                playerState.energy = playerState.energy.add(new BN(1));
                playerState.lastLogin = playerState.lastLogin.add(TIME_TO_REFILL_ENERGY);
                timePassed -= TIME_TO_REFILL_ENERGY.toNumber();
            }

            setTimePassed(timePassed);

            const nextEnergyIn = Math.floor(TIME_TO_REFILL_ENERGY.toNumber() - timePassed);
            setEnergyNextIn(nextEnergyIn > 0 ? nextEnergyIn : 0);
        }, 1000);

        return () => clearInterval(interval);
    }, [playerState]);

    return (
        <GameStateContext.Provider
            value={{
                playerDataPDA,
                gameState: playerState,
                nextEnergyIn,
                totalWoodAvailable,
            }}
        >
            {children}
        </GameStateContext.Provider>
    );
};
