import { Request, Response } from "express";
import bcrypt from "bcrypt";

import { supabase } from "../config/db";
import { supabaseAuthPublic } from "../config/authClient";
import { generateToken } from "../utils/generateToken";
import { AuthRequest } from "../middleware/auth.middleware";

export async function login(
  req: Request,
  res: Response
) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        driver_id: user.driver_id,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function register(
  req: Request,
  res: Response
) {
  try {
    const {
      name,
      email,
      password,
      role,
      driver_id,
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !role
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const { data: existingUser } =
      await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    const hash = await bcrypt.hash(
      password,
      10
    );

    const { data, error } =
      await supabase
        .from("users")
        .insert([
          {
            name,
            email,
            role,
            driver_id,
            password_hash: hash,
          },
        ])
        .select()
        .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "User Registered",
      user: data,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user } = await supabase
      .from("users")
      .select("auth_user_id")
      .eq("email", normalizedEmail)
      .single();

    if (user?.auth_user_id) {
      const redirectTo = `${process.env.FRONTEND_URL}/reset-password`;

      const { error } = await supabaseAuthPublic.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo },
      );

      if (error) {
        console.error("Supabase reset email error:", error.message);
      }
    }

    return res.json({
      success: true,
      message:
        "If an account exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

export async function syncPassword(
  req: AuthRequest,
  res: Response,
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Recovery session is required",
      });
    }

    const accessToken = authHeader.replace("Bearer ", "");
    const { password } = req.body;

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const { data: authData, error: authError } =
      await supabase.auth.getUser(accessToken);

    if (authError || !authData.user?.email) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired recovery session",
      });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: hash })
      .eq("email", authData.user.email);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: updateError.message,
      });
    }

    return res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}