import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wvajgsjjrzkstrjyglnq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2YWpnc2pqcnprc3RyanlnbG5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTE0NjUsImV4cCI6MjA4OTk2NzQ2NX0.svAaUEJd-ckhyAvy7u6OrQ9WBuizhzIs5qgjL1myd1k";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
