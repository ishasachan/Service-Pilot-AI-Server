import { supabase } from "../config/db";
import { generateGeminiJson } from "./gemini.service";
import { getNextDriverStatus } from "../utils/statusMapping";

const WELCOME_TEXT =
  "Hi! I'm your ServicePilot driver assistant. Ask me about your assigned jobs, pickup details, next steps, customer contact info, or dispatch procedures.";

const SYSTEM_PROMPT = `You are ServicePilot Driver Assistant for a vehicle pickup and dispatch service in India (Pune area).

You help drivers with:
- Their assigned and active pickup/delivery jobs
- Customer contact, pickup address, vehicle details, and pickup time
- What status to update next in the driver app workflow
- General dispatch procedures and best practices

Driver status workflow (in order):
assigned → accepted → on_the_way → reached_customer → picked_up → at_service_centre → ready_for_delivery → returning_to_customer → completed

Rules:
- Use ONLY the driver context JSON for job-specific facts. Never invent customers, phones, or addresses.
- If the driver has no matching job, say so and suggest checking the jobs list or contacting the advisor.
- Keep answers concise, practical, and friendly (1-4 sentences unless listing job details).
- For "what's next" questions, tell them the next driver status to tap in the app.
- You cannot assign jobs, create bookings, or change job data — only explain and guide.

Respond ONLY with valid JSON:
{ "reply": "your answer here" }`;

export interface DriverChatSessionRow {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DriverChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DriverChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
}

export interface DriverChatSessionSummary {
  id: string;
  status: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface LlmReply {
  reply: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toDto(message: DriverChatMessageRow): DriverChatMessageDto {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    time: formatTime(message.created_at),
  };
}

function sessionHasUserMessage(messages: DriverChatMessageRow[]) {
  return messages.some((message) => message.role === "user");
}

async function getSessionMessages(sessionId: string) {
  const { data, error } = await supabase
    .from("driver_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DriverChatMessageRow[];
}

async function saveMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
) {
  const { data, error } = await supabase
    .from("driver_chat_messages")
    .insert([{ session_id: sessionId, role, content }])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save message");
  }

  return data as DriverChatMessageRow;
}

async function getDriverContext(userId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("name, driver_id")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    throw new Error("Driver profile not found");
  }

  if (!user.driver_id) {
    return {
      driverName: user.name,
      driverId: null,
      activeJobs: [],
      recentCompleted: [],
    };
  }

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name, phone, location, rating, trips")
    .eq("id", user.driver_id)
    .single();

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "display_id, customer, phone, vehicle, registration, address, service, pickup_time, status, driver_status, priority, notes, updated_at",
    )
    .eq("driver_id", user.driver_id)
    .order("updated_at", { ascending: false })
    .limit(20);

  const activeJobs = (bookings ?? [])
    .filter((booking) => booking.status !== "completed")
    .map((booking) => {
      const driverStatus = booking.driver_status ?? "assigned";
      const nextStatus = getNextDriverStatus(
        driverStatus as Parameters<typeof getNextDriverStatus>[0],
      );

      return {
        bookingId: booking.display_id,
        customer: booking.customer,
        phone: booking.phone,
        vehicle: booking.vehicle,
        registration: booking.registration,
        pickupAddress: booking.address,
        service: booking.service,
        pickupTime: booking.pickup_time,
        priority: booking.priority,
        bookingStatus: booking.status,
        driverStatus,
        nextStatus,
        notes: booking.notes,
      };
    });

  const recentCompleted = (bookings ?? [])
    .filter((booking) => booking.status === "completed")
    .slice(0, 5)
    .map((booking) => ({
      bookingId: booking.display_id,
      customer: booking.customer,
      vehicle: booking.vehicle,
    }));

  return {
    driverName: driver?.name ?? user.name,
    driverId: user.driver_id,
    phone: driver?.phone ?? null,
    location: driver?.location ?? null,
    rating: driver?.rating ?? null,
    trips: driver?.trips ?? null,
    activeJobs,
    recentCompleted,
  };
}

async function callDriverLlm(
  history: DriverChatMessageRow[],
  userMessage: string,
  userId: string,
) {
  const context = await getDriverContext(userId);

  const llmMessages = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({
      role: message.role === "user" ? ("user" as const) : ("model" as const),
      content: message.content,
    }));

  llmMessages.push({ role: "user", content: userMessage });

  return generateGeminiJson<LlmReply>({
    systemInstruction: `${SYSTEM_PROMPT}\n\nDriver context JSON:\n${JSON.stringify(context, null, 2)}`,
    messages: llmMessages,
  });
}

