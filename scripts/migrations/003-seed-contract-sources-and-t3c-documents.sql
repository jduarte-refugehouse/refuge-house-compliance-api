-- ============================================================================
-- RadiusCompliance Database — Migration 003
-- Seed: SSCC contracting entity regulatory sources + T3C Blueprint documents
-- Run against: RadiusCompliance database AFTER 002-seed-initial-data.sql
--
-- Seeds:
--   1. SSCC contracting entity regulatory sources (2INgage, 4Kids, Belong,
--      DFPS Contracts, Empower, OCOK)
--   2. Updated T3C Blueprint and TAC 749 version metadata
--   3. T3C Blueprint CPA service package markdown documents
--   4. Document-to-regulation mappings for T3C Blueprint
--
-- This script is idempotent — safe to re-run. Uses NOT EXISTS checks
-- and MERGE for updates.
-- ============================================================================

PRINT '============================================================================';
PRINT 'Migration 003: SSCC Contract Sources + T3C Blueprint Documents';
PRINT '============================================================================';

-- ============================================================================
-- 1. SSCC CONTRACTING ENTITY REGULATORY SOURCES
--    Each SSCC (Single Source Continuum Contractor) has provider manuals and
--    agreements that Refuge House must comply with.
-- ============================================================================

PRINT '';
PRINT 'Seeding SSCC contracting entity regulatory sources...';

-- ---------------------------------------------------------------------------
-- 2INgage (Region 2 SSCC)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = '2INgage' AND reference_code = '2INgage-Provider-Manual')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('2INgage', '2INgage-Provider-Manual', '2INgage Provider Manual (Rev. January 2026)',
    'Provider manual for 2INgage SSCC network. Defines operational requirements, service delivery expectations, and compliance standards for contracted providers.',
    NULL, '2026-01-01', '2026-01-01', 'active',
    'regulatory-references/2INgage/2INgage-Provider-Manual-Revised-1.2026.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = '2INgage' AND reference_code = '2INgage-PSA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('2INgage', '2INgage-PSA', 'TFI/2INgage Provider Services Agreement',
    'Provider services agreement between TFI Family Services (2INgage SSCC) and Refuge House. Defines contractual obligations, payment terms, and performance requirements.',
    NULL, '2018-11-08', '2018-11-08', 'active',
    'regulatory-references/2INgage/TFI_SSCC_Provider_Svs_Agrmnt_20181108 - FINAL.pdf');

-- ---------------------------------------------------------------------------
-- 4Kids (Region 3b SSCC — 4Kids4Families)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = '4Kids' AND reference_code = '4Kids-Provider-Manual')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('4Kids', '4Kids-Provider-Manual', '4Kids4Families Provider Manual',
    'Provider manual for 4Kids SSCC network. Defines operational requirements, service delivery expectations, and compliance standards for contracted providers.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/4Kids/4kids4families manual.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = '4Kids' AND reference_code = '4Kids-Contract-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('4Kids', '4Kids-Contract-Dallas', '4Kids Contract — Refuge House Inc. (Dallas)',
    'Complete contract and consents between 4Kids SSCC and Refuge House Inc. (Dallas operations).',
    NULL, NULL, NULL, 'active',
    'regulatory-references/4Kids/Refuge House Inc - complete contract and consents.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = '4Kids' AND reference_code = '4Kids-Contract-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('4Kids', '4Kids-Contract-SA', '4Kids Contract — Refuge House San Antonio',
    'Complete contract and consents between 4Kids SSCC and Refuge House San Antonio.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/4Kids/Refuge House San Antonio - complete contract and consents.pdf');

-- ---------------------------------------------------------------------------
-- Belong (SSCC)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Belong' AND reference_code = 'Belong-PSA-Template')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('Belong', 'Belong-PSA-Template', 'Belong Provider Services Agreement (Template)',
    'Standard provider services agreement template for Belong SSCC network.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/Belong/_Belong_Provider_Services_Agreement.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Belong' AND reference_code = 'Belong-PSA-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('Belong', 'Belong-PSA-Dallas', 'Belong Provider Agreement — Refuge House Inc. (exp. 7/24/2026)',
    'Signed provider service agreement between Belong and Refuge House Inc., including 8a and 8b attachments. Expires 7/24/2026.',
    NULL, NULL, '2026-07-24', 'active',
    'regulatory-references/Belong/Refuge House Inc. Signed Provider Service Agreememt- 8a and 8b exp. 7.24.2026.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Belong' AND reference_code = 'Belong-PSA-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('Belong', 'Belong-PSA-SA', 'Belong Provider Agreement — Refuge House San Antonio',
    'Signed provider service agreement between Belong and Refuge House San Antonio, including 8a and 8b attachments.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/Belong/Refuge House SA- Signed Provider Agreement- 8a and 8b.pdf');

-- ---------------------------------------------------------------------------
-- DFPS Contracts and T3C Addenda
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-FY24-Contract-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-FY24-Contract-Dallas', 'DFPS FY24 CPA Contract — Refuge House Inc. (23345423)',
    'Fiscal Year 2024 CPA contract between DFPS and Refuge House Inc.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/FY 24 Refuge House Inc 23345423.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-FY24-Amendment-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-FY24-Amendment-SA', 'DFPS FY24 Amendment — Refuge House San Antonio (23412401)',
    'Fiscal Year 2024 contract amendment for Refuge House San Antonio Inc.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/FY 24 AMENDMENT Refuge House San Antonio Inc 23412401.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-2282V-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-2282V-Dallas', 'DFPS 2282V FY24 — CPA Refuge House',
    '2282V verification form for FY24 CPA Refuge House operations.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/2282V_FY24 CPA Refuge House_.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-2282V-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-2282V-SA', 'DFPS 2282V FY24 — CPA Refuge House of San Antonio',
    '2282V verification form for FY24 CPA Refuge House of San Antonio operations.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/2282V_FY24 CPA Refuge House of San Antonio.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-T3C-Addendum-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-T3C-Addendum-Dallas', 'T3C Addendum (Rev. 7-1-2025) — Active Interim',
    'T3C contract addendum for Refuge House Inc. Revised 7/1/2025, Active Interim credential status.',
    NULL, '2025-07-01', '2025-07-01', 'active',
    'regulatory-references/DFPS/T3C Addendum rev. 7-1-2025 - Active Interim.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-T3C-Addendum-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-T3C-Addendum-SA', 'T3C Addendum SA — Active Interim',
    'T3C contract addendum for Refuge House San Antonio. Active Interim credential status.',
    NULL, '2025-07-01', '2025-07-01', 'active',
    'regulatory-references/DFPS/T3C Addendum-SA - Active Interim.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-Contract-Dallas-Full')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-Contract-Dallas-Full', 'DFPS Complete Contract and Consents — Refuge House Inc.',
    'Complete contract package including all consents for Refuge House Inc. Dallas operations.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/Refuge House Inc - complete contract and consents.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'DFPS-Contract-SA-Full')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('DFPS', 'DFPS-Contract-SA-Full', 'DFPS Complete Contract and Consents — Refuge House San Antonio',
    'Complete contract package including all consents for Refuge House San Antonio.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/DFPS/Refuge House San Antonio - complete contract and consents.pdf');

