using System;

namespace Game.Scripts
{
    public class SolanaUtils
    {
        public const long SolToLamports = 1000000000;
    }

    public static class ArrayUtils
    {
        public static T[] Slice<T>(this T[] arr, uint indexFrom, uint indexTo) {
            if (indexFrom > indexTo) {
                throw new ArgumentOutOfRangeException("indexFrom is bigger than indexTo!");
            }

            uint length = indexTo - indexFrom;
            T[] result = new T[length];
            Array.Copy(arr, indexFrom, result, 0, length);

            return result;
        }
    }
    
}