async function createChatSession(userId: string) {
  const { data, error } = await supabase
    .from("driver_chat_sessions")
    .insert([{ user_id: userId, status: "active" }])
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create chat session");
  }

  return data as DriverChatSessionRow;
}

export async function cleanupEmptyActiveSessions(userId: string) {
  const { data: sessions, error } = await supabase
    .from("driver_chat_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    throw new Error(error.message);
  }

  for (const session of sessions ?? []) {
    const messages = await getSessionMessages(session.id);
    if (!sessionHasUserMessage(messages)) {
      await supabase.from("driver_chat_sessions").delete().eq("id", session.id);
    }
  }
}

async function abandonActiveSessions(userId: string) {
  await cleanupEmptyActiveSessions(userId);

  await supabase
    .from("driver_chat_sessions")
    .update({
      status: "abandoned",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "active");
}

export async function getChatSession(sessionId: string, userId: string) {
  const { data, error } = await supabase
    .from("driver_chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Chat session not found");
  }

  const messages = await getSessionMessages(sessionId);

  return {
    session: data as DriverChatSessionRow,
    messages: messages
      .filter((message) => message.role !== "system")
      .map(toDto),
  };
}

export async function listChatSessions(
  userId: string,
): Promise<DriverChatSessionSummary[]> {
  const { data: sessions, error } = await supabase
    .from("driver_chat_sessions")
    .select("id, status, created_at, updated_at")
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
  const { data: messages, error: messagesError } = await supabase
    .from("driver_chat_messages")
    .select("session_id, role, content, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw new Error(messagesError.message);
  }

  const messagesBySession = new Map<string, DriverChatMessageRow[]>();
  for (const message of (messages ?? []) as DriverChatMessageRow[]) {
    const existing = messagesBySession.get(message.session_id) ?? [];
    existing.push(message);
    messagesBySession.set(message.session_id, existing);
  }

  return sessions
    .map((session) => {
      const sessionMessages = messagesBySession.get(session.id) ?? [];
      if (!sessionHasUserMessage(sessionMessages)) {
        return null;
      }

      const firstUser = sessionMessages.find((message) => message.role === "user");

      return {
        id: session.id,
        status: session.status,
        preview: firstUser?.content.slice(0, 80) ?? "Driver conversation",
        messageCount: sessionMessages.length,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
    })
    .filter((session): session is DriverChatSessionSummary => session !== null);
}

export async function getActiveChatSession(userId: string) {
  await cleanupEmptyActiveSessions(userId);

  const { data, error } = await supabase
    .from("driver_chat_sessions")
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
    await supabase.from("driver_chat_sessions").delete().eq("id", data.id);
    return null;
  }

  return {
    session: data as DriverChatSessionRow,
    messages: messages
      .filter((message) => message.role !== "system")
      .map(toDto),
  };
}

export async function sendChatMessage(
  sessionId: string,
  userId: string,
  message: string,
) {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Message cannot be empty");
  }

  if (trimmed.length > 8000) {
    throw new Error("Message is too long");
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from("driver_chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !sessionRow) {
    throw new Error("Chat session not found");
  }

  const session = sessionRow as DriverChatSessionRow;

  if (session.status !== "active") {
    throw new Error("This chat session is closed");
  }

  const history = await getSessionMessages(sessionId);
  await saveMessage(sessionId, "user", trimmed);

  const llmResponse = await callDriverLlm(history, trimmed, userId);
  const reply =
    llmResponse.reply?.trim() ||
    "I'm here to help. Could you rephrase your question?";

  const assistantMessage = await saveMessage(sessionId, "assistant", reply);

  await supabase
    .from("driver_chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  return {
    sessionId,
    status: session.status,
    message: toDto(assistantMessage),
  };
}

export async function startChatWithMessage(userId: string, message: string) {
  await abandonActiveSessions(userId);

  const session = await createChatSession(userId);
  await saveMessage(session.id, "assistant", WELCOME_TEXT);

  return sendChatMessage(session.id, userId, message);
}

export async function resetChatSession(userId: string) {
  await abandonActiveSessions(userId);
}

export async function deleteChatSession(sessionId: string, userId: string) {
  const { data, error: fetchError } = await supabase
    .from("driver_chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !data) {
    throw new Error("Chat session not found");
  }

  const { error } = await supabase
    .from("driver_chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}
