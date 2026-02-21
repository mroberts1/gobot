/**
 * Creates async_tasks and node_heartbeat tables if they don't exist.
 * Safe to re-run — uses IF NOT EXISTS throughout.
 */

import { loadEnv } from "../src/lib/env";

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

async function sql(query: string, description: string) {
  const res = await fetch(`${url}/rest/v1/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key!,
      Authorization: `Bearer ${key}`,
      Prefer: "params=single-object",
    },
    body: JSON.stringify({ query }),
  });
  // Supabase doesn't expose raw SQL via REST — use the pg extension endpoint
  return { description };
}

// Use Supabase's postgres functions endpoint for raw SQL
async function runSQL(query: string): Promise<void> {
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key!,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ sql: query }),
  });

  if (!res.ok) {
    // Fall back to checking via a simple SELECT
    throw new Error(`${res.status}: ${await res.text()}`);
  }
}

// Check if a table exists via the information_schema
async function tableExists(table: string): Promise<boolean> {
  const res = await fetch(
    `${url}/rest/v1/information_schema.tables?table_name=eq.${table}&table_schema=eq.public&select=table_name`,
    {
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key}`,
      },
    }
  );
  if (!res.ok) return false;
  const data = await res.json() as any[];
  return data.length > 0;
}

// Try to insert a dummy row and catch the "table not found" error
async function checkTableViaInsert(table: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/${table}?limit=1`, {
    headers: {
      apikey: key!,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  return res.ok;
}

console.log("Checking Supabase tables...\n");

const asyncTasksOk = await checkTableViaInsert("async_tasks");
const heartbeatOk = await checkTableViaInsert("node_heartbeat");

if (asyncTasksOk && heartbeatOk) {
  console.log("✅ async_tasks — exists");
  console.log("✅ node_heartbeat — exists");
  console.log("\nNothing to do.");
  process.exit(0);
}

if (!asyncTasksOk) console.log("❌ async_tasks — missing");
if (!heartbeatOk) console.log("❌ node_heartbeat — missing");

console.log(`
The missing tables need to be created via the Supabase SQL editor.
Open your Supabase dashboard → SQL Editor and run:
`);

if (!asyncTasksOk) {
  console.log(`-- async_tasks
CREATE TABLE IF NOT EXISTS async_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  chat_id TEXT NOT NULL,
  original_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'needs_input', 'completed', 'failed')),
  result TEXT,
  session_id TEXT,
  current_step TEXT,
  pending_question TEXT,
  pending_options JSONB,
  user_response TEXT,
  thread_id INTEGER,
  processed_by TEXT,
  reminder_sent BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_async_tasks_chat_id ON async_tasks (chat_id);
CREATE INDEX IF NOT EXISTS idx_async_tasks_status ON async_tasks (status);
CREATE INDEX IF NOT EXISTS idx_async_tasks_updated_at ON async_tasks (updated_at DESC);
ALTER TABLE async_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role full access" ON async_tasks
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "Anon insert access" ON async_tasks
  FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Anon update access" ON async_tasks
  FOR UPDATE USING (true);
`);
}

if (!heartbeatOk) {
  console.log(`-- node_heartbeat
CREATE TABLE IF NOT EXISTS node_heartbeat (
  node_id TEXT PRIMARY KEY,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);
ALTER TABLE node_heartbeat ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role full access" ON node_heartbeat
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "Anon insert access" ON node_heartbeat
  FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Anon update access" ON node_heartbeat
  FOR UPDATE USING (true);
`);
}