-- ---------------------------------------------------------------------------
-- Empower (SSCC)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Empower' AND reference_code = 'Empower-Provider-Manual')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('Empower', 'Empower-Provider-Manual', 'Empower Provider Manual (Rev. January 2026)',
    'Provider manual for Empower SSCC network. Defines operational requirements, service delivery expectations, and compliance standards for contracted providers.',
    NULL, '2026-01-01', '2026-01-01', 'active',
    'regulatory-references/Empower/EMPOWER-Provider-Manual-Revised-1.2026.pdf');

-- ---------------------------------------------------------------------------
-- OCOK (Our Community Our Kids — Region 3b SSCC)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Operations-Manual')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Operations-Manual', 'OCOK Network Management Operations Manual (Rev. 7-1-2025)',
    'Comprehensive operations manual for OCOK SSCC network. Covers network management, provider oversight, service delivery standards, and performance requirements.',
    NULL, '2025-07-01', '2025-07-01', 'active',
    'regulatory-references/OCOK/OCOK Network Management Operations Manual - Rev. 7-1-2025.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-PSA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-PSA', 'OCOK Provider Services Agreement',
    'Base provider services agreement between OCOK and Refuge House. Governs the contractual relationship for service delivery within the OCOK network.',
    NULL, NULL, NULL, 'active',
    'regulatory-references/OCOK/Provider Services Agreement.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-1')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-1', 'OCOK 1st Addendum', 'First addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/1st Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-2')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-2', 'OCOK 2nd Addendum', 'Second addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/2nd Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-3')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-3', 'OCOK 3rd Addendum', 'Third addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/3rd Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-4')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-4', 'OCOK 4th Addendum', 'Fourth addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/4th Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-5')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-5', 'OCOK 5th Addendum', 'Fifth addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/5th Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-6')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-6', 'OCOK 6th Addendum', 'Sixth addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/6th Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-7')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-7', 'OCOK 7th Addendum', 'Seventh addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/7th Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Addendum-8')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Addendum-8', 'OCOK 8th Addendum', 'Eighth addendum to OCOK Provider Services Agreement.', NULL, NULL, NULL, 'active', 'regulatory-references/OCOK/8th Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Payment-Addendum')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Payment-Addendum', 'OCOK Provider Payment Addendum (Effective 10/1/21)',
    'Payment terms addendum to OCOK Provider Services Agreement.', NULL, '2021-10-01', NULL, 'active',
    'regulatory-references/OCOK/Provider Payment Addendum Effective 10121.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Stepdown-Addendum')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Stepdown-Addendum', 'OCOK Stepdown Additional Support Payment Addendum',
    'Addendum governing stepdown and additional support payment terms.', NULL, NULL, NULL, 'active',
    'regulatory-references/OCOK/Stepdown Additional Support Payment Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-Term-Change')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-Term-Change', 'OCOK Term Change Addendum',
    'Addendum modifying contract term and duration.', NULL, NULL, NULL, 'active',
    'regulatory-references/OCOK/Term Change Addendum.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-DUA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-DUA', 'OCOK Data Use Agreement (Updated)',
    'Data use agreement governing data sharing, privacy, and security between OCOK and Refuge House.', NULL, NULL, NULL, 'active',
    'regulatory-references/OCOK/DUA Updated.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-UTC-Addendum')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-UTC-Addendum', 'OCOK UTC Addendum — Residential Provider (R3W, 11-01-2023)',
    'Uniform Terms and Conditions addendum for residential provider services agreement.', NULL, '2023-11-01', NULL, 'active',
    'regulatory-references/OCOK/UTC Addendum Residential Provider Serv. Agreement R3W 11-01-2023.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-T3C-Addendum-Dallas')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-T3C-Addendum-Dallas', 'OCOK T3C Addendum (Rev. 7-1-2025) — Active Interim',
    'T3C addendum to OCOK provider agreement for Dallas operations. Revised 7/1/2025.', NULL, '2025-07-01', '2025-07-01', 'active',
    'regulatory-references/OCOK/T3C Addendum rev. 7-1-2025 - Active Interim.pdf');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'OCOK' AND reference_code = 'OCOK-T3C-Addendum-SA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, source_url, effective_date, last_updated, status, knowbase_path)
