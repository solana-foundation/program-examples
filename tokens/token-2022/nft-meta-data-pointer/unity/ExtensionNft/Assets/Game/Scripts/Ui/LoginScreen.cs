using System;
using ExtensionNft.Accounts;
using Solana.Unity.SDK;
using Solana.Unity.Wallet.Bip39;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

/// <summary>
/// Handles the connection to the players wallet.
/// </summary>
public class LoginScreen : MonoBehaviour
{
    public Button LoginButton;
    public Button LoginWalletAdapterButton;
    
    void Start()
    {
        LoginButton.onClick.AddListener(OnEditorLoginClicked);
        LoginWalletAdapterButton.onClick.AddListener(OnLoginWalletAdapterButtonClicked);
        AnchorService.OnPlayerDataChanged += OnPlayerDataChanged;
        AnchorService.OnInitialDataLoaded += UpdateContent;
    }

    private void OnDestroy()
    {
        AnchorService.OnPlayerDataChanged -= OnPlayerDataChanged;
        AnchorService.OnInitialDataLoaded -= UpdateContent;
    }

    private async void OnLoginWalletAdapterButtonClicked()
    {
        await Web3.Instance.LoginWalletAdapter();
    }

    private void OnPlayerDataChanged(PlayerData playerData)
    {
        UpdateContent();
    }

    private void UpdateContent()
    {
        if (Web3.Account != null)
        {
            SceneManager.LoadScene("GameScene");
        }
    }

    private async void OnEditorLoginClicked()
    {
        var newMnemonic = new Mnemonic(WordList.English, WordCount.Twelve);

        // Dont use this one for production. Its only ment for editor login
        var account = await Web3.Instance.LoginInGameWallet("1234") ??
                      await Web3.Instance.CreateAccount(newMnemonic.ToString(), "1234");
    }
}
