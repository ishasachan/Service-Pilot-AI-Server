import { randomUUID } from "node:crypto";

import type {
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";

/**
 * In-memory store for dynamically registered OAuth clients (Claude, ChatGPT, Inspector).
 */
export class ServicePilotClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  /** Looks up a registered OAuth client by client_id. */
  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  /** Registers a new OAuth client (dynamic client registration). */
  async registerClient(
    clientMetadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    // SDK may pre-assign client_id before calling the store (runtime vs declared type).
    const incoming = clientMetadata as Partial<OAuthClientInformationFull>;
    const clientId = incoming.client_id ?? randomUUID();
    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId,
      client_id_issued_at:
        incoming.client_id_issued_at ?? Math.floor(Date.now() / 1000),
    };

    this.clients.set(clientId, client);
    return client;
  }
}
