export interface BookingDraft {
  customer: string | null;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
  registration: string | null;
  address: string | null;
  service: string | null;
  pickup_time: string | null;
  priority: "High" | "Medium" | "Low" | null;
  notes: string | null;
  _returningCustomerApplied?: boolean;
  _skipReturningLookup?: boolean;
}

export interface ChatChoice {
  id: string;
  label: string;
}

export interface LlmChatResponse {
  reply: string;
  action: "continue" | "create_booking";
  draft: Partial<BookingDraft>;
  choices?: ChatChoice[];
}

export const REQUIRED_BOOKING_FIELDS: (keyof BookingDraft)[] = [
  "customer",
  "phone",
  "vehicle",
  "address",
  "pickup_time",
  "service",
];

const INTERNAL_DRAFT_KEYS = new Set([
  "_returningCustomerApplied",
  "_skipReturningLookup",
]);

export function mergeDraft(
  current: BookingDraft,
  partial: Partial<BookingDraft>,
): BookingDraft {
  const merged = { ...current };

  for (const [key, value] of Object.entries(partial)) {
    if (INTERNAL_DRAFT_KEYS.has(key)) {
      if (value !== null && value !== undefined) {
        merged[key as keyof BookingDraft] = value as never;
      }
      continue;
    }

    if (value === null || value === undefined || value === "") continue;
    merged[key as keyof BookingDraft] = value as never;
  }

  if (!merged.priority) {
    merged.priority = "Medium";
  }

  return merged;
}

export function getMissingFields(draft: BookingDraft): string[] {
  return REQUIRED_BOOKING_FIELDS.filter((field) => {
    const value = draft[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function isDraftComplete(draft: BookingDraft): boolean {
  return getMissingFields(draft).length === 0;
}

export const EMPTY_DRAFT: BookingDraft = {
  customer: null,
  phone: null,
  email: null,
  vehicle: null,
  registration: null,
  address: null,
  service: null,
  pickup_time: null,
  priority: "Medium",
  notes: null,
};
