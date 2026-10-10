-- Hosted Supabase infrastructure. Apply once after the application migrations.
-- Kept separate because the embedded PostgreSQL test engine has no background
-- workers or pg_net. Verify these extensions against the hosted database.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Only the database owner runs the scheduler. Application roles never need
-- direct access to cron commands, HTTP headers, responses, or the Vault.
revoke usage on schema cron, net, vault from public, anon, authenticated;
revoke all on all tables in schema cron, net, vault from public, anon, authenticated;
revoke all on all sequences in schema cron, net from public, anon, authenticated;
revoke execute on all functions in schema cron, net from public, anon, authenticated;
-- Vault's cryptographic internals are owned by the platform; schema/table
-- restrictions above protect their values without altering vendor ownership.
-- Some pg_net objects are platform-owned and retain default role grants;
-- verify that net is NOT an exposed Data API schema. Do not expose net, cron,
-- or vault in PostgREST. The application never accepts arbitrary SQL/RPC names.
