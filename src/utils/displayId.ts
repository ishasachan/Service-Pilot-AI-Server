import { supabase } from "../config/db";

export async function generateDisplayId(): Promise<string> {
  const { data } = await supabase
    .from("bookings")
    .select("display_id")
    .not("display_id", "is", null)
    .order("display_id", { ascending: false })
    .limit(1);

  if (!data?.[0]?.display_id) {
    return "SP-1001";
  }

  const current = Number.parseInt(
    String(data[0].display_id).replace("SP-", ""),
    10,
  );

  return `SP-${Number.isNaN(current) ? 1001 : current + 1}`;
}
