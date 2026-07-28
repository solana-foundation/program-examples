using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;

using Frictionless;
using Game.Scripts;
using Solana.Unity.Metaplex.NFT.Library;
using Solana.Unity.Programs;
using Solana.Unity.Rpc.Builders;
using Solana.Unity.Rpc.Core.Http;
using Solana.Unity.Rpc.Messages;
using Solana.Unity.Rpc.Types;
using Solana.Unity.SDK;
using Solana.Unity.Wallet;
using UnityEngine;
using Creator = Solana.Unity.Metaplex.NFT.Library.Creator;
using MetadataProgram = Solana.Unity.Metaplex.NFT.Library.MetadataProgram;
using PublicKey = Solana.Unity.Wallet.PublicKey;
using Transaction = Solana.Unity.Rpc.Models.Transaction;

namespace Services
{
    public class NftMintingService : MonoBehaviour, IMultiSceneSingleton
    {
        public void Awake()
        {
            if (ServiceFactory.Resolve<NftMintingService>() != null)
            {
                Destroy(gameObject);
                return;
            }

            ServiceFactory.RegisterSingleton(this);
        }

        public IEnumerator HandleNewSceneLoaded()
        {
            yield return null;
        }

        public async Task<string> MintNftWithMetaData(string metaDataUri, string name, string symbol, Action<bool> onMintDone = null)
        {
            var account = Web3.Account;
            var rpcClient = Web3.Rpc;

            Account mint = new Account();
            var associatedTokenAccount = AssociatedTokenAccountProgram
                .DeriveAssociatedTokenAccount(account, mint.PublicKey);
            
            var fromAccount = account;

            RequestResult<ResponseValue<ulong>> balance =
                await rpcClient.GetBalanceAsync(account.PublicKey, Commitment.Confirmed);

            if (balance.Result != null && balance.Result.Value < SolanaUtils.SolToLamports / 10)
            {
                Debug.Log("Sol balance is low. Minting may fail");
            }

            Debug.Log($"Balance: {balance.Result.Value} ");
            Debug.Log($"Mint key : {mint.PublicKey} ");

            var blockHash = await rpcClient.GetLatestBlockHashAsync();
            var rentMint = await rpcClient.GetMinimumBalanceForRentExemptionAsync(
                TokenProgram.MintAccountDataSize,
                Commitment.Confirmed
            );
            var rentToken = await rpcClient.GetMinimumBalanceForRentExemptionAsync(
                TokenProgram.TokenAccountDataSize,
                Commitment.Confirmed
            );


            //2. create a mint and a token
            var createMintAccount = SystemProgram.CreateAccount(
                fromAccount,
                mint,
                rentMint.Result,
                TokenProgram.MintAccountDataSize,
                TokenProgram.ProgramIdKey
            );
            var initializeMint = TokenProgram.InitializeMint(
                mint.PublicKey,
                0,
                fromAccount.PublicKey,
                fromAccount.PublicKey
            );
            var createTokenAccount = AssociatedTokenAccountProgram.CreateAssociatedTokenAccount(
                fromAccount,
                fromAccount,
                mint.PublicKey);

            var mintTo = TokenProgram.MintTo(
                mint.PublicKey,
                associatedTokenAccount,
                1,
                fromAccount.PublicKey
            );

            // If you freeze the account the users will not be able to transfer the NFTs anywhere or burn them
            /*var freezeAccount = TokenProgram.FreezeAccount(
                tokenAccount,
                mintAccount,
                fromAccount,
                TokenProgram.ProgramIdKey
            );*/

            // PDA Metadata
            PublicKey metadataAddressPDA;
            byte nonce;
            PublicKey.TryFindProgramAddress(
                new List<byte[]>()
                {
                    Encoding.UTF8.GetBytes("metadata"),
                    MetadataProgram.ProgramIdKey,
                    mint.PublicKey
                },
                MetadataProgram.ProgramIdKey,
                out metadataAddressPDA,
                out nonce
            );

            Console.WriteLine($"PDA METADATA: {metadataAddressPDA}");

            // PDA master edition (Makes sure there can only be one minted) 
            PublicKey masterEditionAddress;

            PublicKey.TryFindProgramAddress(
                new List<byte[]>()
                {
                    Encoding.UTF8.GetBytes("metadata"),
                    MetadataProgram.ProgramIdKey,
                    mint.PublicKey,
                    Encoding.UTF8.GetBytes("edition"),
                },
                MetadataProgram.ProgramIdKey,
                out masterEditionAddress,
                out nonce
            );
            Console.WriteLine($"PDA MASTER: {masterEditionAddress}");

            // Craetors
            var creator1 = new Creator(fromAccount.PublicKey, 100, false);

            // Meta Data
            var data = new Metadata()
            {
                name = name,
                symbol = symbol,
                uri = metaDataUri,
                creators = new List<Creator>() {creator1},
                sellerFeeBasisPoints = 77
            };

            var signers = new List<Account> {fromAccount, mint};
            var transactionBuilder = new TransactionBuilder()
                .SetRecentBlockHash(blockHash.Result.Value.Blockhash)
                .SetFeePayer(fromAccount)
                .AddInstruction(createMintAccount)
                .AddInstruction(initializeMint)
                .AddInstruction(createTokenAccount)
                .AddInstruction(mintTo)
                //.AddInstruction(freezeAccount)
                .AddInstruction(
                    MetadataProgram.CreateMetadataAccount(
                        metadataAddressPDA, // PDA
                        mint,
                        fromAccount.PublicKey,
                        fromAccount.PublicKey,
                        fromAccount.PublicKey, // update Authority 
                        data, // DATA
                        TokenStandard.NonFungible,
                        true,
                        true, // ISMUTABLE,
                        masterEditionKey: null,
                        1,
                        0UL,
                        MetadataVersion.V3
                    )
                )
                .AddInstruction(
                    MetadataProgram.SignMetadata(
                        metadataAddressPDA,
                        creator1.key
                    )
                )
               .AddInstruction(
                    MetadataProgram.PuffMetada(
                        metadataAddressPDA
                    )
                )
                /*.AddInstruction(
                    MetadataProgram.CreateMasterEdition(
                        1,
                        masterEditionAddress,
                        mintAccount,
                        fromAccount.PublicKey,
                        fromAccount.PublicKey,
                        fromAccount.PublicKey,
                        metadataAddressPDA
                    )
                )*/;

            var tx = Transaction.Deserialize(transactionBuilder.Build(new List<Account> {fromAccount, mint}));
            var res = await Web3.Wallet.SignAndSendTransaction(tx, true, Commitment.Confirmed);
            await Web3.Rpc.ConfirmTransaction(res.Result, Commitment.Confirmed);
            Debug.Log(res.Result);

            if (!res.WasSuccessful)
            {
                onMintDone?.Invoke(false);
                Debug
                    .Log("Mint was not successfull: " + res.Reason);
            }
            else
            {
                onMintDone?.Invoke(true);
                Debug.Log("Mint Successfull! Woop woop!");
            }

            return res.Result;
        }
    }
}