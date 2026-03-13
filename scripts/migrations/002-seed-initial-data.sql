-- ============================================================================
-- RadiusCompliance Database — Seed Data
-- Run against: RadiusCompliance database AFTER 001-create-compliance-tables.sql
--
-- Seeds:
--   1. Regulatory sources — key Texas child welfare regulations
--   2. Approval chain templates — default review workflows by category
--   3. Default reminder configurations (applied per-document during registration)
--
-- This script is idempotent — safe to re-run. Uses NOT EXISTS checks.
-- ============================================================================

-- ============================================================================
-- 1. REGULATORY SOURCES
--    Key regulating entities and regulations for Texas residential child care.
-- ============================================================================

PRINT 'Seeding regulatory sources...';

-- ---------------------------------------------------------------------------
-- DFPS — Minimum Standards for General Residential Operations (26 TAC Ch. 748)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC Ch. 748')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC Ch. 748', 'Minimum Standards for General Residential Operations',
    'Comprehensive standards governing staffing, supervision, physical site, child rights, discipline, food, clothing, personal possessions, health, emergency behavior intervention, and administration for GROs.',
    'active');

-- Subchapter-level entries for the most operationally critical sections
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC §748 Subch. D')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC §748 Subch. D', 'GRO Personnel — Qualifications, Training, Staffing Ratios',
    'Requirements for employee qualifications, background checks, pre-service and annual training hours, and child-to-caregiver ratios.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC §748 Subch. F')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC §748 Subch. F', 'GRO Child Rights and Discipline',
    'Standards for child rights, prohibited punishments, discipline policies, use of restraint, and emergency behavior intervention.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC §748 Subch. H')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC §748 Subch. H', 'GRO Health, Safety, and Emergency Practices',
    'Medication management, medical consents, health screenings, infection control, emergency and evacuation plans.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC §748 Subch. K')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC §748 Subch. K', 'GRO Service Planning and Documentation',
    'Requirements for individualized service plans, initial and ongoing assessments, discharge planning, and case documentation.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC §748 Subch. L')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC §748 Subch. L', 'GRO Emergency Behavior Intervention',
    'Standards for personal restraint, mechanical restraint, emergency medication, seclusion, and documentation of restrictive interventions.',
    'active');

-- ---------------------------------------------------------------------------
-- DFPS — Minimum Standards for Child-Placing Agencies (26 TAC Ch. 749)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC Ch. 749')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC Ch. 749', 'Minimum Standards for Child-Placing Agencies',
    'Standards governing foster home verification, foster parent training, placement matching, child supervision in foster homes, and CPA administration.',
    'active');

-- ---------------------------------------------------------------------------
-- DFPS — Licensing rules and investigations
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = '26 TAC Ch. 745')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', '26 TAC Ch. 745', 'Licensing — General Administrative Rules',
    'Administrative procedures for DFPS licensing: applications, inspections, enforcement actions, corrective action plans, waivers, and variances.',
    'active');

-- ---------------------------------------------------------------------------
-- HHSC — Medicaid and STAR Health
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'HHSC' AND reference_code = 'STAR Health Contract')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('HHSC', 'STAR Health Contract', 'STAR Health Managed Care for Foster Children',
    'Medicaid managed care contract requirements for children in DFPS conservatorship. Covers medical, dental, behavioral health, and trauma-informed care coordination.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'HHSC' AND reference_code = '26 TAC Ch. 261')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('HHSC', '26 TAC Ch. 261', 'IDD/Autism Waiver Services',
    'Home and Community-based Services (HCS) waiver requirements for individuals with intellectual and developmental disabilities, including autism spectrum disorder.',
    'active');

