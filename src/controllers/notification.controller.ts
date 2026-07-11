import { Response } from "express";

import { supabase } from "../config/db";
import { AuthRequest } from "../middleware/auth.middleware";

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function getNotifications(
  req: AuthRequest,
  res: Response,
) {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    const notifications = (data ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      message: entry.message,
      time: formatRelativeTime(entry.created_at),
      read: entry.read,
      type: entry.type,
    }));

    return res.json({
      success: true,
      notifications,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function markNotificationRead(
  req: AuthRequest,
  res: Response,
) {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.json({
      success: true,
      notification: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function markAllNotificationsRead(
  req: AuthRequest,
  res: Response,
) {
  try {
    const userId = req.user!.id;

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function createDriverAssignmentNotification(
  driverId: string,
  title: string,
  message: string,
) {
  const { data: driverUser } = await supabase
    .from("users")
    .select("id")
    .eq("driver_id", driverId)
    .single();

  if (!driverUser) return;

  await supabase.from("notifications").insert([
    {
      user_id: driverUser.id,
      title,
      message,
      type: "assignment",
      read: false,
    },
  ]);
}
