import { Router } from "express";

import {
  forgotPassword,
  login,
  register,
  syncPassword,
} from "../controllers/auth.controller";

const router = Router();

router.post("/login", login);

router.post("/register", register);

router.post("/forgot-password", forgotPassword);

router.post("/sync-password", syncPassword);

export default router;