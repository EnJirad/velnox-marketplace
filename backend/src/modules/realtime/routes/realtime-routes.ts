import type { DbQueryable } from "../../../../database/src/types.ts";
import { realtimeHub } from "../services/realtime-hub.ts";
import { PushNotificationService } from "../services/push-notification-service.ts";
import { authenticateRequest } from "../../../core/middleware/auth-middleware.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import type { HttpResponse } from "../../identity/routes/auth-routes.ts";
import type { PushNotificationRequest } from "../domain/realtime.ts";

export class RealtimeController {
  public static getHealth(): HttpResponse {
    const stats = realtimeHub.getStats();
    return {
      status: 200,
      body: {
        success: true,
        data: {
          status: "healthy",
          ...stats,
        },
      },
    };
  }

  public static async getUserPresence(userId: string): Promise<HttpResponse> {
    const presence = realtimeHub.getUserPresence(userId);
    return {
      status: 200,
      body: {
        success: true,
        data: presence,
      },
    };
  }

  public static async sendPushNotification(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body: any,
  ): Promise<HttpResponse> {
    try {
      // Must be authenticated staff or system caller
      await authenticateRequest(db, headers, jwtSecret, ["admin", "staff", "owner"]);

      const req: PushNotificationRequest = {
        recipientUserId: String(body?.recipientUserId ?? ""),
        title: String(body?.title ?? ""),
        body: String(body?.body ?? ""),
        category: body?.category ?? "system",
        data: body?.data,
        priority: body?.priority ?? "normal",
        conversationId: body?.conversationId,
      };

      const result = await PushNotificationService.dispatchNotification(db, req);
      return { status: 200, body: { success: true, data: result } };
    } catch (err: any) {
      if (err instanceof AppError) {
        return {
          status: err.statusCode,
          body: { success: false, error: { code: err.code, message: err.message } },
        };
      }
      return {
        status: 500,
        body: {
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Failed to dispatch notification" },
        },
      };
    }
  }
}
