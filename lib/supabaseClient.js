"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// This must match the admin email in supabase/schema.sql (is_admin function)
// and in Supabase Auth settings. Change both places together if it ever changes.
export const ADMIN_EMAIL = "shaikhshahid3786@gmail.com";
