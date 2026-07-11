import { Response } from "express";

import { supabase } from "../config/db";
import { AuthRequest } from "../middleware/auth.middleware";

const ACTIVE_DRIVER_STATUSES = [
  "driver_assigned",
  "driver_on_way",
  "picked_up",
  "at_service_centre",
  "in_service",
  "ready_for_delivery",
  "returning_to_customer",
];

export async function getDrivers(
  _req: AuthRequest,
  res: Response,
) {
  try {
    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("*")
      .order("name", { ascending: true });

    if (driversError) {
      return res.status(500).json({
        success: false,
        message: driversError.message,
      });
    }

    const { data: activeBookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("driver_id, status")
      .in("status", ACTIVE_DRIVER_STATUSES)
      .not("driver_id", "is", null);

    if (bookingsError) {
      return res.status(500).json({
        success: false,
        message: bookingsError.message,
      });
    }

    const busyDriverIds = new Set(
      (activeBookings ?? []).map((booking) => booking.driver_id),
    );

    const roster = (drivers ?? []).map((driver) => ({
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      location: driver.location,
      distance: driver.location ? `${driver.location}` : "",
      rating: Number(driver.rating),
      trips: driver.trips,
      status: busyDriverIds.has(driver.id) ? "Busy" : "Available",
    }));

    return res.json({
      success: true,
      drivers: roster,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function getDriverById(
  req: AuthRequest,
  res: Response,
) {
  try {
    const { id } = req.params;

    const { data: driver, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    const { count: completedTrips } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", id)
      .eq("status", "completed");

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count: todayTrips } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", id)
      .gte("updated_at", startOfDay.toISOString());

    const { count: pendingTrips } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", id)
      .neq("status", "completed");

    return res.json({
      success: true,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        location: driver.location,
        rating: Number(driver.rating),
        trips: driver.trips,
        completedTrips: completedTrips ?? 0,
        todayTrips: todayTrips ?? 0,
        pendingTrips: pendingTrips ?? 0,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}
