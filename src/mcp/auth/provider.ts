import { randomUUID } from "node:crypto";

import bcrypt from "bcrypt";
import type { Response } from "express";

import { supabase } from "../../config/db";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

import { ServicePilotClientsStore } from "./clientsStore";

export interface ServicePilotUser {
  id: string;
  name: string;
  email: string;
  role: "advisor" | "driver";
  driverId: string | null;
}

interface PendingAuthorization {
  client: OAuthClientInformationFull;
  params: {
    state?: string;
    scopes: string[];
    redirectUri: string;
    codeChallenge: string;
    resource?: URL;
  };
  createdAt: number;
}

interface AuthorizationCodeData {
  client: OAuthClientInformationFull;
  params: PendingAuthorization["params"];
  user: ServicePilotUser;
}

interface AccessTokenData {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
  user: ServicePilotUser;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth 2.1 provider for ServicePilot MCP.
 * Handles authorize → login page → code exchange → bearer tokens with user role embedded.
 */
export class ServicePilotOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new ServicePilotClientsStore();

  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeData>();
  private readonly accessTokens = new Map<string, AccessTokenData>();

  /**
   * Step 1 of OAuth: stores the pending request and redirects user to /oauth/login.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: PendingAuthorization["params"] & { state?: string },
    res: Response,
  ): Promise<void> {
    const pendingId = randomUUID();
    this.pendingAuthorizations.set(pendingId, {
      client,
      params,
      createdAt: Date.now(),
    });

    const frontendUrl = new URL(
      `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/oauth/login`,
    );
    frontendUrl.searchParams.set("oauth_pending", pendingId);

    res.redirect(frontendUrl.toString());
  }

  /**
   * Step 2 of OAuth: called by frontend after login; issues auth code and redirect URL.
   */
  async completeLogin(input: {
    oauthPending: string;
    email: string;
    password: string;
    role: "advisor" | "driver";
  }) {
    this.cleanupExpired();

    const pending = this.pendingAuthorizations.get(input.oauthPending);
    if (!pending) {
      throw new InvalidRequestError("OAuth session expired. Please try connecting again.");
    }

    const user = await this.validateCredentials(
      input.email,
      input.password,
      input.role,
    );

    const code = randomUUID();
    this.authorizationCodes.set(code, {
      client: pending.client,
      params: pending.params,
      user,
    });
    this.pendingAuthorizations.delete(input.oauthPending);

    const redirectUrl = new URL(pending.params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (pending.params.state) {
      redirectUrl.searchParams.set("state", pending.params.state);
    }

    return { redirectUrl: redirectUrl.toString(), user };
  }

  /** Returns the PKCE code challenge stored for an authorization code. */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const codeData = this.authorizationCodes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }
    return codeData.params.codeChallenge;
  }

  /** Step 3 of OAuth: exchanges authorization code for a bearer access token. */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const codeData = this.authorizationCodes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }

    if (codeData.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    this.authorizationCodes.delete(authorizationCode);

    const token = randomUUID();
    const expiresAt = Date.now() + 60 * 60 * 1000;

    this.accessTokens.set(token, {
      clientId: client.client_id,
      scopes: codeData.params.scopes,
      expiresAt,
      resource: codeData.params.resource,
      user: codeData.user,
    });

    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      scope: codeData.params.scopes.join(" "),
    };
  }

  /** Refresh tokens are not implemented in this version. */
  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens are not supported yet");
  }

  /** Validates a bearer token and returns auth info including user role in `extra`. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = this.accessTokens.get(token);
    if (!tokenData || tokenData.expiresAt < Date.now()) {
      throw new Error("Invalid or expired token");
    }

    return {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(tokenData.expiresAt / 1000),
      resource: tokenData.resource,
      extra: {
        userId: tokenData.user.id,
        name: tokenData.user.name,
        email: tokenData.user.email,
        role: tokenData.user.role,
        driverId: tokenData.user.driverId,
      },
    };
  }

  /** Validates email/password against Supabase users table. */
  private async validateCredentials(
    email: string,
    password: string,
    role: "advisor" | "driver",
  ): Promise<ServicePilotUser> {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim())
      .single();

    if (error || !user) {
      throw new InvalidRequestError("Invalid email or password");
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new InvalidRequestError("Invalid email or password");
    }

    if (user.role !== role) {
      throw new InvalidRequestError("Invalid email, password, or role");
    }

    if (role !== "advisor" && role !== "driver") {
      throw new InvalidRequestError("Unsupported role for MCP access");
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      driverId: user.driver_id ?? null,
    };
  }

  /** Removes OAuth login sessions older than 10 minutes. */
  private cleanupExpired() {
    const now = Date.now();
    for (const [id, pending] of this.pendingAuthorizations.entries()) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.pendingAuthorizations.delete(id);
      }
    }
  }
}

/**
 * Extracts the logged-in user (id, role, driverId) from an MCP bearer token.
 *
 * @param auth - Auth info attached by `requireBearerAuth` middleware.
 * @returns User context for tool registration, or null if invalid.
 */
export function getAuthContext(auth?: AuthInfo): ServicePilotUser | null {
  if (!auth?.extra) return null;

  const role = auth.extra.role;
  if (role !== "advisor" && role !== "driver") return null;

  return {
    id: String(auth.extra.userId ?? ""),
    name: String(auth.extra.name ?? ""),
    email: String(auth.extra.email ?? ""),
    role,
    driverId: auth.extra.driverId ? String(auth.extra.driverId) : null,
  };
}
