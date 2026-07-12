import { supabase } from "../config/db";
import { insertBookingFromDraft } from "./bookingCreate.service";
import {
  buildCustomerChoices,
  buildDisambiguationReply,
  buildReturningCustomerReply,
  extractPhoneFromText,
  lookupCustomersByName,
  lookupCustomersByPhone,
  profileToDraftPartial,
  resolveCustomerChoice,
  type CustomerDisambiguation,
} from "./customerLookup.service";
import { generateGeminiJson } from "./gemini.service";
import {
  EMPTY_DRAFT,
  type BookingDraft,
  type ChatChoice,
  type LlmChatResponse,
  getMissingFields,
  isDraftComplete,
  mergeDraft,
} from "../types/bookingChat";

const SYSTEM_PROMPT = `You are ServicePilot AI, an autonomous booking assistant for a vehicle pickup and dispatch service in India (Pune area).

Your job:
1. Collect booking details from the advisor through natural conversation.
2. Merge new information into the draft on every turn — never drop fields already collected.
3. Ask ONE clear follow-up question when information is missing or ambiguous.
4. When multiple options exist (times, vehicles, addresses), return choices for the user to pick.
5. When all required fields are confidently known, set action to "create_booking".

Required fields before create_booking:
- customer (full name)
- phone (10-digit Indian mobile, digits only in draft)
- vehicle (make/model)
- address (pickup location)
- pickup_time (human-readable, e.g. "4:00 PM" or "Tomorrow 10:00 AM")
- service (type of service)

Optional fields: email, registration, notes, priority (High | Medium | Low — infer from urgency)

Rules:
- NEVER invent phone numbers, addresses, or customer names.
- Use null for unknown draft fields.
- Keep reply concise, friendly, and professional (1-3 sentences).
- If the user taps a choice or answers a clarification, merge it into the draft.
- Only set action to "create_booking" when every required field is present and unambiguous.
- Put extra context from the conversation into notes when useful.
- RETURNING CUSTOMERS: The server may auto-fill customer, phone, vehicle, address, email, and registration from past bookings. Do NOT re-ask for fields already present in the draft unless the advisor explicitly wants to change them.
- If draft already has customer details from a returning profile, focus only on service and pickup_time (and any corrections).

Respond ONLY with valid JSON matching this schema:
{
  "reply": "string",
  "action": "continue" | "create_booking",
  "draft": {
    "customer": string | null,
    "phone": string | null,
    "email": string | null,
    "vehicle": string | null,
    "registration": string | null,
    "address": string | null,
    "service": string | null,
    "pickup_time": string | null,
    "priority": "High" | "Medium" | "Low" | null,
    "notes": string | null
  },
  "choices": [{ "id": "1", "label": "option text" }]
}

choices is optional; include 2-4 choices only when disambiguation is needed.`;

export interface ChatSessionRow {
  id: string;
  user_id: string;
  status: string;
  draft: BookingDraft;
  pending_question: unknown;
  booking_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  choices?: ChatChoice[];
  bookingId?: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toDto(message: ChatMessageRow): ChatMessageDto {
  const metadata = message.metadata ?? {};

  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    time: formatTime(message.created_at),
    choices: metadata.choices as ChatChoice[] | undefined,
    bookingId: metadata.bookingId as string | undefined,
  };
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return phone.trim();
}

function sanitizeDraft(draft: BookingDraft): BookingDraft {
  return {
    ...draft,
    phone: normalizePhone(draft.phone),
    priority: draft.priority ?? "Medium",
    registration: draft.registration?.trim() || null,
  };
}

async function getSessionMessages(sessionId: string) {
  const { data, error } = await supabase
    .from("booking_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ChatMessageRow[];
}

async function saveMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  metadata?: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("booking_chat_messages")
    .insert([
      {
        session_id: sessionId,
        role,
        content,
        metadata: metadata ?? null,
      },
    ])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save message");
  }

  return data as ChatMessageRow;
}

const WELCOME_TEXT =
  "Hi! I'm ServicePilot AI. Paste a customer call, WhatsApp message, or describe a pickup — I'll collect the details and create the booking for you. Returning customers are recognized automatically from past bookings.";

export async function createChatSession(userId: string) {
  const { data, error } = await supabase
    .from("booking_chat_sessions")
    .insert([
      {
        user_id: userId,
        status: "active",
        draft: EMPTY_DRAFT,
      },
    ])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create chat session");
  }

  return data as ChatSessionRow;
}

