import { supabase } from "../config/db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findBookingByRouteId<T extends string = "*">(
  routeId: string,
  columns: T = "*" as T,
) {
  if (UUID_PATTERN.test(routeId)) {
    const { data } = await supabase
      .from("bookings")
      .select(columns)
      .eq("id", routeId)
      .maybeSingle();

    if (data) {
      return data;
    }
  }

  const { data } = await supabase
    .from("bookings")
    .select(columns)
    .eq("display_id", routeId)
    .maybeSingle();

  return data;
}

export async function findBookingDbId(routeId: string): Promise<string | null> {
  const booking = (await findBookingByRouteId(routeId, "id")) as {
    id: string;
  } | null;
  return booking?.id ?? null;
}
