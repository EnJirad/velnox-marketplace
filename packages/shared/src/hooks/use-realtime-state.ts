import { useEffect, useState } from "react";
import {
  getChatSocketState,
  onChatSocketState,
  type ChatSocketState,
} from "../lib/chat-socket";

/**
 * Reactive view of the shared realtime connection state.
 *
 * UI renders "connected" only when the socket is actually OPEN; any other state
 * (connecting, reconnecting, closed) is surfaced as a subtle reconnecting hint.
 */
export function useRealtimeState(): ChatSocketState {
  const [state, setState] = useState<ChatSocketState>(getChatSocketState);
  useEffect(() => {
    setState(getChatSocketState());
    return onChatSocketState(setState);
  }, []);
  return state;
}
