import { Response } from "express";

import { supabase } from "../config/db";
import { AuthRequest } from "../middleware/auth.middleware";
import { broadcastDispatchUpdate } from "../realtime/broadcast";
import { createDriverAssignmentNotification } from "./notification.controller";
import { generateDisplayId } from "../utils/displayId";
import {
  bookingStatusToDriverStatus,
  driverStatusToBookingStatus,
  getNextDriverStatus,
} from "../utils/statusMapping";

async function getUserDriverId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("driver_id")
    .eq("id", userId)
    .single();

  return data?.driver_id ?? null;
}

const BOOKING_STATUSES = new Set([
  "pending",
  "driver_assigned",
  "driver_on_way",
  "picked_up",
  "at_service_centre",
  "in_service",
  "ready_for_delivery",
  "returning_to_customer",
  "completed",
]);

const DRIVER_STATUSES = new Set([
  "assigned",
  "accepted",
  "on_the_way",
  "reached_customer",
  "picked_up",
  "at_service_centre",
  "ready_for_delivery",
  "returning_to_customer",
  "completed",
]);

function mapBookingRecord(
  booking: Record<string, unknown>,
  history: Array<Record<string, unknown>> = [],
) {
  const sortedHistory = [...history].sort(
    (a, b) =>
      new Date(String(a.created_at)).getTime() -
      new Date(String(b.created_at)).getTime(),
  );

  const bookingHistory = sortedHistory
    .filter((entry) => BOOKING_STATUSES.has(String(entry.status)))
    .map((entry) => ({
      status: entry.status,
      timestamp: entry.created_at,
      note: entry.note,
    }));

  const driverHistory = sortedHistory
    .filter((entry) => DRIVER_STATUSES.has(String(entry.status)))
    .map((entry) => ({
      status: entry.status,
      timestamp: entry.created_at,
      note: entry.note,
    }));

  return {
    id: booking.display_id ?? booking.id,
    dbId: booking.id,
    customer: booking.customer,
    phone: booking.phone,
    email: booking.email ?? undefined,
    vehicle: booking.vehicle,
    registration: booking.registration,
    address: booking.address,
    service: booking.service,
    pickupTime: booking.pickup_time,
    priority: booking.priority,
    status: booking.status,
    driver: booking.driver_name ?? "",
    assignedDriverId: booking.driver_id ?? undefined,
    driverStatus: booking.driver_status ?? undefined,
    notes: booking.notes ?? undefined,
    history: bookingHistory,
    driverHistory,
    createdAt: booking.created_at,
    updatedAt: booking.updated_at,
  };
}

function normalizeCreatePayload(body: Record<string, unknown>) {
  return {
    customer: body.customer ?? body.customerName,
    phone: body.phone,
    email: body.email ?? null,
    vehicle: body.vehicle,
    registration: body.registration ?? "TEMP-001",
    address: body.address ?? body.pickupLocation,
    service: body.service ?? "General Service",
    pickup_time: body.pickup_time ?? body.pickupTime,
    priority: body.priority ?? "Medium",
    notes: body.notes ?? null,
  };
}

