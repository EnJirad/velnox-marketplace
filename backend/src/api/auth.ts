import { Router } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { authenticate, signToken } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

// Helper: find or create user from Google profile
async function resolveUser(profile: {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}) {
  // Step 1: Find by provider + provider_id
  const identityResult = await query(
    `SELECT user_id FROM user_auth_identities
     WHERE provider = 'google' AND provider_id = $1`,
    [profile.sub]
  );

  if (identityResult.rows.length > 0) {
    const userResult = await query(
      "SELECT id, email, name, avatar FROM users WHERE id = $1",
      [identityResult.rows[0].user_id]
    );
    return userResult.rows[0];
  }

  // Step 2: Find by normalized email
  const normalizedEmail = profile.email.toLowerCase().trim();
  const existingUser = await query(
    "SELECT id, email, name, avatar FROM users WHERE LOWER(email) = $1",
    [normalizedEmail]
  );

  if (existingUser.rows.length > 0) {
    const user = existingUser.rows[0];
    // Link identity
    await query(
      `INSERT INTO user_auth_identities (user_id, provider, provider_id, email)
       VALUES ($1, 'google', $2, $3)
       ON CONFLICT (provider, provider_id) DO NOTHING`,
      [user.id, profile.sub, normalizedEmail]
    );
    return user;
  }

  // Step 3: Create new user
  const newUser = await query(
    `INSERT INTO users (email, name, avatar)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, avatar`,
    [normalizedEmail, profile.name, profile.picture || null]
  );

  const user = newUser.rows[0];

  // Create auth identity
  await query(
    `INSERT INTO user_auth_identities (user_id, provider, provider_id, email)
     VALUES ($1, 'google', $2, $3)`,
    [user.id, profile.sub, normalizedEmail]
  );

  // Create customer profile
  await query(
    "INSERT INTO customer_profiles (user_id) VALUES ($1)",
    [user.id]
  );

  // Create cart
  await query(
    "INSERT INTO carts (user_id) VALUES ($1)",
    [user.id]
  );

  return user;
}

// GET /api/auth/google — Redirect to Google OAuth
router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const scope = "openid email profile";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline`;
  res.redirect(url);
});

// GET /api/auth/google/callback — Handle Google OAuth callback
router.get("/google/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.redirect("http://localhost:5173/auth?error=no_code");
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${req.protocol}://${req.get("host")}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      return res.redirect("http://localhost:5173/auth?error=token_exchange_failed");
    }

    // Get user info from Google
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = (await userRes.json()) as {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };

    // Resolve user (find or create)
    const user = await resolveUser({
      sub: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
    });

    // Sign JWT
    const token = signToken({ userId: user.id, email: user.email });

    // Set httpOnly cookie
    res.cookie("velnox_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    // Redirect to frontend
    const frontendUrl = process.env.CORS_ORIGINS?.split(",")[0] || "http://localhost:5173";
    res.redirect(`${frontendUrl}/products`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect("http://localhost:5173/auth?error=callback_failed");
  }
});

// GET /api/auth/me — Get current user
router.get("/me", authenticate, async (req, res) => {
  try {
    const result = await query(
      "SELECT id, email, name, avatar, created_at, updated_at FROM users WHERE id = $1",
      [req.user!.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    res.json({ success: true, data: { user: result.rows[0] } });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get user" },
    });
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.cookie("velnox_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  res.json({ success: true, data: { success: true } });
});

export { router as authRouter };
