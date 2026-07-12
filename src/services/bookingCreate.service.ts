import { supabase } from "../config/db";
import { broadcastDispatchUpdate } from "../realtime/broadcast";
import { generateDisplayId } from "../utils/displayId";
import type { BookingDraft } from "../types/bookingChat";

export async function insertBookingFromDraft(
  draft: BookingDraft,
  historyNote: string,
) {
  const displayId = await generateDisplayId();

  const { data, error } = await supabase
    .from("bookings")
    .insert([
      {
        customer: draft.customer,
        phone: draft.phone,
        email: draft.email,
        vehicle: draft.vehicle,
        registration: draft.registration ?? "TEMP-001",
        address: draft.address,
        service: draft.service ?? "General Service",
        pickup_time: draft.pickup_time,
        priority: draft.priority ?? "Medium",
        notes: draft.notes,
        display_id: displayId,
        status: "pending",
      },
    ])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create booking");
  }

  await supabase.from("booking_history").insert([
    {
      booking_id: data.id,
      status: "pending",
      note: historyNote,
    },
  ]);

  await broadcastDispatchUpdate("bookings");

  return data;
}
