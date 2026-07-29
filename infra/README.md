# infra/

Migrations, Row-Level Security policies, deploy config, CI notes.

RLS: every tenant-scoped table has an RLS policy keyed on the current tenant id. RLS is
ON in every environment, including local — never rely on app-layer checks alone.
