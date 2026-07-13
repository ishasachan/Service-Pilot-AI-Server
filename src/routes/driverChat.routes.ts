import { Router } from "express";

import {
  deleteDriverChatSession,
  getActiveDriverChat,
  getDriverChatSession,
  listDriverChatSessions,
  postDriverChatMessage,
  postFirstDriverChatMessage,
  resetDriverChat,
} from "../controllers/driverChat.controller";
import { authorize, verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.use(verifyToken, authorize("driver"));

router.get("/sessions", listDriverChatSessions);

router.get("/sessions/active", getActiveDriverChat);

router.post("/sessions/reset", resetDriverChat);

router.post("/sessions/messages", postFirstDriverChatMessage);

router.get("/sessions/:id", getDriverChatSession);

router.post("/sessions/:id/messages", postDriverChatMessage);

router.delete("/sessions/:id", deleteDriverChatSession);

export default router;