VALUES ('OCOK', 'OCOK-T3C-Addendum-SA', 'OCOK T3C Addendum SA — Active Interim',
    'T3C addendum to OCOK provider agreement for San Antonio operations.', NULL, '2025-07-01', '2025-07-01', 'active',
    'regulatory-references/OCOK/T3C Addendum-SA - Active Interim.pdf');

PRINT 'SSCC contracting entity regulatory sources seeded.';
GO

-- ============================================================================
-- 2. UPDATE EXISTING REGULATORY SOURCE VERSIONS
--    TAC Chapter 749 and T3C Blueprint have new editions.
-- ============================================================================

PRINT '';
PRINT 'Updating TAC 749 and T3C Blueprint version metadata...';

-- Update TAC Chapter 749: Nov 2025 -> Dec 2025 (date-stamp republication, no content changes)
UPDATE regulatory_sources
SET last_updated = '2025-12-01',
    description = 'Minimum Standards for Child-Placing Agencies. December 2025 edition (date-stamp update from November 2025; no substantive content changes). 12 markdown parts converted in knowbase.',
    knowbase_path = 'regulatory-references/source-pdfs/2025_12_chapter-749-cpa.pdf',
    updated_at = GETDATE()
WHERE authority = 'DFPS' AND reference_code = '26 TAC Ch. 749';

-- Update T3C Blueprint: Oct 2025 -> Jan 2026 CPA edition
UPDATE regulatory_sources
SET last_updated = '2026-01-28',
    description = 'T3C Service Model Blueprint, January 2026 CPA edition (285pp). GRO content trimmed. CPA service package requirements unchanged from Oct 2025 except funding clarification in Pregnant & Parenting Add-On. 9 CPA service package markdowns converted in knowbase.',
    knowbase_path = 'regulatory-references/source-pdfs/2026_01_t3c_blueprint_cpa.pdf',
    updated_at = GETDATE()
WHERE authority = 'DFPS' AND reference_code = 'T3C Blueprint';

PRINT 'Regulatory source versions updated.';
GO

-- ============================================================================
-- 3. T3C BLUEPRINT CPA SERVICE PACKAGE DOCUMENTS
--    Register the 9 converted markdown files as compliance documents.
-- ============================================================================

PRINT '';
PRINT 'Registering T3C Blueprint CPA service package documents...';

