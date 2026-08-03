using System;
using System.Collections;
using System.Collections.Generic;
using Frictionless;
using Game.Scripts.Ui;
using UnityEngine;

namespace Services
{
    public class UiService : MonoBehaviour, IMultiSceneSingleton
    {
        [Serializable]
        public class UiRegistration
        {
            public BasePopup PopupPrefab;
            public ScreenType ScreenType;
        }
        
        public enum ScreenType
        {
            TransferNftPopup = 0,
            NftListPopup = 1,
            SessionPopup = 2
        }

        public class UiData
        {
            
        }
        
        public List<UiRegistration> UiRegistrations = new List<UiRegistration>();
        
        private readonly Dictionary<ScreenType, BasePopup> openPopups = new Dictionary<ScreenType, BasePopup>();

        public void Awake()
        {
            ServiceFactory.RegisterSingleton(this);
        }

        public void OpenPopup(ScreenType screenType, UiData uiData)
        {
            if (openPopups.TryGetValue(screenType, out BasePopup basePopup))
            {
                basePopup.Open(uiData);
                return;
            }
            
            foreach (var uiRegistration in UiRegistrations)
            {
                if (uiRegistration.ScreenType == screenType)
                {
                    BasePopup newPopup = Instantiate(uiRegistration.PopupPrefab);
                    openPopups.Add(screenType, newPopup);
                    newPopup.Open(uiData);
                    return;
                }
            }
            
            Debug.LogWarning("There was no screen registration for " + screenType);
        }

        public IEnumerator HandleNewSceneLoaded()
        {
            openPopups.Clear();
            yield return null;
        }
    }
}