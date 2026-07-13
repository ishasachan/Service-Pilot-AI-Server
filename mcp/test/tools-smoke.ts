/**
 * Smoke-test all MCP service operations (no OAuth).
 * Run: npx tsx mcp/test/tools-smoke.ts
 */
import "../shared/loadEnv";

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
  notifyDriver,
} from "../services/notificationOperations";
import { supabase } from "../../src/config/db";

/** Loads the driver user row from Supabase for smoke tests. */
async function getDriverUser() {
  const { data } = await supabase
    .from("users")
    .select("id, driver_id")
    .eq("email", "driver@servicepilot.ai")
    .single();
  return data;
}

/** Runs a single tool operation and logs pass/fail to the console. */
async function runTool(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    const parsed = result as { success?: boolean; message?: string };
    if (parsed.success === false) {
      console.log(`⚠️  ${name}: ${parsed.message}`);
    } else {
      console.log(`✅ ${name}`);
    }
    return result;
  } catch (error) {
    console.log(
      `❌ ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Entry point: exercises all advisor and driver MCP service functions. */
async function main() {
  console.log("\n=== Advisor tools ===\n");

  await runTool("find_booking", () => findBooking("SP-1001"));
  await runTool("get_booking_details", () => getBookingDetails("SP-1001"));
  await runTool("get_pending_bookings", () => getPendingBookings());
  await runTool("get_customer_history (phone)", () =>
    getCustomerHistory({ phone: "9876543210" }),
  );
  await runTool("get_available_drivers", () => getAvailableDrivers());
  await runTool("dashboard_summary", () => dashboardSummary());
  await runTool("today_bookings", () => todayBookings());
  await runTool("driver_performance", () => driverPerformance());
  await runTool("priority_breakdown", () => priorityBreakdown());

  const drivers = await getAvailableDrivers();
  const pending = await getPendingBookings();
  if (
    drivers.success &&
    drivers.drivers[0] &&
    pending.success &&
    pending.bookings[0]
  ) {
    await runTool("assign_driver", () =>
      assignDriver({
        bookingId: pending.bookings[0].id,
        driverId: drivers.drivers[0].id,
      }),
    );
  }

  await runTool("schedule_pickup", () =>
    schedulePickup({
      customer: "MCP Test User",
      phone: "9000000001",
      vehicle: "Test Car",
      address: "Baner, Pune",
      pickupTime: "Tomorrow 11:00 AM",
      service: "General Service",
      priority: "Low",
      notes: "MCP smoke test booking",
    }),
  );

  console.log("\n=== Driver tools ===\n");

  const driverUser = await getDriverUser();
  const driverId = driverUser?.driver_id;

  if (!driverId) {
    console.log("❌ Could not resolve driver_id for driver@servicepilot.ai");
    return;
  }

  console.log(`Driver ID: ${driverId}\n`);

  await runTool("get_driver_jobs", () => getDriverJobs(driverId));
  await runTool("get_next_job", () => getNextJob(driverId));
  await runTool("driver_statistics", () => getDriverStatistics(driverId));

  if (driverUser?.id) {
    await runTool("get_notifications", () => getNotifications(driverUser.id));
  }

  const jobs = await getDriverJobs(driverId);
  if (jobs.success && jobs.jobs[0]) {
    await runTool("advance_job_status", () =>
      advanceJobStatus({
        bookingId: jobs.jobs[0].id,
        driverId,
      }),
    );
  }

  if (drivers.success && drivers.drivers[0]) {
    await runTool("notify_driver", () =>
      notifyDriver({
        driverId: drivers.drivers[0].id,
        title: "MCP Test",
        message: "Smoke test notification",
      }),
    );
  }

  console.log("\n✅ Smoke test complete\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
