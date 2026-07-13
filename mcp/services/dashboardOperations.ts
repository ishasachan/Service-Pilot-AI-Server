/**
 * Dashboard analytics operations exposed as MCP tools (advisor only).
 */
import "../shared/loadEnv";

import { supabase } from "../../src/config/db";

/**
 * Returns dealership KPI counts: pending, assigned, in-progress, completed, etc.
 */
export async function dashboardSummary() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("status, priority, driver_id");

  if (error) {
    return { success: false as const, message: error.message };
  }

  const rows = bookings ?? [];
  const pending = rows.filter((b) => b.status === "pending").length;
  const assigned = rows.filter((b) => b.status === "driver_assigned").length;
  const inProgress = rows.filter(
    (b) =>
      !["pending", "driver_assigned", "completed"].includes(String(b.status)),
  ).length;
  const completed = rows.filter((b) => b.status === "completed").length;
  const highPriority = rows.filter((b) => b.priority === "High").length;

  const { data: drivers } = await supabase.from("drivers").select("id");
  const busyDriverIds = new Set(
    rows
      .filter(
        (b) =>
          b.driver_id &&
          !["pending", "completed"].includes(String(b.status)),
      )
      .map((b) => b.driver_id),
  );

  return {
    success: true as const,
    summary: {
      pending,
      assigned,
      inProgress,
      completed,
      highPriority,
      totalDrivers: drivers?.length ?? 0,
      availableDrivers: (drivers?.length ?? 0) - busyDriverIds.size,
    },
  };
}

/**
 * Lists bookings created today, ordered by pickup time.
 */
export async function todayBookings() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("bookings")
    .select("display_id, customer, vehicle, pickup_time, status, priority, driver_name")
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("pickup_time", { ascending: true });

  if (error) {
    return { success: false as const, message: error.message };
  }

  return {
    success: true as const,
    count: data?.length ?? 0,
    bookings: data ?? [],
  };
}

/**
 * Ranks drivers by completed trips and includes ratings.
 */
export async function driverPerformance() {
  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id, name, rating, trips");

  if (driversError) {
    return { success: false as const, message: driversError.message };
  }

  const performance = await Promise.all(
    (drivers ?? []).map(async (driver) => {
      const { count } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("driver_id", driver.id)
        .eq("status", "completed");

      return {
        id: driver.id,
        name: driver.name,
        rating: Number(driver.rating),
        completedTrips: count ?? 0,
        totalTrips: driver.trips,
      };
    }),
  );

  performance.sort((a, b) => b.completedTrips - a.completedTrips);

  return { success: true as const, drivers: performance };
}

/**
 * Counts active (non-completed) bookings grouped by priority (High/Medium/Low).
 */
export async function priorityBreakdown() {
  const { data, error } = await supabase
    .from("bookings")
    .select("priority, status")
    .neq("status", "completed");

  if (error) {
    return { success: false as const, message: error.message };
  }

  const breakdown = { High: 0, Medium: 0, Low: 0 };
  for (const row of data ?? []) {
    const key = String(row.priority) as keyof typeof breakdown;
    if (key in breakdown) breakdown[key] += 1;
  }

  return { success: true as const, breakdown };
}
