#pragma warning disable CS0436
using Solana.Unity.SDK;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using WebSocketState = System.Net.WebSockets.WebSocketState;

public class SocketStatusWidget : MonoBehaviour
{
    public TextMeshProUGUI StatusText;
    public Button ReconnectButton;

    private void Awake()
    {
        ReconnectButton.onClick.AddListener(OnReconnectClicked);
    }

    private void OnReconnectClicked()
    {
        // Should automatically reconnect
    }

    void Update()
    {
        if (Web3.WsRpc != null)
        {
            StatusText.text = "Socket: " + Web3.WsRpc.State;
            ReconnectButton.gameObject.SetActive(Web3.WsRpc.State == WebSocketState.Closed);
        }
    }
}