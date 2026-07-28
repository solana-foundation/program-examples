namespace Frictionless
{
    public interface IReinitializingMultiSceneSingleton : IMultiSceneSingleton
    {
        void ReinitializeAfterSceneLoad();
    }
}