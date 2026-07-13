/**
 * Loads server `.env` before any MCP module imports Supabase or other config.
 * Import this file first in every MCP entry point.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
