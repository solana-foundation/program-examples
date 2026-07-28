using UnityEngine;
using System.Collections;

namespace Frictionless
{
	public interface IMultiSceneSingleton
	{
		IEnumerator HandleNewSceneLoaded();
	}
}