export async function getBookings(req: AuthRequest, res: Response) {
  try {
    let query = supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .order("created_at", { ascending: false });

    if (req.user?.role === "driver") {
      const driverId = await getUserDriverId(req.user.id);

      if (!driverId) {
        return res.json({ success: true, bookings: [] });
      }

      query = query.eq("driver_id", driverId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    const bookings = (data ?? []).map((booking) =>
      mapBookingRecord(
        booking,
        (booking.booking_history as Array<Record<string, unknown>>) ?? [],
      ),
    );

    return res.json({
      success: true,
      bookings,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function getBookingById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .or(`id.eq.${id},display_id.eq.${id}`)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (req.user?.role === "driver") {
      const driverId = await getUserDriverId(req.user.id);
      if (data.driver_id !== driverId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }

    return res.json({
      success: true,
      booking: mapBookingRecord(
        data,
        (data.booking_history as Array<Record<string, unknown>>) ?? [],
      ),
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function createBooking(req: AuthRequest, res: Response) {
  try {
    const payload = normalizeCreatePayload(req.body);

    if (
      !payload.customer ||
      !payload.phone ||
      !payload.vehicle ||
      !payload.address ||
      !payload.pickup_time
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required booking fields",
      });
    }

    const displayId = await generateDisplayId();

    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          ...payload,
          display_id: displayId,
          status: "pending",
        },
      ])
      .select("*, booking_history(*)")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase.from("booking_history").insert([
      {
        booking_id: data.id,
        status: "pending",
        note: "Booking created by service advisor.",
      },
    ]);

    const { data: refreshed } = await supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .eq("id", data.id)
      .single();

    await broadcastDispatchUpdate("bookings");

    return res.status(201).json({
      success: true,
      message: "Booking Created",
      booking: mapBookingRecord(
        refreshed ?? data,
        ((refreshed ?? data).booking_history as Array<
          Record<string, unknown>
        >) ?? [],
      ),
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function assignDriver(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { driver_id, driver_name } = req.body;

    if (!driver_id || !driver_name) {
      return res.status(400).json({
        success: false,
        message: "driver_id and driver_name are required",
      });
    }

    const { data: existing } = await supabase
      .from("bookings")
      .select("id, display_id, customer, vehicle")
      .or(`id.eq.${id},display_id.eq.${id}`)
      .single();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({
        driver_id,
        driver_name,
        driver_status: "assigned",
        status: "driver_assigned",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*, booking_history(*)")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase.from("booking_history").insert([
      {
        booking_id: existing.id,
        status: "driver_assigned",
        note: `${driver_name} assigned for vehicle pickup.`,
      },
      {
        booking_id: existing.id,
        status: "assigned",
        note: "Dealer assigned pickup.",
      },
    ]);

    await createDriverAssignmentNotification(
      driver_id,
      "New Pickup Assigned",
      `${existing.vehicle} • ${existing.customer}`,
    );

    await broadcastDispatchUpdate("bookings");
    await broadcastDispatchUpdate("notifications", driver_id);

    const { data: refreshed } = await supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .eq("id", existing.id)
      .single();

    return res.json({
      success: true,
      message: "Driver Assigned",
      booking: mapBookingRecord(
        refreshed ?? data,
        ((refreshed ?? data).booking_history as Array<
          Record<string, unknown>
        >) ?? [],
      ),
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function updateBookingStatus(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    const { data: existing } = await supabase
      .from("bookings")
      .select("*")
      .or(`id.eq.${id},display_id.eq.${id}`)
      .single();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const nextDriverStatus = bookingStatusToDriverStatus(
      status,
      existing.driver_status,
    );

    const { data, error } = await supabase
      .from("bookings")
      .update({
        status,
        driver_status: nextDriverStatus ?? existing.driver_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*, booking_history(*)")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase.from("booking_history").insert([
      {
        booking_id: existing.id,
        status,
        note: note ?? `Status changed to ${status}.`,
      },
    ]);

    if (nextDriverStatus) {
      await supabase.from("booking_history").insert([
        {
          booking_id: existing.id,
          status: nextDriverStatus,
          note: note ?? `Advisor updated status to ${status}.`,
        },
      ]);
    }

    const { data: refreshed } = await supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .eq("id", existing.id)
      .single();

    await broadcastDispatchUpdate("bookings");

    return res.json({
      success: true,
      message: "Status Updated",
      booking: mapBookingRecord(
        refreshed ?? data,
        ((refreshed ?? data).booking_history as Array<
          Record<string, unknown>
        >) ?? [],
      ),
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function advanceDriverStatus(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("bookings")
      .select("*")
      .or(`id.eq.${id},display_id.eq.${id}`)
      .single();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (req.user?.role === "driver") {
      const driverId = await getUserDriverId(req.user.id);
      if (existing.driver_id !== driverId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }

    if (!existing.driver_status) {
      return res.status(400).json({
        success: false,
        message: "Booking has no driver status",
      });
    }

    const nextDriverStatus = getNextDriverStatus(existing.driver_status);

    if (!nextDriverStatus) {
      return res.status(400).json({
        success: false,
        message: "Driver status is already complete",
      });
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
      .select("*, booking_history(*)")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase.from("booking_history").insert([
      {
        booking_id: existing.id,
        status: nextBookingStatus,
        note: `Driver updated status to ${nextDriverStatus}.`,
      },
      {
        booking_id: existing.id,
        status: nextDriverStatus,
        note: `Driver updated status to ${nextDriverStatus}.`,
      },
    ]);

    const { data: refreshed } = await supabase
      .from("bookings")
      .select("*, booking_history(*)")
      .eq("id", existing.id)
      .single();

    await broadcastDispatchUpdate("bookings");

    return res.json({
      success: true,
      message: "Driver status updated",
      booking: mapBookingRecord(
        refreshed ?? data,
        ((refreshed ?? data).booking_history as Array<
          Record<string, unknown>
        >) ?? [],
      ),
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function getBookingHistory(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, driver_id")
      .or(`id.eq.${id},display_id.eq.${id}`)
      .single();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (req.user?.role === "driver") {
      const driverId = await getUserDriverId(req.user.id);
      if (booking.driver_id !== driverId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }

    const { data, error } = await supabase
      .from("booking_history")
      .select("*")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      history: (data ?? []).map((entry) => ({
        status: entry.status,
        timestamp: entry.created_at,
        note: entry.note,
      })),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}
