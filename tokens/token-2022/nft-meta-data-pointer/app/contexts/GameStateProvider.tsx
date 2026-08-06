import { useKitTransactionSigner } from '@solana/connector/react';
import { getBase64Encoder, type Address } from '@solana/kit';
import { createContext, useContext, useEffect, useState } from 'react';
import {
    fetchMaybeGameData,
    fetchMaybePlayerData,
    getGameDataDecoder,
    getPlayerDataDecoder,
    type PlayerData,
} from '@/generated/accounts';
import { findGameDataPda, findPlayerPda } from '@/generated/pdas';
import { GAME_DATA_SEED, MAX_ENERGY, rpc, rpcSubscriptions, TIME_TO_REFILL_ENERGY } from '@/utils/anchor';

const GameStateContext = createContext<{
    playerDataPDA: Address | null;
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
    const { signer } = useKitTransactionSigner();

    const [playerDataPDA, setPlayerDataPDA] = useState<Address | null>(null);
    const [playerState, setPlayerState] = useState<PlayerData | null>(null);
    const [_timePassed, setTimePassed] = useState<number>(0);
    const [nextEnergyIn, setEnergyNextIn] = useState<number>(0);
    const [totalWoodAvailable, setTotalWoodAvailable] = useState<number | null>(0);

    useEffect(() => {
        setPlayerState(null);
        setPlayerDataPDA(null);
        if (!signer) {
            return;
        }

        const abortController = new AbortController();

        (async () => {
            const [pda] = await findPlayerPda({ signer: signer.address });
            if (abortController.signal.aborted) return;
            setPlayerDataPDA(pda);

            const maybePlayer = await fetchMaybePlayerData(rpc, pda);
            if (abortController.signal.aborted) return;
            if (maybePlayer.exists) {
                setPlayerState(maybePlayer.data);
            } else {
                window.alert('No player data found, please init!');
            }

            const notifications = await rpcSubscriptions
                .accountNotifications(pda, { commitment: 'confirmed', encoding: 'base64' })
                .subscribe({ abortSignal: abortController.signal });

            for await (const notification of notifications) {
                const [base64Data] = notification.value.data;
                setPlayerState(getPlayerDataDecoder().decode(getBase64Encoder().encode(base64Data)));
            }
        })().catch(error => {
            if (!abortController.signal.aborted) console.error(error);
        });

        return () => abortController.abort();
    }, [signer]);

    useEffect(() => {
        const abortController = new AbortController();

        (async () => {
            const [pda] = await findGameDataPda({ levelSeed: GAME_DATA_SEED });

            const maybeGameData = await fetchMaybeGameData(rpc, pda);
            if (maybeGameData.exists) {
                setTotalWoodAvailable(Number(maybeGameData.data.totalWoodCollected));
            } else {
                window.alert('No game data found, please init!');
            }

            const notifications = await rpcSubscriptions
                .accountNotifications(pda, { commitment: 'confirmed', encoding: 'base64' })
                .subscribe({ abortSignal: abortController.signal });

            for await (const notification of notifications) {
                const [base64Data] = notification.value.data;
                const gameData = getGameDataDecoder().decode(getBase64Encoder().encode(base64Data));
                setTotalWoodAvailable(Number(gameData.totalWoodCollected));
            }
        })().catch(error => {
            if (!abortController.signal.aborted) console.error(error);
        });

        return () => abortController.abort();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            if (playerState == null || playerState.lastLogin === undefined) {
                return;
            }
            if (playerState.energy >= MAX_ENERGY) {
                setEnergyNextIn(0);
                return;
            }

            const lastLoginTime = Number(playerState.lastLogin) * 1000;
            const currentTime = Date.now();
            let timePassed = (currentTime - lastLoginTime) / 1000;

            let energy = playerState.energy;
            let lastLogin = playerState.lastLogin;
            while (timePassed >= Number(TIME_TO_REFILL_ENERGY) && energy < MAX_ENERGY) {
                energy += 1n;
                lastLogin += TIME_TO_REFILL_ENERGY;
                timePassed -= Number(TIME_TO_REFILL_ENERGY);
            }

            setTimePassed(timePassed);

            const nextEnergyIn = Math.floor(Number(TIME_TO_REFILL_ENERGY) - timePassed);
            setEnergyNextIn(nextEnergyIn > 0 ? nextEnergyIn : 0);

            if (energy !== playerState.energy || lastLogin !== playerState.lastLogin) {
                setPlayerState({ ...playerState, energy, lastLogin });
            }
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
