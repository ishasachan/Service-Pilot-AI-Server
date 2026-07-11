import { Router } from "express";

import {
  getDriverById,
  getDrivers,
} from "../controllers/driver.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.get("/", verifyToken, getDrivers);
router.get("/:id", verifyToken, getDriverById);

export default router;