function sessionHasUserMessage(messages: ChatMessageRow[]) {
  return messages.some((message) => message.role === "user");
}

export async function cleanupEmptyActiveSessions(userId: string) {
  const { data: sessions, error } = await supabase
    .from("booking_chat_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    throw new Error(error.message);
  }

  for (const session of sessions ?? []) {
    const messages = await getSessionMessages(session.id);
    if (!sessionHasUserMessage(messages)) {
      await supabase
        .from("booking_chat_sessions")
        .delete()
        .eq("id", session.id);
    }
  }
}

async function abandonActiveSessions(userId: string) {
  await cleanupEmptyActiveSessions(userId);

  await supabase
    .from("booking_chat_sessions")
    .update({
      status: "abandoned",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "active");
}

export async function getChatSession(sessionId: string, userId: string) {
  const { data, error } = await supabase
    .from("booking_chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Chat session not found");
  }

  const messages = await getSessionMessages(sessionId);

  return {
    session: data as ChatSessionRow,
    messages: messages
      .filter((message) => message.role !== "system")
      .map(toDto),
  };
}

export interface ChatSessionSummary {
  id: string;
  status: string;
  preview: string;
  messageCount: number;
  bookingId: string | null;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
}

function buildSessionPreview(
  messages: ChatMessageRow[],
  draft: BookingDraft,
): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (firstUserMessage?.content) {
    return firstUserMessage.content.slice(0, 80);
  }

  if (draft.customer) {
    return `Chat with ${draft.customer}`;
  }

  return "New conversation";
}

export async function listChatSessions(
  userId: string,
): Promise<ChatSessionSummary[]> {
  const { data: sessions, error } = await supabase
    .from("booking_chat_sessions")
    .select("id, status, draft, booking_id, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  if (!sessions?.length) {
    return [];
  }

  const sessionIds = sessions.map((session) => session.id);
  const bookingIds = sessions
    .map((session) => session.booking_id)
    .filter((id): id is string => Boolean(id));

  const bookingDisplayIds = new Map<string, string>();

  if (bookingIds.length > 0) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, display_id")
      .in("id", bookingIds);

    for (const booking of bookings ?? []) {
      bookingDisplayIds.set(
        String(booking.id),
        String(booking.display_id ?? booking.id),
      );
    }
  }

  const { data: messages, error: messagesError } = await supabase
    .from("booking_chat_messages")
    .select("session_id, role, content, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw new Error(messagesError.message);
  }

  const messagesBySession = new Map<string, ChatMessageRow[]>();

  for (const message of (messages ?? []) as ChatMessageRow[]) {
    const existing = messagesBySession.get(message.session_id) ?? [];
    existing.push(message);
    messagesBySession.set(message.session_id, existing);
  }

  return sessions
    .map((session) => {
    const draft = {
      ...EMPTY_DRAFT,
      ...(session.draft as BookingDraft),
    };
    const sessionMessages = messagesBySession.get(session.id) ?? [];

    if (!sessionHasUserMessage(sessionMessages)) {
      return null;
    }

    const bookingId = session.booking_id
      ? (bookingDisplayIds.get(session.booking_id) ?? null)
      : null;

    return {
      id: session.id,
      status: session.status,
      preview: buildSessionPreview(sessionMessages, draft),
      messageCount: sessionMessages.length,
      bookingId,
      customerName: draft.customer,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  })
    .filter((session): session is ChatSessionSummary => session !== null);
}

