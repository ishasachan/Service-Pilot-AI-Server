export type DriverStatus =
  | "assigned"
  | "accepted"
  | "on_the_way"
  | "reached_customer"
  | "picked_up"
  | "at_service_centre"
  | "ready_for_delivery"
  | "returning_to_customer"
  | "completed";

const DRIVER_FLOW: DriverStatus[] = [
  "assigned",
  "accepted",
  "on_the_way",
  "reached_customer",
  "picked_up",
  "at_service_centre",
  "ready_for_delivery",
  "returning_to_customer",
  "completed",
];

export function getNextDriverStatus(
  current: DriverStatus,
): DriverStatus | null {
  const index = DRIVER_FLOW.indexOf(current);
  if (index === -1) return null;
  return DRIVER_FLOW[index + 1] ?? null;
}

export function driverStatusToBookingStatus(
  driverStatus: DriverStatus,
): string {
  switch (driverStatus) {
    case "assigned":
    case "accepted":
      return "driver_assigned";
    case "on_the_way":
    case "reached_customer":
      return "driver_on_way";
    case "picked_up":
      return "picked_up";
    case "at_service_centre":
      return "at_service_centre";
    case "ready_for_delivery":
      return "ready_for_delivery";
    case "returning_to_customer":
      return "returning_to_customer";
    case "completed":
      return "completed";
  }
}

export function bookingStatusToDriverStatus(
  bookingStatus: string,
  currentDriverStatus?: string | null,
): DriverStatus | null {
  switch (bookingStatus) {
    case "pending":
      return null;
    case "driver_assigned":
      if (currentDriverStatus === "accepted") return "accepted";
      return "assigned";
    case "driver_on_way":
      if (currentDriverStatus === "reached_customer") return "reached_customer";
      return "on_the_way";
    case "picked_up":
      return "picked_up";
    case "at_service_centre":
    case "in_service":
      return "at_service_centre";
    case "ready_for_delivery":
      return "ready_for_delivery";
    case "returning_to_customer":
      return "returning_to_customer";
    case "completed":
      return "completed";
    default:
      return null;
  }
}
