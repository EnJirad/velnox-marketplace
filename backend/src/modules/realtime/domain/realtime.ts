export const REALTIME_CHANNELS = {
  CART_UPDATED: "cart:updated",
  ORDER_CREATED: "order:created",
  ORDER_UPDATED: "order:updated",
  PRODUCT_UPDATED: "product:updated",
  INVENTORY_UPDATED: "inventory:updated",
  SELLER_UPDATED: "seller:updated",
  NOTIFICATION_CREATED: "notification:created",
  PROFILE_UPDATED: "profile:updated",
  CHAT_MESSAGE: "chat:message",
  CHAT_READ: "chat:read",
  CHAT_TYPING: "chat:typing",
  CHAT_PRESENCE: "chat:presence",
  CHAT_CONVERSATION: "chat:conversation",
} as const;

export type RealtimeChannel = (typeof REALTIME_CHANNELS)[keyof typeof REALTIME_CHANNELS];

export interface RealtimeEnvelope<T = any> {
  readonly channel: string;
  readonly event: string;
  readonly data: T;
  readonly timestamp: number;
}

export interface UserPresence {
  readonly userId: string;
  readonly isOnline: boolean;
  readonly lastSeenAt: number | null;
  readonly activeConnectionsCount: number;
}

export type NotificationCategory = "order" | "chat" | "system" | "promotion";

export interface PushNotificationRequest {
  readonly recipientUserId: string;
  readonly title: string;
  readonly body: string;
  readonly category: NotificationCategory;
  readonly data?: Record<string, string>;
  readonly priority?: "high" | "normal";
  readonly conversationId?: string; // If set, checks active viewing presence
}

export interface DeviceTokenRegistration {
  readonly userId: string;
  readonly token: string;
  readonly platform: "android" | "ios" | "web";
}
