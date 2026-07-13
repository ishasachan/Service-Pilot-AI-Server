/**
 * Booking business operations exposed as MCP tools.
 * Used by advisor tools: find, schedule, assign, customer lookup.
 */
import "../shared/loadEnv";

import { supabase } from "../../config/db";
import { createDriverAssignmentNotification } from "../../controllers/notification.controller";
import { broadcastDispatchUpdate } from "../../realtime/broadcast";
import { insertBookingFromDraft } from "../../services/bookingCreate.service";
import {
  lookupCustomersByName,
  lookupCustomersByPhone,
} from "../../services/customerLookup.service";
import { findBookingByRouteId } from "../../utils/findBooking";

export interface BookingSummary {
  id: string;
  dbId: string;
  customer: string;
  phone: string;
  vehicle: string;
  registration: string;
  address: string;
  service: string;
  pickupTime: string;
  priority: string;
  status: string;
  driver: string;
  assignedDriverId?: string;
  notes?: string;
}

/**
 * Normalizes a raw Supabase booking row into the MCP-friendly summary shape.
 *
 * @param booking - Raw booking record from the database.
 * @returns A flattened booking object used by MCP tool responses.
 */
export function mapBookingSummary(booking: Record<string, unknown>): BookingSummary {
  return {
    id: String(booking.display_id ?? booking.id),
    dbId: String(booking.id),
    customer: String(booking.customer),
    phone: String(booking.phone),
    vehicle: String(booking.vehicle),
    registration: String(booking.registration),
    address: String(booking.address),
    service: String(booking.service),
    pickupTime: String(booking.pickup_time),
    priority: String(booking.priority),
    status: String(booking.status),
    driver: String(booking.driver_name ?? ""),
    assignedDriverId: booking.driver_id ? String(booking.driver_id) : undefined,
    notes: booking.notes ? String(booking.notes) : undefined,
  };
}

/**
 * Searches bookings by display ID (SP-1001) or partial customer/phone/vehicle match.
 *
 * @param query - Booking ID or free-text search term.
 */
export async function findBooking(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { success: false as const, message: "Search query is required" };
  }

  const exact = await findBookingByRouteId(trimmed);
  if (exact) {
    return {
      success: true as const,
      count: 1,
      bookings: [mapBookingSummary(exact as Record<string, unknown>)],
    };
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .or(
      `customer.ilike.%${trimmed}%,phone.ilike.%${trimmed}%,vehicle.ilike.%${trimmed}%,registration.ilike.%${trimmed}%`,
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return { success: false as const, message: error.message };
  }

  return {
    success: true as const,
    count: data?.length ?? 0,
    bookings: (data ?? []).map((row) => mapBookingSummary(row as Record<string, unknown>)),
  };
}

/**
 * Returns full booking details plus status history for a single booking.
 *
 * @param bookingId - Display ID (SP-1001) or internal UUID.
 */
export async function getBookingDetails(bookingId: string) {
  const booking = await findBookingByRouteId(bookingId);
  if (!booking) {
    return { success: false as const, message: "Booking not found" };
  }

  const { data: history } = await supabase
    .from("booking_history")
    .select("status, note, created_at")
    .eq("booking_id", (booking as { id: string }).id)
    .order("created_at", { ascending: true });

  return {
    success: true as const,
    booking: mapBookingSummary(booking as Record<string, unknown>),
    history: history ?? [],
  };
}

/**
 * Lists all bookings with status `pending` (waiting for driver assignment).
 */
export async function getPendingBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "pending")
    .order("pickup_time", { ascending: true });

  if (error) {
    return { success: false as const, message: error.message };
  }

  return {
    success: true as const,
    count: data?.length ?? 0,
    bookings: (data ?? []).map((row) => mapBookingSummary(row as Record<string, unknown>)),
  };
}

/**
 * Creates a new pickup booking (business action — not raw INSERT).
 *
 * @param input - Customer, vehicle, address, and pickup details.
 */
export async function schedulePickup(input: {
  customer: string;
  phone: string;
  vehicle: string;
  registration?: string;
  address: string;
  pickupTime: string;
  service?: string;
  priority?: "High" | "Medium" | "Low";
  notes?: string;
  email?: string | null;
}) {
  if (
    !input.customer ||
    !input.phone ||
    !input.vehicle ||
    !input.address ||
    !input.pickupTime
  ) {
    return {
      success: false as const,
      message:
        "customer, phone, vehicle, address, and pickupTime are required",
    };
  }

  const booking = await insertBookingFromDraft(
    {
      customer: input.customer,
      phone: input.phone,
      email: input.email ?? null,
      vehicle: input.vehicle,
      registration: input.registration ?? "TEMP-001",
      address: input.address,
      service: input.service ?? "General Service",
      pickup_time: input.pickupTime,
      priority: input.priority ?? "Medium",
      notes: input.notes ?? null,
    },
    "Booking created via ServicePilot AI Copilot (MCP).",
  );

  return {
    success: true as const,
    message: "Pickup scheduled successfully",
    booking: mapBookingSummary(booking as Record<string, unknown>),
  };
}

/**
 * Assigns a driver to a booking and sends them a notification.
 *
 * @param input.bookingId - Target booking display ID or UUID.
 * @param input.driverId - Driver ID from the drivers table.
 */
export async function assignDriver(input: {
  bookingId: string;
  driverId: string;
}) {
  type BookingAssignmentRow = {
    id: string;
    display_id: string;
    customer: string;
    vehicle: string;
  };

  const existing = (await findBookingByRouteId(
    input.bookingId,
    "id, display_id, customer, vehicle",
  )) as BookingAssignmentRow | null;

  if (!existing) {
    return { success: false as const, message: "Booking not found" };
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("id", input.driverId)
    .single();

  if (driverError || !driver) {
    return { success: false as const, message: "Driver not found" };
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      driver_id: driver.id,
      driver_name: driver.name,
      driver_status: "assigned",
      status: "driver_assigned",
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error || !data) {
    return { success: false as const, message: error?.message ?? "Assignment failed" };
  }

  await supabase.from("booking_history").insert([
    {
      booking_id: existing.id,
      status: "driver_assigned",
      note: `${driver.name} assigned for vehicle pickup.`,
    },
    {
      booking_id: existing.id,
      status: "assigned",
      note: "Assigned via ServicePilot AI Copilot (MCP).",
    },
  ]);

  await createDriverAssignmentNotification(
    driver.id,
    "New Pickup Assigned",
    `${existing.vehicle} • ${existing.customer}`,
  );

  await broadcastDispatchUpdate("bookings");
  await broadcastDispatchUpdate("notifications", driver.id);

  return {
    success: true as const,
    message: "Driver assigned successfully",
    booking: mapBookingSummary(data as Record<string, unknown>),
  };
}

/**
 * Looks up returning customers by phone or name for faster re-booking.
 *
 * @param input.phone - Customer phone number (optional).
 * @param input.name - Customer name (optional).
 */
export async function getCustomerHistory(input: {
  phone?: string;
  name?: string;
}) {
  if (input.phone) {
    const profiles = await lookupCustomersByPhone(input.phone);
    return { success: true as const, profiles };
  }

  if (input.name) {
    const profiles = await lookupCustomersByName(input.name);
    return { success: true as const, profiles };
  }

  return {
    success: false as const,
    message: "Provide phone or name to search customer history",
  };
}
