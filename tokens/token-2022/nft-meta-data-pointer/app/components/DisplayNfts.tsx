import { useKitTransactionSigner } from '@solana/connector/react';
import Image from 'next/image';
import { useState } from 'react';
import { useNftState } from '@/contexts/NftProvider';

export class Nft {
    name: string;
    url: string;

    constructor() {
        this.url = '';
        this.name = '';
    }
}

const DisplayNfts = () => {
    const { signer } = useKitTransactionSigner();
    const { nftState } = useNftState();
    const [showItems, setShowItems] = useState(false);

    const handleButtonClick = () => {
        setShowItems(!showItems);
    };

    const myNfts: Nft[] = [];

    if (nftState != null) {
        for (let i = 0; i < nftState.items.length; i++) {
            try {
                const nftData = nftState.items[i];
                const nft = new Nft();

                nft.name = nftData.content.metadata.name;
                nft.url = nftData.content.links.image;

                myNfts.push(nft);
            } catch (error) {
                console.log(error);
            }
        }
    }

    function onNftClickedCallback(nft: Nft): void {
        window.alert(`Nft clicked: ${nft.name}`);
    }

    return (
        <>
            {nftState && signer && (
                <div>
                    <button type="button" onClick={handleButtonClick}>
                        Show NFTs
                    </button>
                    {showItems && (
                        <div className="flex flex-row space-x-5 overflow-x-auto self-end place-items-center justify-center ... ">
                            {myNfts.map(nft => (
                                <div key={nft.name}>
                                    <p className="text-sky-400 truncate ...">{nft.name}</p>
                                    <div className="flex flex-row place-items-center ...">
                                        {nft.url ? (
                                            <Image
                                                onClick={() => onNftClickedCallback(nft)}
                                                src={nft.url}
                                                alt="NFT Icon"
                                                width={64}
                                                height={64}
                                            />
                                        ) : (
                                            <div>Error loading image</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default DisplayNfts;
