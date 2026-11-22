export type UserRole = "customer" | "seller" | "admin" | "owner" | "staff";
export type UserStatus = "active" | "disabled" | "pending";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly passwordHash?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly createdAt: number; // timestamp ms
}
