import { Request, Response } from "express";
import { supabase } from "../config/db";

export async function getBookings(
  req: Request,
  res: Response
) {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      bookings: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function getBookingById(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.json({
      success: true,
      booking: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function createBooking(
  req: Request,
  res: Response
) {
  try {
    const booking = req.body;

    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          ...booking,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase
      .from("booking_history")
      .insert([
        {
          booking_id: data.id,
          status: "pending",
          note: "Booking Created",
        },
      ]);

    return res.status(201).json({
      success: true,
      message: "Booking Created",
      booking: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function assignDriver(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const {
      driver_id,
      driver_name,
    } = req.body;

    const { data, error } = await supabase
      .from("bookings")
      .update({
        driver_id,
        driver_name,
        status: "driver_assigned",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase
      .from("booking_history")
      .insert([
        {
          booking_id: id,
          status: "driver_assigned",
          note: `Driver ${driver_name} assigned.`,
        },
      ]);

    return res.json({
      success: true,
      message: "Driver Assigned",
      booking: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function updateBookingStatus(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const {
      status,
      note,
    } = req.body;

    const { data, error } = await supabase
      .from("bookings")
      .update({
        status,
        updated_at: new Date(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    await supabase
      .from("booking_history")
      .insert([
        {
          booking_id: id,
          status,
          note,
        },
      ]);

    return res.json({
      success: true,
      message: "Status Updated",
      booking: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function getBookingHistory(
  req: Request,
  res: Response
) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("booking_history")
      .select("*")
      .eq("booking_id", id)
      .order("created_at", {
        ascending: true,
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      history: data,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}