-- ---------------------------------------------------------------------------
-- DFPS — T3C / Community-Based Care (CBC)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'T3C Contract')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', 'T3C Contract', 'Texas Therapeutic Child Care (T3C) Contract',
    'Contract scope of work for T3C providers: service packages, outcomes, rates, reporting, CQI requirements, Blueprint compliance, and service delivery standards.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'T3C Blueprint')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', 'T3C Blueprint', 'T3C Service Model Blueprint',
    'Defines the T3C treatment model: trauma-informed care framework, service tiers, staffing model, treatment milieu, clinical oversight, and outcome measures.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'DFPS' AND reference_code = 'CBC Contract')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('DFPS', 'CBC Contract', 'Community-Based Care (CBC) Contract',
    'SSCC contract for Community-Based Care: catchment area management, placement services, kinship support, case management integration, and performance-based outcomes.',
    'active');

-- ---------------------------------------------------------------------------
-- Texas Statutes
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Texas Legislature' AND reference_code = 'Texas Family Code Ch. 263')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Texas Legislature', 'Texas Family Code Ch. 263', 'Texas Family Code — Review of Placement of Children',
    'Statutory requirements for permanency hearings, placement review hearings, permanency plans, and judicial oversight of children in DFPS conservatorship.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Texas Legislature' AND reference_code = 'Texas Family Code Ch. 264')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Texas Legislature', 'Texas Family Code Ch. 264', 'Texas Family Code — Child Welfare Services',
    'Statutory framework for child welfare services: foster care redesign (CBC), kinship care, aging out, normalcy (Reasonable and Prudent Parent Standard), and prevention services.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Texas Legislature' AND reference_code = 'Texas HRC Ch. 42')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Texas Legislature', 'Texas HRC Ch. 42', 'Texas Human Resources Code — Regulation of Child-Care Facilities',
    'Statutory authority for DFPS licensing of residential child-care facilities, child-placing agencies, and related operations.',
    'active');

-- ---------------------------------------------------------------------------
-- Federal Requirements
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = 'Title IV-E')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', 'Title IV-E', 'Title IV-E — Federal Foster Care and Adoption Assistance',
    'Federal funding requirements for foster care: placement standards, judicial determinations, case plans, permanency hearings, and federal claiming eligibility.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = 'Title IV-B')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', 'Title IV-B', 'Title IV-B — Child and Family Services',
    'Federal requirements for child welfare services planning: state plans, prevention services, family preservation, family reunification, and adoption promotion.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = 'ICWA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', 'ICWA', 'Indian Child Welfare Act (ICWA)',
    'Federal requirements for child custody proceedings involving Indian children: placement preferences, tribal notification, active efforts, and qualified expert witness requirements.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = 'ICPC')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', 'ICPC', 'Interstate Compact on the Placement of Children (ICPC)',
    'Requirements for placing children across state lines: sending and receiving state approvals, home study requirements, and supervision responsibilities.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = '42 CFR §441.301')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', '42 CFR §441.301', 'Home and Community-Based Services (HCBS) Settings Rule',
    'Federal Medicaid requirements for HCBS settings: community integration, individual rights, person-centered planning, and settings compliance.',
    'active');

IF NOT EXISTS (SELECT 1 FROM regulatory_sources WHERE authority = 'Federal' AND reference_code = 'FFPSA')
INSERT INTO regulatory_sources (authority, reference_code, title, description, status)
VALUES ('Federal', 'FFPSA', 'Family First Prevention Services Act (FFPSA)',
    'Federal requirements for prevention services, Qualified Residential Treatment Programs (QRTPs), QRTP assessment and judicial review, and congregate care limitations.',
    'active');

PRINT 'Regulatory sources seeded.';
GO

-- ============================================================================
-- 2. APPROVAL CHAIN TEMPLATES
--    Default approval workflows by document category.
--    Roles reference Pulse roles — adjust role names to match your system.
-- ============================================================================

PRINT 'Seeding approval chain templates...';

-- Policies and procedures: compliance officer -> executive director
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Policy Standard Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Policy Standard Review', 'policy', 'all',
    '[{"order":1,"role":"compliance-officer","label":"Compliance Officer Review"},{"order":2,"role":"executive-director","label":"Executive Director Approval"}]',
    0);

