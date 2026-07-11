import { Router } from "express";

import {
    assignDriver,
  createBooking,
  getBookingById,
  getBookingHistory,
  getBookings,
  updateBookingStatus,
} from "../controllers/booking.controller";

import {
  verifyToken,
} from "../middleware/auth.middleware";

const router = Router();

router.get(
  "/",
  verifyToken,
  getBookings
);

router.get(
  "/:id",
  verifyToken,
  getBookingById
);

router.post(
  "/",
  verifyToken,
  createBooking
);

router.put(
  "/:id/assign-driver",
  verifyToken,
  assignDriver
);

router.put(
  "/:id/status",
  verifyToken,
  updateBookingStatus
);

router.get(
  "/:id/history",
  verifyToken,
  getBookingHistory
);

export default router;