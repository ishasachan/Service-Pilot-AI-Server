import { Response } from "express";

import { AuthRequest } from "../middleware/auth.middleware";
import {
  deleteChatSession,
  getActiveChatSession,
  getChatSession,
  listChatSessions,
  resetChatSession,
  sendChatMessage,
  startChatWithMessage,
} from "../services/driverChat.service";

export async function listDriverChatSessions(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const sessions = await listChatSessions(userId);

    return res.json({ success: true, sessions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat history";

    return res.status(500).json({ success: false, message });
  }
}

export async function getActiveDriverChat(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const result = await getActiveChatSession(userId);

    if (!result) {
      return res.json({ success: true, session: null });
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

    return res.status(500).json({ success: false, message });
  }
}

export async function getDriverChatSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const result = await getChatSession(id, userId);

    return res.json({
      success: true,
      sessionId: result.session.id,
      status: result.session.status,
      messages: result.messages,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load chat session";

    return res.status(404).json({ success: false, message });
  }
}

export async function postFirstDriverChatMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const result = await startChatWithMessage(userId, message);

    return res.status(201).json({
      success: true,
      sessionId: result.sessionId,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start chat";

    return res.status(500).json({ success: false, message });
  }
}

export async function postDriverChatMessage(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const result = await sendChatMessage(id, userId, message);

    return res.json({
      success: true,
      sessionId: result.sessionId,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send message";

    const status =
      message.includes("not found") || message.includes("closed")
        ? 404
        : message.includes("empty") || message.includes("too long")
          ? 400
          : 500;

    return res.status(status).json({ success: false, message });
  }
}

export async function resetDriverChat(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.id;
    await resetChatSession(userId);

    return res.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reset chat";

    return res.status(500).json({ success: false, message });
  }
}

export async function deleteDriverChatSession(req: AuthRequest, res: Response) {
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

    return res.status(404).json({ success: false, message });
  }
}
