import { createClient } from "@supabase/supabase-js";

// Read Supabase credentials from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project")) {
  console.warn(
    "[Supabase] Missing or placeholder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in /client/.env. Please configure your Supabase credentials."
  );
}

// Client-safe Supabase instance using only the public anon key
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder"
);
