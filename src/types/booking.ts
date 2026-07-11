export interface BookingRequest {
  customer: string;
  phone: string;
  vehicle: string;
  registration: string;
  address: string;
  service: string;
  pickup_time: string;
  priority: "High" | "Medium" | "Low";
  notes?: string;
}