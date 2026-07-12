import { Router } from "express";

import {
  advanceDriverStatus,
  assignDriver,
  createBooking,
  deleteBooking,
  getBookingById,
  getBookingHistory,
  getBookings,
  updateBookingStatus,
} from "../controllers/booking.controller";

import {
  authorize,
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

router.put(
  "/:id/advance-driver-status",
  verifyToken,
  advanceDriverStatus
);

router.get(
  "/:id/history",
  verifyToken,
  getBookingHistory
);

router.delete(
  "/:id",
  verifyToken,
  authorize("advisor"),
  deleteBooking
);

export default router;