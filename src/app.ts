import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import bookingRoutes from "./routes/booking.routes";

dotenv.config();

const app = express();

app.use(cors());

app.use(express.json());

app.get("/", (_, res) => {
  res.json({
    success: true,
    message: "ServicePilot Backend Running",
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use(
  "/api/bookings",
  bookingRoutes
);

export default app;