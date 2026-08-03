using UnityEngine;

namespace Game.Scripts
{
    public class SimpleRotate : MonoBehaviour
    {
        public enum Axis
        {
            x,
            y,
            z
        }

        public float speed = 0.1f;
        public Axis RotationAxis = Axis.x;

        void Update()
        {
            var rotationAxis = Vector3.zero;
            switch (RotationAxis)
            {
                case Axis.x:
                    rotationAxis = Vector3.forward;
                    break;
                case Axis.y:
                    rotationAxis = Vector3.up;
                    break;
                case Axis.z:
                    rotationAxis = Vector3.right;
                    break;
            }

            transform.Rotate(rotationAxis * Time.deltaTime, speed);
        }
    }
}