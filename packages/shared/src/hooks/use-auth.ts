/**
 * Velnox useAuth hook — API-backed
 */
import { useAuth as useAuthClient } from "../lib/api-client";

export function useAuth() {
  return useAuthClient();
}
