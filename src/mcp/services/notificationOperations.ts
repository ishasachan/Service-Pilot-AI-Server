/**
 * Notification operations exposed as MCP tools.
 */
import "../shared/loadEnv";

import { supabase } from "../../config/db";
import { createDriverAssignmentNotification } from "../../controllers/notification.controller";
import { broadcastDispatchUpdate } from "../../realtime/broadcast";

/**
 * Sends an in-app notification to a driver (e.g. new assignment alert).
 *
 * @param input.driverId - Target driver ID.
 * @param input.title - Notification title.
 * @param input.message - Notification body.
 */
export async function notifyDriver(input: {
  driverId: string;
  title: string;
  message: string;
}) {
  await createDriverAssignmentNotification(
    input.driverId,
    input.title,
    input.message,
  );

  await broadcastDispatchUpdate("notifications", input.driverId);

  return {
    success: true as const,
    message: "Driver notified",
  };
}

/**
 * Fetches the 20 most recent notifications for a user.
 *
 * @param userId - Auth user UUID (not driver ID).
 */
export async function getNotifications(userId: string) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { success: false as const, message: error.message };
  }

  return {
    success: true as const,
    count: data?.length ?? 0,
    notifications: (data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      type: item.type,
      read: item.read,
      time: item.created_at,
    })),
  };
}

/**
 * Marks a single notification as read for the given user.
 *
 * @param input.userId - Auth user UUID who owns the notification.
 * @param input.notificationId - Notification UUID to mark read.
 */
export async function markNotificationRead(input: {
  userId: string;
  notificationId: string;
}) {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", input.notificationId)
    .eq("user_id", input.userId);

  if (error) {
    return { success: false as const, message: error.message };
  }

  return { success: true as const, message: "Notification marked as read" };
}