export async function getActiveChatSession(userId: string) {
  await cleanupEmptyActiveSessions(userId);

  const { data, error } = await supabase
    .from("booking_chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const messages = await getSessionMessages(data.id);

  if (!sessionHasUserMessage(messages)) {
    await supabase.from("booking_chat_sessions").delete().eq("id", data.id);
    return null;
  }

  return {
    session: data as ChatSessionRow,
    messages: messages
      .filter((message) => message.role !== "system")
      .map(toDto),
  };
}

export async function startChatWithMessage(
  userId: string,
  message: string,
  choiceId?: string,
) {
  await abandonActiveSessions(userId);

  const session = await createChatSession(userId);
  await saveMessage(session.id, "assistant", WELCOME_TEXT);

  return sendChatMessage(session.id, userId, message, choiceId);
}

async function callLlm(
  draft: BookingDraft,
  history: ChatMessageRow[],
  userMessage: string,
  returningCustomerContext?: string,
): Promise<LlmChatResponse> {
  const llmMessages = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({
      role: message.role === "user" ? ("user" as const) : ("model" as const),
      content: message.content,
    }));

  llmMessages.push({ role: "user", content: userMessage });

  const contextBlock = [
    `Current draft JSON:\n${JSON.stringify(draft, null, 2)}`,
    returningCustomerContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  return generateGeminiJson<LlmChatResponse>({
    systemInstruction: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
    messages: llmMessages,
  });
}

function parsePendingQuestion(
  value: unknown,
): CustomerDisambiguation | null {
  if (!value || typeof value !== "object") return null;
  const pending = value as CustomerDisambiguation;
  if (pending.type !== "customer_disambiguation") return null;
  if (!Array.isArray(pending.profiles) || pending.profiles.length === 0) {
    return null;
  }
  return pending;
}

function mergeReturningProfile(
  draft: BookingDraft,
  profile: ReturnType<typeof profileToDraftPartial>,
): BookingDraft {
  const filled = { ...draft };

  for (const [key, value] of Object.entries(profile)) {
    if (value === null || value === undefined || value === "") continue;
    const field = key as keyof BookingDraft;
    const current = filled[field];
    if (
      current === null ||
      current === undefined ||
      String(current).trim() === ""
    ) {
      filled[field] = value as never;
    }
  }

  filled._returningCustomerApplied = true;
  return sanitizeDraft(filled);
}

async function applyReturningCustomerLookup(
  draft: BookingDraft,
  userMessage: string,
): Promise<{
  draft: BookingDraft;
  reply?: string;
  choices?: ChatChoice[];
  pendingQuestion?: CustomerDisambiguation | null;
  blockCreate?: boolean;
}> {
  if (draft._skipReturningLookup || draft._returningCustomerApplied) {
    return { draft };
  }

  const phone =
    draft.phone ?? extractPhoneFromText(userMessage) ?? null;

  if (phone) {
    const profiles = await lookupCustomersByPhone(phone);

    if (profiles.length === 1) {
      const merged = mergeReturningProfile(
        draft,
        profileToDraftPartial(profiles[0]),
      );
      const missing = getMissingFields(merged);

      return {
        draft: merged,
        reply: buildReturningCustomerReply(profiles[0], missing),
        blockCreate: missing.length > 0,
      };
    }

    if (profiles.length > 1) {
      const pendingQuestion: CustomerDisambiguation = {
        type: "customer_disambiguation",
        profiles,
        searchTerm: phone,
        searchBy: "phone",
      };

      return {
        draft: mergeDraft(draft, { phone }),
        reply: buildDisambiguationReply("phone", phone, profiles.length),
        choices: buildCustomerChoices(profiles),
        pendingQuestion,
        blockCreate: true,
      };
    }
  }

  const name = draft.customer?.trim();
  if (name && name.length >= 2) {
    const profiles = await lookupCustomersByName(name);

    if (profiles.length === 1) {
      const merged = mergeReturningProfile(
        draft,
        profileToDraftPartial(profiles[0]),
      );
      const missing = getMissingFields(merged);

      return {
        draft: merged,
        reply: buildReturningCustomerReply(profiles[0], missing),
        blockCreate: missing.length > 0,
      };
    }

    if (profiles.length > 1) {
      const pendingQuestion: CustomerDisambiguation = {
        type: "customer_disambiguation",
        profiles,
        searchTerm: name,
        searchBy: "name",
      };

      return {
        draft,
        reply: buildDisambiguationReply("name", name, profiles.length),
        choices: buildCustomerChoices(profiles),
        pendingQuestion,
        blockCreate: true,
      };
    }
  }

  return { draft };
}

export async function sendChatMessage(
  sessionId: string,
  userId: string,
  message: string,
  choiceId?: string,
) {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Message cannot be empty");
  }

  if (trimmed.length > 8000) {
    throw new Error("Message is too long");
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from("booking_chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !sessionRow) {
    throw new Error("Chat session not found");
  }

  const session = sessionRow as ChatSessionRow;

  if (session.status !== "active") {
    throw new Error("This chat session is already completed");
  }

  const history = await getSessionMessages(sessionId);
  await saveMessage(sessionId, "user", trimmed);

  let currentDraft = sanitizeDraft({
    ...EMPTY_DRAFT,
    ...(session.draft as BookingDraft),
  });

  const pendingQuestion = parsePendingQuestion(session.pending_question);
  let returningCustomerContext: string | undefined;
  let preLookupReply: string | undefined;
  let preLookupChoices: ChatChoice[] | undefined;
  let nextPendingQuestion: CustomerDisambiguation | null | undefined;
  let skipLlm = false;

  if (pendingQuestion) {
    const resolution = resolveCustomerChoice(choiceId, trimmed, pendingQuestion);

    if (resolution === "new") {
      currentDraft = {
        ...currentDraft,
        _skipReturningLookup: true,
        _returningCustomerApplied: false,
      };
      nextPendingQuestion = null;
      returningCustomerContext =
        "The advisor chose NEW CUSTOMER. Do not auto-fill from past bookings. Collect all required fields fresh.";
    } else if (resolution) {
      currentDraft = mergeReturningProfile(
        currentDraft,
        profileToDraftPartial(resolution),
      );
      nextPendingQuestion = null;
      const missing = getMissingFields(currentDraft);
      preLookupReply = buildReturningCustomerReply(resolution, missing);
      returningCustomerContext = `Returning customer selected: ${resolution.customer}. Profile details are already in the draft. Only ask for: ${missing.join(", ") || "nothing — ready to book"}.`;
    } else {
      skipLlm = true;
      preLookupReply =
        "Please pick one of the customers below, or choose New customer if this is someone else.";
      preLookupChoices = buildCustomerChoices(pendingQuestion.profiles);
      nextPendingQuestion = pendingQuestion;
    }
  }

  let llmResponse: LlmChatResponse | null = null;

  if (!skipLlm) {
    llmResponse = await callLlm(
      currentDraft,
      history,
      trimmed,
      returningCustomerContext,
    );
  }

  let mergedDraft = sanitizeDraft(
    mergeDraft(currentDraft, llmResponse?.draft ?? {}),
  );

  let reply =
    preLookupReply ??
    llmResponse?.reply?.trim() ??
    "Thanks, I'm updating the booking details.";
  let choices = preLookupChoices ?? llmResponse?.choices;
  let bookingId: string | null = null;
  let status = session.status;
  let pendingToSave = nextPendingQuestion;

  if (!pendingQuestion || nextPendingQuestion === null) {
    const lookup = await applyReturningCustomerLookup(mergedDraft, trimmed);

    mergedDraft = lookup.draft;

    if (lookup.pendingQuestion) {
      reply = lookup.reply ?? reply;
      choices = lookup.choices;
      pendingToSave = lookup.pendingQuestion;
    } else if (lookup.reply && !preLookupReply) {
      reply = lookup.reply;
    }
  }

  const shouldCreate =
    !skipLlm &&
    !pendingToSave &&
    llmResponse?.action === "create_booking" &&
    isDraftComplete(mergedDraft);

  if (shouldCreate) {
    const booking = await insertBookingFromDraft(
      mergedDraft,
      "Booking created via ServicePilot AI assistant.",
    );

    bookingId = booking.display_id ?? booking.id;
    status = "completed";
    reply = `Done! Booking ${bookingId} has been created and added to the dispatch queue.`;

    await supabase
      .from("booking_chat_sessions")
      .update({
        status,
        draft: mergedDraft,
        booking_id: booking.id,
        pending_question: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  } else {
    if (
      llmResponse?.action === "create_booking" &&
      !isDraftComplete(mergedDraft)
    ) {
      const missing = getMissingFields(mergedDraft);
      reply = `I still need ${missing.join(", ")} before I can create the booking. ${reply}`;
    }

    await supabase
      .from("booking_chat_sessions")
      .update({
        draft: mergedDraft,
        pending_question: pendingToSave ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  const assistantMessage = await saveMessage(sessionId, "assistant", reply, {
    choices,
    bookingId,
    draft: mergedDraft,
  });

  return {
    sessionId,
    status,
    draft: mergedDraft,
    bookingId,
    message: toDto(assistantMessage),
  };
}

export async function resetChatSession(userId: string) {
  await abandonActiveSessions(userId);
}

export async function deleteChatSession(sessionId: string, userId: string) {
  const { data, error: fetchError } = await supabase
    .from("booking_chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !data) {
    throw new Error("Chat session not found");
  }

  const { error } = await supabase
    .from("booking_chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}
