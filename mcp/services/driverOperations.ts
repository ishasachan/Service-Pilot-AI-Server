/**
 * Driver business operations exposed as MCP tools.
 * Used by both advisor (availability) and driver (jobs, status) tools.
 */
import "../shared/loadEnv";

import { supabase } from "../../src/config/db";
import { broadcastDispatchUpdate } from "../../src/realtime/broadcast";
import { findBookingByRouteId } from "../../src/utils/findBooking";
import {
  driverStatusToBookingStatus,
  getNextDriverStatus,
  type DriverStatus,
} from "../../src/utils/statusMapping";

import { mapBookingSummary, type BookingSummary } from "./bookingOperations";

/**
 * Lists all active (non-completed) jobs assigned to a driver.
 *
 * @param driverId - Driver ID from the drivers table (e.g. DRV-1001).
 */
export async function getDriverJobs(driverId: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("driver_id", driverId)
    .neq("status", "completed")
    .order("pickup_time", { ascending: true });

  if (error) {
    return { success: false as const, message: error.message };
  }

  return {
    success: true as const,
    count: data?.length ?? 0,
    jobs: (data ?? []).map((row) => mapBookingSummary(row as Record<string, unknown>)),
  };
}

/**
 * Returns the driver's next upcoming job (first in pickup-time order).
 *
 * @param driverId - Driver ID from the drivers table.
 */
export async function getNextJob(driverId: string) {
  const result = await getDriverJobs(driverId);
  if (!result.success) return result;

  const next = result.jobs[0] ?? null;
  return { success: true as const, job: next };
}

/**
 * Advances a job to the next step in the driver status flow
 * (e.g. assigned → accepted → on_the_way → … → completed).
 *
 * @param input.bookingId - Booking display ID or UUID.
 * @param input.driverId - Must match the booking's assigned driver.
 */
export async function advanceJobStatus(input: {
  bookingId: string;
  driverId: string;
}) {
  const existing = await findBookingByRouteId(input.bookingId);

  if (!existing) {
    return { success: false as const, message: "Booking not found" };
  }

  if (existing.driver_id !== input.driverId) {
    return { success: false as const, message: "Access denied for this job" };
  }

  if (!existing.driver_status) {
    return { success: false as const, message: "Booking has no driver status" };
  }

  const nextDriverStatus = getNextDriverStatus(
    existing.driver_status as DriverStatus,
  );

  if (!nextDriverStatus) {
    return { success: false as const, message: "Job is already complete" };
  }

  const nextBookingStatus = driverStatusToBookingStatus(nextDriverStatus);

  const { data, error } = await supabase
    .from("bookings")
    .update({
      driver_status: nextDriverStatus,
      status: nextBookingStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error || !data) {
    return { success: false as const, message: error?.message ?? "Update failed" };
  }

  await supabase.from("booking_history").insert([
    {
      booking_id: existing.id,
      status: nextBookingStatus,
      note: `Driver updated status to ${nextDriverStatus} via MCP.`,
    },
    {
      booking_id: existing.id,
      status: nextDriverStatus,
      note: `Driver updated status to ${nextDriverStatus} via MCP.`,
    },
  ]);

  await broadcastDispatchUpdate("bookings");

  return {
    success: true as const,
    message: `Status updated to ${nextDriverStatus}`,
    booking: mapBookingSummary(data as Record<string, unknown>),
  };
}

/**
 * Lists all drivers with Busy/Available status based on active bookings.
 */
export async function getAvailableDrivers() {
  const activeStatuses = [
    "driver_assigned",
    "driver_on_way",
    "picked_up",
    "at_service_centre",
    "in_service",
    "ready_for_delivery",
    "returning_to_customer",
  ];

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("*")
    .order("name", { ascending: true });

  if (driversError) {
    return { success: false as const, message: driversError.message };
  }

  const { data: activeBookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("driver_id")
    .in("status", activeStatuses)
    .not("driver_id", "is", null);

  if (bookingsError) {
    return { success: false as const, message: bookingsError.message };
  }

  const busyIds = new Set(
    (activeBookings ?? []).map((booking) => booking.driver_id),
  );

  return {
    success: true as const,
    drivers: (drivers ?? []).map((driver) => ({
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      location: driver.location,
      rating: Number(driver.rating),
      status: busyIds.has(driver.id) ? "Busy" : "Available",
    })),
  };
}

/**
 * Returns trip counts, rating, and workload stats for a single driver.
 *
 * @param driverId - Driver ID from the drivers table.
 */
export async function getDriverStatistics(driverId: string) {
  const { data: driver, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  if (error || !driver) {
    return { success: false as const, message: "Driver not found" };
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count: completedTrips } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .eq("status", "completed");

  const { count: todayTrips } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .gte("updated_at", startOfDay.toISOString());

  const { count: pendingTrips } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .neq("status", "completed");

  return {
    success: true as const,
    driver: {
      id: driver.id,
      name: driver.name,
      rating: Number(driver.rating),
      completedTrips: completedTrips ?? 0,
      todayTrips: todayTrips ?? 0,
      pendingTrips: pendingTrips ?? 0,
    },
  };
}

export type { BookingSummary };
