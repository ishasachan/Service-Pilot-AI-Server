/**
 * Maps service operations to MCP tool definitions with role-based registration.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  assignDriver,
  findBooking,
  getBookingDetails,
  getCustomerHistory,
  getPendingBookings,
  schedulePickup,
} from "../services/bookingOperations";
import {
  dashboardSummary,
  driverPerformance,
  priorityBreakdown,
  todayBookings,
} from "../services/dashboardOperations";
import {
  advanceJobStatus,
  getAvailableDrivers,
  getDriverJobs,
  getDriverStatistics,
  getNextJob,
} from "../services/driverOperations";
import {
  getNotifications,
  markNotificationRead,
  notifyDriver,
} from "../services/notificationOperations";
import { jsonToolResult } from "../shared/toolResult";

import type { ServicePilotUser } from "../auth/provider";

/**
 * Registers MCP tools on the server based on the logged-in user's role.
 * Advisors get booking/dashboard tools; drivers get job/status tools.
 *
 * @param server - MCP server instance for this session.
 * @param user - Authenticated user from the OAuth bearer token.
 */
export function registerServicePilotTools(
  server: McpServer,
  user: ServicePilotUser,
) {
  if (user.role === "advisor") {
    registerAdvisorTools(server);
  }

  if (user.role === "driver") {
    registerDriverTools(server, user);
  }
}

/** Registers all advisor-only MCP tools (booking, dashboard, notifications). */
function registerAdvisorTools(server: McpServer) {
  server.registerTool(
    "find_booking",
    {
      title: "Find Booking",
      description: "Search bookings by ID, customer, phone, or vehicle.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => jsonToolResult(await findBooking(query)),
  );

  server.registerTool(
    "get_booking_details",
    {
      title: "Get Booking Details",
      description: "Get booking details and history.",
      inputSchema: { bookingId: z.string() },
    },
    async ({ bookingId }) => jsonToolResult(await getBookingDetails(bookingId)),
  );

  server.registerTool(
    "get_pending_bookings",
    {
      title: "Get Pending Bookings",
      description: "List bookings waiting for driver assignment.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getPendingBookings()),
  );

  server.registerTool(
    "schedule_pickup",
    {
      title: "Schedule Pickup",
      description: "Create a new service pickup booking.",
      inputSchema: {
        customer: z.string(),
        phone: z.string(),
        vehicle: z.string(),
        registration: z.string().optional(),
        address: z.string(),
        pickupTime: z.string(),
        service: z.string().optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        notes: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async (input) => jsonToolResult(await schedulePickup(input)),
  );

  server.registerTool(
    "assign_driver",
    {
      title: "Assign Driver",
      description: "Assign a driver to a booking.",
      inputSchema: {
        bookingId: z.string(),
        driverId: z.string(),
      },
    },
    async (input) => jsonToolResult(await assignDriver(input)),
  );

  server.registerTool(
    "get_customer_history",
    {
      title: "Get Customer History",
      description: "Look up returning customers.",
      inputSchema: {
        phone: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async (input) => jsonToolResult(await getCustomerHistory(input)),
  );

  server.registerTool(
    "get_available_drivers",
    {
      title: "Get Available Drivers",
      description: "List drivers and availability.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getAvailableDrivers()),
  );

  server.registerTool(
    "dashboard_summary",
    {
      title: "Dashboard Summary",
      description: "Operational KPI summary for the dealership.",
      inputSchema: {},
    },
    async () => jsonToolResult(await dashboardSummary()),
  );

  server.registerTool(
    "today_bookings",
    {
      title: "Today's Bookings",
      description: "Bookings created today.",
      inputSchema: {},
    },
    async () => jsonToolResult(await todayBookings()),
  );

  server.registerTool(
    "driver_performance",
    {
      title: "Driver Performance",
      description: "Driver rankings and completed trips.",
      inputSchema: {},
    },
    async () => jsonToolResult(await driverPerformance()),
  );

  server.registerTool(
    "priority_breakdown",
    {
      title: "Priority Breakdown",
      description: "Active bookings by priority.",
      inputSchema: {},
    },
    async () => jsonToolResult(await priorityBreakdown()),
  );

  server.registerTool(
    "notify_driver",
    {
      title: "Notify Driver",
      description: "Send an internal notification to a driver.",
      inputSchema: {
        driverId: z.string(),
        title: z.string(),
        message: z.string(),
      },
    },
    async (input) => jsonToolResult(await notifyDriver(input)),
  );
}

/** Registers all driver-only MCP tools (jobs, status, notifications). */
function registerDriverTools(server: McpServer, user: ServicePilotUser) {
  const driverId = user.driverId;
  if (!driverId) return;

  server.registerTool(
    "get_driver_jobs",
    {
      title: "Get Driver Jobs",
      description: "List your active assigned jobs.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getDriverJobs(driverId)),
  );

  server.registerTool(
    "get_next_job",
    {
      title: "Get Next Job",
      description: "Your next upcoming pickup job.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getNextJob(driverId)),
  );

  server.registerTool(
    "advance_job_status",
    {
      title: "Advance Job Status",
      description: "Move a job to the next pickup status step.",
      inputSchema: { bookingId: z.string() },
    },
    async ({ bookingId }) =>
      jsonToolResult(await advanceJobStatus({ bookingId, driverId })),
  );

  server.registerTool(
    "get_booking_details",
    {
      title: "Get Booking Details",
      description: "Get details for one of your assigned jobs.",
      inputSchema: { bookingId: z.string() },
    },
    async ({ bookingId }) => {
      const details = await getBookingDetails(bookingId);
      if (!details.success) return jsonToolResult(details);
      if (details.booking.assignedDriverId !== driverId) {
        return jsonToolResult({
          success: false,
          message: "Access denied for this job",
        });
      }
      return jsonToolResult(details);
    },
  );

  server.registerTool(
    "driver_statistics",
    {
      title: "Driver Statistics",
      description: "Your trips, rating, and workload stats.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getDriverStatistics(driverId)),
  );

  server.registerTool(
    "get_notifications",
    {
      title: "Get Notifications",
      description: "Your recent driver notifications.",
      inputSchema: {},
    },
    async () => jsonToolResult(await getNotifications(user.id)),
  );

  server.registerTool(
    "mark_notification_read",
    {
      title: "Mark Notification Read",
      description: "Mark a notification as read.",
      inputSchema: { notificationId: z.string() },
    },
    async ({ notificationId }) =>
      jsonToolResult(
        await markNotificationRead({
          userId: user.id,
          notificationId,
        }),
      ),
  );
}
