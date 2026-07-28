using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Frictionless;
using Solana.Unity.Metaplex.NFT.Library;
using Solana.Unity.Metaplex.Utilities.Json;
using Solana.Unity.SDK;
using Solana.Unity.SDK.Nft;
using Solana.Unity.Wallet;
using UnityEngine;

namespace Services
{
    /// <summary>
    /// Handles all logic related to NFTs and calculating their power level or whatever you like to do with the NFTs
    /// </summary>
    public class NftService : MonoBehaviour, IMultiSceneSingleton
    {
        public const string NftCreator = "8DQSv6bnq2oomwk15sq1tiS6f1FXecxyBaHVeBG9BhPV";

        public List<Nft> LoadedNfts = new ();
        public bool IsLoadingTokenAccounts { get; private set; }
        public Nft SelectedNft { get; private set; }
        public Texture2D LocalDummyNft;
        public bool LoadNftsOnStartUp = true;
        public bool AddDummyNft = true;

        public void Awake()
        {
            if (ServiceFactory.Resolve<NftService>() != null)
            {
                Destroy(gameObject);
                return;
            }

            ServiceFactory.RegisterSingleton(this);
            Web3.OnLogin += OnLogin;
        }

        private void OnLogin(Account obj)
        {
            if (!LoadNftsOnStartUp)
            {
                return;
            }

            LoadNfts();
        }

        public void LoadNfts()
        {
            LoadedNfts.Clear();
            Web3.AutoLoadNfts = false;
            Web3.LoadNFTs();
            IsLoadingTokenAccounts = true;
            Web3.OnNFTsUpdate += (nfts, totalAmount) =>
            {
                foreach (var newNft in nfts)
                {
                    bool wasAlreadyLoaded = false;
                    foreach (var oldNft in LoadedNfts)
                    {
                        if (newNft.metaplexData.data.mint == oldNft.metaplexData.data.mint)
                        {
                            wasAlreadyLoaded = true;
                        }
                    }

                    if (!wasAlreadyLoaded)
                    {
                        MessageRouter.RaiseMessage(new NftLoadedMessage(newNft));
                        LoadedNfts.Add(newNft);
                    }
                }

                IsLoadingTokenAccounts = nfts.Count != totalAmount;
            };
            if (AddDummyNft)
            {
                var dummyLocalNft = CreateDummyLocalNft(Web3.Account.PublicKey);
                LoadedNfts.Add(dummyLocalNft);
                MessageRouter.RaiseMessage(new NftLoadedMessage(dummyLocalNft));
            }
        }

        public Nft CreateDummyLocalNft(string publicKey)
        {
            Nft dummyLocalNft = new Nft();

            var constructor = typeof(MetadataAccount).GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance,
                null, new Type[0], null);
            MetadataAccount metaPlexData = (MetadataAccount) constructor.Invoke(null);

            metaPlexData.offchainData = new MetaplexTokenStandard();
            metaPlexData.offchainData.symbol = "dummy";
            metaPlexData.offchainData.name = "Dummy Nft";
            metaPlexData.offchainData.description = "A dummy nft which uses the wallet puy key";
            metaPlexData.mint = publicKey;

            dummyLocalNft.metaplexData = new Metaplex(metaPlexData);
            dummyLocalNft.metaplexData.nftImage = new NftImage()
            {
                name = "DummyNft",
                file = LocalDummyNft
            };

            return dummyLocalNft;
        }

        public bool IsNftSelected(Nft nft)
        {
            return nft.metaplexData.data.mint == GetSelectedNftPubKey();
        }

        private string GetSelectedNftPubKey()
        {
            return PlayerPrefs.GetString("SelectedNft");
        }

        public bool OwnsNftOfUpdateAuthority(string authority)
        {
            foreach (var nft in LoadedNfts)
            {
                if (nft.metaplexData.data.updateAuthority != null && nft.metaplexData.data.updateAuthority == authority)
                {
                    return true;
                }
            }

            return false;
        }

        public bool OwnsNftByCreator(string creator)
        {
            foreach (var nft in LoadedNfts)
            {
                if (nft.metaplexData.data.metadata != null && nft.metaplexData.data.metadata.creators != null)
                {
                    foreach (var nftCreator in nft.metaplexData.data.metadata.creators)
                    {
                        if (nftCreator.key == creator)
                        {
                            return true;       
                        }
                    }
                }
            }

            return false;
        }

        public void SelectNft(Nft nft)
        {
            if (nft == null)
            {
                return;
            }

            SelectedNft = nft;
            PlayerPrefs.SetString("SelectedNft", SelectedNft.metaplexData.data.mint);
            MessageRouter.RaiseMessage(new NftSelectedMessage(SelectedNft));
        }

        public void ResetSelectedNft()
        {
            SelectedNft = null;
            PlayerPrefs.DeleteKey("SelectedNft");
            MessageRouter.RaiseMessage(new NftSelectedMessage(SelectedNft));
        }

        public IEnumerator HandleNewSceneLoaded()
        {
            yield return null;
        }
    }

    public class NftLoadedMessage
    {
        public Nft Nft;

        public NftLoadedMessage(Nft nft)
        {
            Nft = nft;
        }
    }

    public class NftSelectedMessage
    {
        public Nft NewNFt;

        public NftSelectedMessage(Nft newNFt)
        {
            NewNFt = newNFt;
        }
    }

    public class NftLoadingStartedMessage
    {
    }

    public class NftLoadingFinishedMessage
    {
    }

    public class NftMintFinishedMessage
    {
    }
}