-- Regulatory references: compliance officer only (informational — no content authored by Refuge House)
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Regulatory Reference Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Regulatory Reference Review', 'regulatory', 'all',
    '[{"order":1,"role":"compliance-officer","label":"Compliance Officer Verification"}]',
    0);

-- Treatment models/frameworks: clinical director -> executive director
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Treatment Model Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Treatment Model Review', 'treatment-model', 'all',
    '[{"order":1,"role":"clinical-director","label":"Clinical Director Review"},{"order":2,"role":"executive-director","label":"Executive Director Approval"}]',
    0);

-- CQI models: CQI coordinator -> compliance officer
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'CQI Model Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('CQI Model Review', 'cqi', 'all',
    '[{"order":1,"role":"cqi-coordinator","label":"CQI Coordinator Review"},{"order":2,"role":"compliance-officer","label":"Compliance Officer Approval"}]',
    0);

-- Operational documents: program director -> compliance officer
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Operational Document Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Operational Document Review', 'operational', 'all',
    '[{"order":1,"role":"program-director","label":"Program Director Review"},{"order":2,"role":"compliance-officer","label":"Compliance Officer Approval"}]',
    0);

-- Training materials: training coordinator -> compliance officer
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Training Material Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Training Material Review', 'training', 'all',
    '[{"order":1,"role":"training-coordinator","label":"Training Coordinator Review"},{"order":2,"role":"compliance-officer","label":"Compliance Officer Approval"}]',
    0);

-- Templates and guides: compliance officer single review
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Template/Guide Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Template/Guide Review', 'template', 'all',
    '[{"order":1,"role":"compliance-officer","label":"Compliance Officer Review"}]',
    0);

IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Guide Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Guide Review', 'guide', 'all',
    '[{"order":1,"role":"compliance-officer","label":"Compliance Officer Review"}]',
    0);

-- Default fallback: compliance officer only
IF NOT EXISTS (SELECT 1 FROM approval_chain_templates WHERE name = 'Default Review')
INSERT INTO approval_chain_templates (name, category, content_type, chain_definition, is_default)
VALUES ('Default Review', 'all', 'all',
    '[{"order":1,"role":"compliance-officer","label":"Compliance Officer Review"}]',
    1);

PRINT 'Approval chain templates seeded.';
GO

-- ============================================================================
-- 3. VERIFICATION QUERIES
--    Run these after seeding to confirm everything looks right.
-- ============================================================================

PRINT '';
PRINT '============================================================================';
PRINT 'SEED VERIFICATION';
PRINT '============================================================================';

SELECT 'regulatory_sources' AS [Table], COUNT(*) AS [Rows] FROM regulatory_sources
UNION ALL
SELECT 'approval_chain_templates', COUNT(*) FROM approval_chain_templates
UNION ALL
SELECT 'compliance_documents', COUNT(*) FROM compliance_documents
UNION ALL
SELECT 'compliance_reviews', COUNT(*) FROM compliance_reviews
UNION ALL
SELECT 'compliance_review_approvals', COUNT(*) FROM compliance_review_approvals
UNION ALL
SELECT 'compliance_review_history', COUNT(*) FROM compliance_review_history
UNION ALL
SELECT 'compliance_reminders', COUNT(*) FROM compliance_reminders
UNION ALL
SELECT 'document_regulatory_mappings', COUNT(*) FROM document_regulatory_mappings
UNION ALL
SELECT 'document_dependencies', COUNT(*) FROM document_dependencies;

PRINT '';
PRINT 'Regulatory sources by authority:';
SELECT authority, COUNT(*) AS [Count] FROM regulatory_sources GROUP BY authority ORDER BY authority;

PRINT '';
PRINT 'Approval chain templates:';
SELECT name, category, content_type, is_default FROM approval_chain_templates ORDER BY is_default DESC, category;

PRINT '';
PRINT '============================================================================';
PRINT 'Seeding complete. All tables ready.';
PRINT '============================================================================';
GO
