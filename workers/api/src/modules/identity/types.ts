/**
 * Identity & User Domain Types
 */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  phone: string | null;
  role: "customer" | "seller" | "center_staff" | "center_admin" | "center_superadmin" | "owner" | "admin" | "staff";
  status: "active" | "suspended" | "deactivated";
  password_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AuthIdentityRecord {
  id: string;
  user_id: string;
  provider: "google" | "line" | "local";
  provider_user_id: string;
  email: string;
  created_at: Date | string;
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  revoked: boolean;
  expires_at: Date | string;
  created_at: Date | string;
}

export interface NewUser {
  email: string;
  name: string;
  role?: UserRecord["role"];
  password_hash?: string;
  avatar_url?: string;
  phone?: string;
}

export interface NewAuthIdentity {
  user_id: string;
  provider: AuthIdentityRecord["provider"];
  provider_user_id: string;
  email: string;
}

export interface NewRefreshToken {
  user_id: string;
  token_hash: string;
  expires_at: Date;
}
