using Frictionless;
using Game.Scripts.Ui;
using Services;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Screen that loads all NFTs when opened
/// </summary>
public class NftListPopup : BasePopup
{
    public Button GetNFtsDataButton;
    public Button MintInAppButton;
    public NftItemListView NftItemListView;
    public GameObject YouDontOwnANftOfCollectionRoot;
    public GameObject YouOwnANftOfCollectionRoot;
    public GameObject LoadingSpinner;
    public GameObject MinitingBlocker;

    void Start()
    {
        GetNFtsDataButton.onClick.AddListener(OnGetNftButtonClicked);
        MintInAppButton.onClick.AddListener(OnMintInAppButtonClicked);
        
        MessageRouter
            .AddHandler<NftLoadingStartedMessage>(OnNftLoadingStartedMessage);
        MessageRouter
            .AddHandler<NftLoadingFinishedMessage>(OnNftLoadingFinishedMessage);
        MessageRouter
            .AddHandler<NftLoadedMessage>(OnNftLoadedMessage);
        MessageRouter
            .AddHandler<NftMintFinishedMessage>(OnNftMintFinishedMessage);
        MessageRouter
            .AddHandler<NftSelectedMessage>(OnNftSelectedMessage);
    }

    private void OnNftSelectedMessage(NftSelectedMessage obj)
    {
        Close();
    }

    public override void Open(UiService.UiData uiData)
    {
        var nftListPopupUiData = (uiData as NftListPopupUiData);

        if (nftListPopupUiData == null)
        {
            Debug.LogError("Wrong ui data for nft list popup");
            return;
        }

        NftItemListView.UpdateContent();
        NftItemListView.SetData(nft =>
        {
            // when an nft was selected we want to close the popup so we can start the game.
            Close();
        });
        
        UpdateOwnCollectionStatus();
        base.Open(uiData);
    }

    private async void OnMintInAppButtonClicked()
    {
        if (MinitingBlocker != null)
        {
            MinitingBlocker.gameObject.SetActive(true);
        }

        // Mint a pirate ship
        var signature = await ServiceFactory.Resolve<NftMintingService>()
            .MintNftWithMetaData(
                "https://shdw-drive.genesysgo.net/QZNGUVnJgkw6sGQddwZVZkhyUWSUXAjXF9HQAjiVZ55/DummyPirateShipMetaData.json",
                "Simple Pirate Ship", "Pirate", success=>
                {
                    if (MinitingBlocker != null)
                    {
                        MinitingBlocker.gameObject.SetActive(false);
                    }

                    if (success)
                    {
                        RequestNfts();   
                    }
                });
        Debug.Log("Mint signature: " + signature);
    }

    private void OnNftLoadedMessage(NftLoadedMessage message)
    {
        NftItemListView.AddNFt(message.Nft);
        UpdateOwnCollectionStatus();
    }

    private bool UpdateOwnCollectionStatus()
    {
        var nftService = ServiceFactory.Resolve<NftService>();
        bool ownsAndNftOfAuthority = nftService.OwnsNftByCreator(NftService.NftCreator);
        YouDontOwnANftOfCollectionRoot.gameObject.SetActive(!ownsAndNftOfAuthority);
        YouOwnANftOfCollectionRoot.gameObject.SetActive(ownsAndNftOfAuthority);
        return ownsAndNftOfAuthority;
    }

    private void OnGetNftButtonClicked()
    {
        RequestNfts();
    }

    private void OnNftLoadingStartedMessage(NftLoadingStartedMessage message)
    {
        GetNFtsDataButton.interactable = false;
    }

    private void OnNftLoadingFinishedMessage(NftLoadingFinishedMessage message)
    {
        NftItemListView.UpdateContent();
    }

    private void OnNftMintFinishedMessage(NftMintFinishedMessage message)
    {
        RequestNfts();
    }

    private void Update()
    {
        var nftService = ServiceFactory.Resolve<NftService>();
        if (nftService != null)
        {
            GetNFtsDataButton.interactable = !nftService.IsLoadingTokenAccounts;
            LoadingSpinner.gameObject.SetActive(nftService.IsLoadingTokenAccounts);
        }
    }

    private void RequestNfts()
    {
        ServiceFactory.Resolve<NftService>().LoadNfts();
    }
}
