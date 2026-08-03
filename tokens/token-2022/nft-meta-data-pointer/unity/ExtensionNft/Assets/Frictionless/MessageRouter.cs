using System;
using System.Collections.Generic;

namespace Frictionless
{
	public static class MessageRouter
	{
		private static readonly Dictionary<Type,List<MessageHandler>> Handlers = new Dictionary<Type, List<MessageHandler>>();
		private static readonly List<Delegate> PendingRemovals = new List<Delegate>();
		private static bool _isRaisingMessage;

		public static void AddHandler<T>(Action<T> handler)
		{
			if (!Handlers.TryGetValue(typeof(T), out var delegates))
			{
				delegates = new List<MessageHandler>();
				Handlers[typeof(T)] = delegates;
			}
			if (delegates.Find(x => x.Delegate == (Delegate) handler) == null)
				delegates.Add(new MessageHandler() { Target = handler.Target, Delegate = handler });
		}

		public static void RemoveHandler<T>(Action<T> handler)
		{
			if (Handlers.TryGetValue(typeof(T), out var delegates))
			{
				MessageHandler existingHandler = delegates.Find(x => x.Delegate == (Delegate) handler);
				if (existingHandler != null)
				{
					if (_isRaisingMessage)
						PendingRemovals.Add(handler);
					else
						delegates.Remove(existingHandler);
				}
			}
		}

		public static void Reset()
		{
			Handlers.Clear();
		}

		public static void RaiseMessage(object msg)
		{
			try
			{
				if (Handlers.TryGetValue(msg.GetType(), out var delegates))
				{
					_isRaisingMessage = true;
					try
					{
						foreach (MessageHandler h in delegates)
						{
	#if NETFX_CORE
							h.Delegate.DynamicInvoke(msg);
	#else
							h.Delegate.Method.Invoke(h.Target, new object[] { msg });
	#endif
						}
					}
					finally
					{
						_isRaisingMessage = false;
					}
					foreach (Delegate d in PendingRemovals)
					{
						MessageHandler existingHandler = delegates.Find(x => x.Delegate == d);
						if (existingHandler != null)
							delegates.Remove(existingHandler);
					}
					PendingRemovals.Clear();
				}
			}
			catch(Exception ex)
			{
				UnityEngine.Debug.LogError("Exception while raising message " + msg + ": " + ex);
			}
		}

		public class MessageHandler
		{
			public object Target { get; set; }
			public Delegate Delegate { get; set; }
		}
	}
}