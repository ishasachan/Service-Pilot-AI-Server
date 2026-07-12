import { createHash } from "crypto";

import { supabase } from "../config/db";
import type { BookingDraft, ChatChoice } from "../types/bookingChat";

export interface ReturningCustomerProfile {
  id: string;
  customer: string;
  phone: string;
  email: string | null;
  vehicle: string;
  registration: string | null;
  address: string;
  lastService: string | null;
  lastBookingAt: string;
  completedBookings: number;
  totalBookings: number;
}

export interface CustomerDisambiguation {
  type: "customer_disambiguation";
  profiles: ReturningCustomerProfile[];
  searchTerm: string;
  searchBy: "phone" | "name";
}

export interface CustomerLookupFlags {
  returningCustomerApplied?: boolean;
  skipReturningLookup?: boolean;
}

const NEW_CUSTOMER_CHOICE_ID = "returning:new";

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return null;
}

function buildProfileId(profile: {
  phone: string;
  customer: string;
  vehicle: string;
  address: string;
}) {
  const key = [
    normalizePhone(profile.phone),
    profile.customer.trim().toLowerCase(),
    profile.vehicle.trim().toLowerCase(),
    profile.address.trim().toLowerCase(),
  ].join("|");

  return createHash("sha256").update(key).digest("base64url").slice(0, 24);
}

function maskPhone(phone: string) {
  if (phone.length < 4) return phone;
  return `${phone.slice(0, 2)}****${phone.slice(-4)}`;
}

export function formatProfileLabel(profile: ReturningCustomerProfile) {
  return `${profile.customer} · ${profile.vehicle} · ${profile.address} · ${maskPhone(profile.phone)}`;
}

export function profileToDraftPartial(
  profile: ReturningCustomerProfile,
): Partial<BookingDraft> {
  return {
    customer: profile.customer,
    phone: profile.phone,
    email: profile.email,
    vehicle: profile.vehicle,
    registration: profile.registration,
    address: profile.address,
  };
}

function aggregateProfiles(
  rows: Array<Record<string, unknown>>,
): ReturningCustomerProfile[] {
  const map = new Map<string, ReturningCustomerProfile>();

  for (const row of rows) {
    const phone = normalizePhone(String(row.phone ?? ""));
    if (!phone) continue;

    const customer = String(row.customer ?? "").trim();
    const vehicle = String(row.vehicle ?? "").trim();
    const address = String(row.address ?? "").trim();

    if (!customer || !vehicle || !address) continue;

    const id = buildProfileId({ phone, customer, vehicle, address });
    const isCompleted = String(row.status) === "completed";
    const createdAt = String(row.created_at);
    const existing = map.get(id);

    if (!existing) {
      map.set(id, {
        id,
        customer,
        phone,
        email: row.email ? String(row.email) : null,
        vehicle,
        registration: row.registration ? String(row.registration) : null,
        address,
        lastService: row.service ? String(row.service) : null,
        lastBookingAt: createdAt,
        completedBookings: isCompleted ? 1 : 0,
        totalBookings: 1,
      });
      continue;
    }

    existing.totalBookings += 1;
    if (isCompleted) {
      existing.completedBookings += 1;
    }

    if (new Date(createdAt).getTime() > new Date(existing.lastBookingAt).getTime()) {
      existing.lastBookingAt = createdAt;
      existing.lastService = row.service ? String(row.service) : existing.lastService;
      existing.email = row.email ? String(row.email) : existing.email;
      existing.registration = row.registration
        ? String(row.registration)
        : existing.registration;
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      b.completedBookings - a.completedBookings ||
      new Date(b.lastBookingAt).getTime() - new Date(a.lastBookingAt).getTime(),
  );
}

async function fetchBookingRows() {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "customer, phone, email, vehicle, registration, address, service, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function lookupCustomersByPhone(
  phone: string,
): Promise<ReturningCustomerProfile[]> {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const rows = await fetchBookingRows();
  const matches = rows.filter(
    (row) => normalizePhone(String(row.phone ?? "")) === normalized,
  );

  return aggregateProfiles(matches);
}

export async function lookupCustomersByName(
  name: string,
): Promise<ReturningCustomerProfile[]> {
  const term = name.trim().toLowerCase();
  if (term.length < 2) return [];

  const rows = await fetchBookingRows();
  const matches = rows.filter((row) => {
    const customer = String(row.customer ?? "").toLowerCase();
    return (
      customer === term ||
      customer.includes(term) ||
      term.includes(customer) ||
      customer.split(/\s+/).some((part) => part === term)
    );
  });

  return aggregateProfiles(matches);
}

export function extractPhoneFromText(text: string): string | null {
  const matches = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}\b/g);
  if (!matches?.length) return null;
  return normalizePhone(matches[matches.length - 1]);
}

export function buildCustomerChoices(
  profiles: ReturningCustomerProfile[],
): ChatChoice[] {
  const choices = profiles.slice(0, 4).map((profile) => ({
    id: `returning:profile:${profile.id}`,
    label: formatProfileLabel(profile),
  }));

  choices.push({
    id: NEW_CUSTOMER_CHOICE_ID,
    label: "New customer (not in list)",
  });

  return choices;
}

export function resolveCustomerChoice(
  choiceId: string | undefined,
  message: string,
  pending: CustomerDisambiguation,
): ReturningCustomerProfile | "new" | null {
  if (choiceId === NEW_CUSTOMER_CHOICE_ID) {
    return "new";
  }

  if (choiceId?.startsWith("returning:profile:")) {
    const profileId = choiceId.replace("returning:profile:", "");
    const profile = pending.profiles.find((item) => item.id === profileId);
    return profile ?? null;
  }

  const lower = message.trim().toLowerCase();

  if (
    lower.includes("new customer") ||
    lower === "new" ||
    lower.includes("not in list")
  ) {
    return "new";
  }

  for (const profile of pending.profiles) {
    const label = formatProfileLabel(profile).toLowerCase();
    if (lower === label.toLowerCase() || lower.includes(profile.customer.toLowerCase())) {
      return profile;
    }
  }

  return null;
}

export function buildReturningCustomerReply(
  profile: ReturningCustomerProfile,
  missingFields: string[],
) {
  const greeting = `Welcome back, ${profile.customer}! I found their past booking (${profile.vehicle} · ${profile.address}).`;

  if (missingFields.length === 0) {
    return `${greeting} I have everything needed — confirming the booking now.`;
  }

  if (missingFields.length === 1) {
    return `${greeting} Just need the ${missingFields[0].replace("_", " ")} for this visit.`;
  }

  return `${greeting} What service and pickup time do you need this time?`;
}

export function buildDisambiguationReply(
  searchBy: "phone" | "name",
  searchTerm: string,
  count: number,
) {
  if (searchBy === "phone") {
    return `I found ${count} past profiles linked to ${maskPhone(normalizePhone(searchTerm) ?? searchTerm)}. Which customer is this for?`;
  }

  return `I found ${count} past customers matching "${searchTerm}". Which one is this booking for?`;
}
