-- Remove synthetic test data from a DEV database.
--
-- Test fixtures must never be attributable to a real company: fabricated
-- trades on a real ticker can end up in a screenshot or demo and read as
-- fact. All fixtures use the reserved ZZ* ticker prefix and e2e-* dedup
-- keys; this purges both, plus any legacy rows from before that rule.
--
--   docker exec -i insiderflow-postgres psql -U postgres -d insiderflow \
--     < packages/db/scripts/purge-synthetic.sql

BEGIN;

-- NOTE: do NOT match 'legacy#%' here. Those keys were assigned by migration
-- 0001 to REAL rows ingested before dedup_key existed — they are genuine
-- EDGAR data, not fixtures.
DELETE FROM transactions
WHERE dedup_key LIKE 'e2e-%'
   OR dedup_key LIKE 'sse-live-test%';

UPDATE filings SET superseded_by_filing_id = NULL
WHERE accession_no LIKE 'e2e-%';

DELETE FROM filings WHERE accession_no LIKE 'e2e-%';

DELETE FROM sast_disclosures WHERE dedup_key LIKE 'e2e-%';
DELETE FROM bulk_block_deals WHERE dedup_key LIKE 'e2e-%';
DELETE FROM pledge_disclosures WHERE dedup_key LIKE 'e2e-%';

-- Reserved synthetic namespace.
DELETE FROM transactions t USING companies c
  WHERE t.company_id = c.id AND c.ticker LIKE 'ZZ%';
DELETE FROM companies WHERE ticker LIKE 'ZZ%';
DELETE FROM insiders WHERE external_key LIKE 'name:%:ZZ%' OR name LIKE 'ZZ %';

-- Companies/insiders left with no activity after the purge.
DELETE FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM filings f WHERE f.issuer_company_id = c.id);
DELETE FROM insiders i
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.insider_id = i.id);

COMMIT;