-- Service Packages (6)
IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-basic-foster-family-home.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-basic-foster-family-home.md',
    'T3C Basic Foster Family Home Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'basic-foster-family-home', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-substance-use.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-substance-use.md',
    'Substance Use Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'substance-use', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-short-term-assessment.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-short-term-assessment.md',
    'Short-Term Assessment Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'short-term-assessment', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-mental-behavioral-health.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-mental-behavioral-health.md',
    'Mental & Behavioral Health Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'mental-health', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-idd-autism.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-idd-autism.md',
    'IDD/Autism Spectrum Disorder Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'idd-autism', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-treatment-foster-family.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-treatment-foster-family.md',
    'T3C Treatment Foster Family Care Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'treatment-foster-family', 90, 'current', '2026-01-28');

-- Add-On Services (3)
IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-transition.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-transition.md',
    'Transition Support Services for Youth & Young Adults (Blueprint)', 'regulatory', 'regulatory-reference', 'all', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-kinship.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-kinship.md',
    'Kinship Caregiver Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'all', 90, 'current', '2026-01-28');

IF NOT EXISTS (SELECT 1 FROM compliance_documents WHERE document_path = 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-pregnant-parenting.md')
INSERT INTO compliance_documents (document_path, title, category, content_type, service_packages, review_frequency_days, status, effective_date)
VALUES ('regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-addon-pregnant-parenting.md',
    'Pregnant & Parenting Youth or Young Adult Support Services (Blueprint)', 'regulatory', 'regulatory-reference', 'all', 90, 'current', '2026-01-28');

PRINT 'T3C Blueprint documents registered.';
GO

-- ============================================================================
-- 4. DOCUMENT-TO-REGULATION MAPPINGS
--    Link each T3C Blueprint markdown to the T3C Blueprint regulatory source.
-- ============================================================================

PRINT '';
PRINT 'Creating document-to-regulation mappings...';

-- Get the T3C Blueprint regulatory source ID
DECLARE @t3cBlueprintId INT;
SELECT @t3cBlueprintId = id FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'T3C Blueprint';

IF @t3cBlueprintId IS NOT NULL
BEGIN
    -- Map each T3C Blueprint markdown document to the T3C Blueprint regulation
    DECLARE @docId INT;

    DECLARE blueprint_docs CURSOR FOR
        SELECT id FROM compliance_documents
        WHERE document_path LIKE 'regulatory-references/markdown/t3c-blueprint-parts/t3c-blueprint-%'
          AND status = 'current';

    OPEN blueprint_docs;
    FETCH NEXT FROM blueprint_docs INTO @docId;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM document_regulatory_mappings
            WHERE document_id = @docId AND regulatory_source_id = @t3cBlueprintId
        )
        INSERT INTO document_regulatory_mappings (document_id, regulatory_source_id, mapping_type, notes)
        VALUES (@docId, @t3cBlueprintId, 'references', 'Markdown conversion of T3C Blueprint CPA service package section');

        FETCH NEXT FROM blueprint_docs INTO @docId;
    END

    CLOSE blueprint_docs;
    DEALLOCATE blueprint_docs;

    PRINT CONCAT('Mapped T3C Blueprint documents to regulatory source ID ', @t3cBlueprintId);
END
ELSE
    PRINT 'WARNING: T3C Blueprint regulatory source not found. Mappings skipped.';
GO

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

PRINT '';
PRINT '============================================================================';
PRINT 'MIGRATION 003 VERIFICATION';
PRINT '============================================================================';

PRINT '';
PRINT 'Regulatory sources by authority:';
SELECT authority, COUNT(*) AS [Count] FROM regulatory_sources GROUP BY authority ORDER BY authority;

PRINT '';
PRINT 'New SSCC contracting entity sources:';
SELECT authority, reference_code, title, status
FROM regulatory_sources
WHERE authority IN ('2INgage', '4Kids', 'Belong', 'Empower', 'OCOK')
   OR (authority = 'DFPS' AND reference_code LIKE 'DFPS-%')
ORDER BY authority, reference_code;

PRINT '';
PRINT 'T3C Blueprint compliance documents:';
SELECT id, document_path, title, service_packages, status
FROM compliance_documents
WHERE document_path LIKE '%t3c-blueprint%'
ORDER BY document_path;

PRINT '';
PRINT 'Document-to-regulation mappings for T3C Blueprint:';
SELECT drm.id, d.title AS document_title, rs.reference_code AS regulation, drm.mapping_type
FROM document_regulatory_mappings drm
JOIN compliance_documents d ON d.id = drm.document_id
JOIN regulatory_sources rs ON rs.id = drm.regulatory_source_id
WHERE d.document_path LIKE '%t3c-blueprint%'
ORDER BY d.title;

PRINT '';
PRINT '============================================================================';
PRINT 'Migration 003 complete.';
PRINT '============================================================================';
GO
