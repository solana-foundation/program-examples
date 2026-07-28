using Frictionless;
using Solana.Unity.Programs;
using Solana.Unity.Rpc.Types;
using Solana.Unity.SDK;
using Solana.Unity.Wallet;
using TMPro;
using UnityEngine;

namespace Game.Scripts.Ui
{
    /// <summary>
    /// Shows the amount of the token "TokenMintAddress" from the connected Wallet.
    /// </summary>
    public class TokenPanel : MonoBehaviour
    {
        public TextMeshProUGUI TokenAmount;

        public string
            TokenMintAdress =
                "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // Replace with whatever token you like. (Default USDC)

        private PublicKey _associatedTokenAddress;
        
        void Awake()
        {
            Web3.OnLogin += onLogin;
            UpdateAndSubscribeToTokenAccount();
        }
        
        void OnDestroy()
        {
            Web3.OnLogin -= onLogin;
        }

        private void onLogin(Account account)
        {
            UpdateAndSubscribeToTokenAccount();
        }

        private async void UpdateAndSubscribeToTokenAccount()
        {
            if (Web3.Instance == null || Web3.Instance.WalletBase.Account == null)
            {
                return;
            }
            
            var wallet = Web3.Instance.WalletBase;

            if (wallet != null && wallet.Account.PublicKey != null)
            {
                _associatedTokenAddress =
                    AssociatedTokenAccountProgram.DeriveAssociatedTokenAccount(wallet.Account.PublicKey, new PublicKey(TokenMintAdress));
            }
            
            if (_associatedTokenAddress == null)
            {
                return;
            }

            await Web3.WsRpc.SubscribeTokenAccountAsync(_associatedTokenAddress, (state, value) =>
            {
                TokenAmount.text = value.Value.Data.Parsed.Info.TokenAmount.UiAmountString;
                Debug.Log("Token balance (Socket Token): " + value.Value.Data.Parsed.Info.TokenAmount.UiAmountString);
            }, Commitment.Confirmed);
            
            var tokenBalance = await wallet.ActiveRpcClient.GetTokenAccountBalanceAsync(_associatedTokenAddress, Commitment.Confirmed);
            if (tokenBalance.Result == null || tokenBalance.Result.Value == null)
            {
                TokenAmount.text = "0";
                return;
            }
            TokenAmount.text = tokenBalance.Result.Value.UiAmountString;
        }
    }
}