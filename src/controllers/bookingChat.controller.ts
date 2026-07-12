import { Response } from "express";

import { supabase } from "../config/db";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  deleteChatSession,
  getActiveChatSession,
  getChatSession,
  listChatSessions,
  resetChatSession,
  sendChatMessage,
  startChatWithMessage,
} from "../services/bookingChat.service";

export async function listBookingChatSessions(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const sessions = await listChatSessions(userId);

    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat history";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function getActiveBookingChat(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const result = await getActiveChatSession(userId);

    if (!result) {
      return res.json({
        success: true,
        session: null,
      });
    }

    return res.json({
      success: true,
      sessionId: result.session.id,
      status: result.session.status,
      messages: result.messages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load active chat";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function startBookingChat(req: AuthRequest, res: Response) {
  return res.status(410).json({
    success: false,
    message: "Start a chat by sending your first message instead.",
  });
}

export async function postFirstBookingChatMessage(
  req: AuthRequest,
  res: Response,
) {
  try {
    const userId = req.user!.id;
    const { message, choiceId } = req.body as {
      message?: string;
      choiceId?: string;
    };

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const result = await startChatWithMessage(userId, message, choiceId);

    return res.status(201).json({
      success: true,
      sessionId: result.sessionId,
      status: result.status,
      draft: result.draft,
      bookingId: result.bookingId,
      message: result.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start chat";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function getBookingChatSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const result = await getChatSession(id, userId);

    let bookingId: string | null = result.session.booking_id;

    if (bookingId) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("display_id")
        .eq("id", bookingId)
        .single();

      bookingId = booking?.display_id
        ? String(booking.display_id)
        : bookingId;
    }

    return res.json({
      success: true,
      sessionId: result.session.id,
      status: result.session.status,
      draft: result.session.draft,
      bookingId,
      messages: result.messages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat session";

    return res.status(404).json({
      success: false,
      message,
    });
  }
}

export async function postBookingChatMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const { message, choiceId } = req.body as {
      message?: string;
      choiceId?: string;
    };

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const result = await sendChatMessage(id, userId, message, choiceId);

    return res.json({
      success: true,
      sessionId: result.sessionId,
      status: result.status,
      draft: result.draft,
      bookingId: result.bookingId,
      message: result.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send message";

    const status =
      message.includes("not found") || message.includes("completed")
        ? 404
        : message.includes("empty") || message.includes("too long")
          ? 400
          : 500;

    return res.status(status).json({
      success: false,
      message,
    });
  }
}

export async function resetBookingChat(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    await resetChatSession(userId);

    return res.json({
      success: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reset chat";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function deleteBookingChatSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    await deleteChatSession(id, userId);

    return res.json({
      success: true,
      message: "Chat deleted successfully",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete chat";

    return res.status(404).json({
      success: false,
      message,
    });
  }
}
