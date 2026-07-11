import { Router } from "express";

import { getCurrentUser } from "../controllers/user.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.get(
  "/me",
  verifyToken,
  getCurrentUser
);

export default router;