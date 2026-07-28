using System;
using Services;
using Solana.Unity.SDK;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Game.Scripts.Ui
{
    /// <summary>
    /// Screen that loads all NFTs when opened
    /// </summary>
    public class SessionPopup : BasePopup
    {
        public Button CreateSessionButton;
        public Button RevokeSessionButton;
        
        public TextMeshProUGUI SessionBalanceText;
        public TextMeshProUGUI SessionExpiryText;
        
        public GameObject LoadingSpinner;

        private bool loadedNfts;
        
        void Start()
        {
            CreateSessionButton.onClick.AddListener(OnCreatSessionWalletButtonClicked);
            RevokeSessionButton.onClick.AddListener(OnRevokeSessionButtonClicked);
        }
        
        public override void Open(UiService.UiData uiData)
        {
            UpdateSessionToken();
            InvokeRepeating(nameof(UpdateSessionToken), 0, 3);    
            base.Open(uiData);
        }

        public override void Close()
        {
            CancelInvoke();
            base.Close();
        }

        private async void UpdateSessionToken()
        {
            var sessionToken = await AnchorService.Instance.RequestSessionToken();
            if (sessionToken == null)
            {
                SessionExpiryText.text = "Session expired";
                SessionBalanceText.text = "0 Sol";
                RevokeSessionButton.interactable = false;
                CreateSessionButton.interactable = true;
                return;
            }
            Debug.Log("Session token valid until: " + (new DateTime(1970, 1, 1)).AddSeconds(sessionToken.ValidUntil) + " Now: " + DateTimeOffset.UtcNow);

            var isValid = sessionToken.ValidUntil > DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            SessionExpiryText.text = "Session valid until: " +
                                     (new DateTime(1970, 1, 1)).AddSeconds(sessionToken.ValidUntil); //+ " Now: " + DateTimeOffset.UtcNow + " is valid: " + isValid;
            RevokeSessionButton.interactable = isValid;
            CreateSessionButton.interactable = !isValid;
            var res = await Web3.Wallet.GetBalance(sessionToken.SessionSigner);
            SessionBalanceText.text = res.ToString("F3") + " Sol";
        }

        private async void OnRevokeSessionButtonClicked()
        {
            LoadingSpinner.gameObject.SetActive(true);
            await AnchorService.Instance.RevokeSession();
            LoadingSpinner.gameObject.SetActive(false);
            UpdateSessionToken();
        }

        private async void OnCreatSessionWalletButtonClicked()
        {
            LoadingSpinner.gameObject.SetActive(true);
            await AnchorService.Instance.CreateNewSession();
            LoadingSpinner.gameObject.SetActive(false);
            UpdateSessionToken();
            Close();
        }

    }
}