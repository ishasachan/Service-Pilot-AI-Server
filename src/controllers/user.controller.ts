import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { supabase } from "../config/db";

export async function getCurrentUser(
  req: AuthRequest,
  res: Response
) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(
        "id,name,email,role,driver_id,created_at"
      )
      .eq("id", req.user?.id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      user: data,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}