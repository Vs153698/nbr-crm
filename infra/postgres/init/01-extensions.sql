-- Extensions required by the NBR CRM schema.
-- pg_trgm  : fuzzy global search (§17 Search System, §18 Duplicate Detection)
-- unaccent : accent-insensitive name matching for international applicants
-- pgcrypto : gen_random_uuid() + digest() for integrity hashes
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Immutable wrapper so unaccent() can be used inside index expressions.
CREATE OR REPLACE FUNCTION nbr_immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
