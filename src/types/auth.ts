export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role: "advisor" | "driver" | "admin";
  driver_id?: string;
}