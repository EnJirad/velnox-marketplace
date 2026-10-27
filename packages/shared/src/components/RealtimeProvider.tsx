import { useAuth } from "@velnox/shared/hooks/use-auth";
import { connectChatSocket, disconnectChatSocket } from "@velnox/shared/lib/chat-socket";
import { useEffect } from "react";

/**
 * RealtimeProvider — the ONE owner of the shared realtime socket.
 *
 * Why this exists: chat pages used to call `disconnectChatSocket()` in their
 * unmount cleanup. The same singleton also powers the header notification bell,
 * so opening and leaving /chat silently killed every realtime notification until
 * a full page reload. Connection ownership now belongs to the app root:
 *
 *   RealtimeProvider (connect while signed in, disconnect on sign-out)
 *          ↓
 *   chat pages / notification bells / VelCenter queues (subscribe only)
 *
 * Pages may still call `connectChatSocket(user.id)` — it is idempotent — but no
 * page may tear the transport down. Renders nothing.
 */
export function RealtimeProvider() {
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      connectChatSocket(user.id);
    } else if (!isAuthenticated) {
      // Signed out (or session expired): close deliberately and stop retrying.
      disconnectChatSocket();
    }
  }, [isAuthenticated, user?.id]);

  return null;
}
