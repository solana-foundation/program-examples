using System;
using System.Collections.Generic;
using Frictionless;
using Game.Scripts.Ui;
using Solana.Unity.SDK.Nft;
using Services;
using UnityEngine;

// Shows a list of all nfts in the NftService
public class NftItemListView : MonoBehaviour
{
    public GameObject ItemRoot;
    public NftItemView itemPrefab;
    public string FilterSymbol;
    public string BlackList;

    private List<NftItemView> allNftItemViews = new List<NftItemView>();
    private Action<Nft> onNftSelected;

    public void OnEnable()
    {
        UpdateContent();
    }

    public void Start()
    {
        MessageRouter.AddHandler<NftSelectedMessage>(OnNFtSelectedMessage);
    }

    public void SetData(Action<Nft> onNftSelected)
    {
        this.onNftSelected = onNftSelected;
    }

    private void OnNFtSelectedMessage(NftSelectedMessage message)
    {
        UpdateContent();
    }

    public void UpdateContent()
    {
        var nftService = ServiceFactory.Resolve<NftService>();
        if (nftService == null)
        {
            return;
        }

        foreach (Nft nft in nftService.LoadedNfts)
        {
            AddNFt(nft);
        }

        List<NftItemView> notExistingNfts = new List<NftItemView>();
        foreach (NftItemView nftItemView in allNftItemViews)
        {
            bool existsInWallet = false;
            foreach (Nft walletNft in nftService.LoadedNfts)
            {
                if (nftItemView.CurrentMetaPlexNFt.metaplexData.data.mint == walletNft.metaplexData.data.mint)
                {
                    existsInWallet = true;
                    break;
                }
            }

            if (!existsInWallet)
            {
                notExistingNfts.Add(nftItemView);
            }
        }

        for (var index = notExistingNfts.Count - 1; index >= 0; index--)
        {
            var nftView = notExistingNfts[index];
            allNftItemViews.Remove(nftView);
            Destroy(nftView.gameObject);
        }
    }

    public void AddNFt(Nft metaPlexNFt)
    {
        foreach (var nft in allNftItemViews)
        {
            if (nft.CurrentMetaPlexNFt.metaplexData.data.mint == metaPlexNFt.metaplexData.data.mint)
            {
                nft.SetData(metaPlexNFt, OnItemClicked);
                return;
            }
        }

        InstantiateListNftItem(metaPlexNFt);
    }

    private void InstantiateListNftItem(Nft nft)
    {
        if (string.IsNullOrEmpty(nft.metaplexData.data.mint))
        {
            return;
        }

        if (!string.IsNullOrEmpty(FilterSymbol) && nft.metaplexData.data.offchainData.symbol != FilterSymbol)
        {
            return;
        }

        if (!string.IsNullOrEmpty(BlackList) && nft.metaplexData.data.offchainData.symbol == BlackList)
        {
            return;
        }

        NftItemView nftItemView = Instantiate(itemPrefab, ItemRoot.transform);
        nftItemView.SetData(nft, OnItemClicked);
        allNftItemViews.Add(nftItemView);
    }

    private void OnItemClicked(NftItemView itemView)
    {
        ServiceFactory.Resolve<NftContextMenu>().Open(itemView, onNftSelected);
    }
}
