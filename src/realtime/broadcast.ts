import { supabase } from "../config/db";

export type DispatchRealtimeScope = "bookings" | "notifications";

export interface DispatchRealtimePayload {
  scope: DispatchRealtimeScope;
  driverId?: string;
  at: string;
}

const CHANNEL_NAME = "dispatch:live";

let channel: ReturnType<typeof supabase.channel> | null = null;
let subscribePromise: Promise<void> | null = null;

function ensureChannelSubscribed() {
  if (subscribePromise) {
    return subscribePromise;
  }

  channel = supabase.channel(CHANNEL_NAME, {
    config: { broadcast: { self: false } },
  });

  subscribePromise = new Promise((resolve, reject) => {
    channel!.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        resolve();
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`Realtime channel failed: ${status}`));
      }
    });
  });

  return subscribePromise;
}

export async function broadcastDispatchUpdate(
  scope: DispatchRealtimeScope,
  driverId?: string,
) {
  try {
    await ensureChannelSubscribed();

    if (!channel) return;

    const payload: DispatchRealtimePayload = {
      scope,
      driverId,
      at: new Date().toISOString(),
    };

    await channel.send({
      type: "broadcast",
      event: "dispatch-update",
      payload,
    });
  } catch (error) {
    console.error("Realtime broadcast failed:", error);
  }
}
