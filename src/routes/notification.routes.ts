import { Router } from "express";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.get("/", verifyToken, getNotifications);
router.patch("/read-all", verifyToken, markAllNotificationsRead);
router.patch("/:id/read", verifyToken, markNotificationRead);

export default router;
