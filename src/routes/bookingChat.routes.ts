import { Router } from "express";

import {
  deleteBookingChatSession,
  getActiveBookingChat,
  getBookingChatSession,
  listBookingChatSessions,
  postBookingChatMessage,
  postFirstBookingChatMessage,
  resetBookingChat,
  startBookingChat,
} from "../controllers/bookingChat.controller";
import { authorize, verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.use(verifyToken, authorize("advisor"));

router.post("/sessions", startBookingChat);

router.get("/sessions", listBookingChatSessions);

router.get("/sessions/active", getActiveBookingChat);

router.post("/sessions/reset", resetBookingChat);

router.post("/sessions/messages", postFirstBookingChatMessage);

router.get("/sessions/:id", getBookingChatSession);

router.post("/sessions/:id/messages", postBookingChatMessage);

router.delete("/sessions/:id", deleteBookingChatSession);

export default router;
