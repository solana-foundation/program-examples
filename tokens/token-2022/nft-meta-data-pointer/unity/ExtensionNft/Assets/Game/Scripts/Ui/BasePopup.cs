using Services;
using UnityEngine;
using UnityEngine.UI;

namespace Game.Scripts.Ui
{
    public class BasePopup : MonoBehaviour
    {
        public GameObject Root;
        public Button CloseButton;

        protected void Awake()
        {
            Root.gameObject.SetActive(false);
        }

        public virtual void Open(UiService.UiData uiData)
        {
            if (CloseButton != null)
            {
                CloseButton.onClick.RemoveAllListeners();
                CloseButton.onClick.AddListener(OnCloseButtonClicked);
            }

            Root.gameObject.SetActive(true);
        }

        public virtual void Close()
        {
            Root.gameObject.SetActive(false);
        }

        protected void OnCloseButtonClicked()
        {
            Close();
        }
    }
}