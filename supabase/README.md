# supabase/ — Schema Migrations (files only in Phase 0A)

Rules:

1. Phase 0A produces migration FILES only. The AI never applies them.
2. The OWNER applies migrations to the STAGING project at Gate 0A-5,
   using the Supabase dashboard SQL editor (or Supabase CLI if the owner
   installs it).
3. Production Supabase does not exist as a concept until Phase 4.
4. No destructive statements (DROP TABLE, TRUNCATE, DELETE FROM) are
   permitted in migrations without an owner-approved RED gate.
5. RLS is enabled on every table from the first migration. Policies are
   staging-permissive for the authenticated role and are tightened to
   owner-only auth at Phase 0B when real auth exists.

Owner apply step (staging only): open the Supabase dashboard, SQL editor,
paste the contents of migrations/0001_phase0a_core_schema.sql, run once.
