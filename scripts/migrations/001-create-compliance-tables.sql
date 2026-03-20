-- ============================================================================
-- RadiusCompliance Database — Initial Schema
-- Run against: RadiusCompliance database on refugehouse-bifrost-server
--
-- Prerequisites:
--   1. Create the RadiusCompliance database in Azure portal or SSMS:
--      CREATE DATABASE RadiusCompliance;
--   2. Connect to RadiusCompliance in SSMS, then run this script.
--
-- Tables created (9):
--   1. compliance_documents
--   2. regulatory_sources
--   3. document_regulatory_mappings
--   4. document_dependencies
--   5. compliance_reviews
--   6. compliance_review_approvals
--   7. approval_chain_templates
--   8. compliance_review_history
--   9. compliance_reminders
-- ============================================================================

-- ============================================================================
-- 1. compliance_documents
--    Registry of all managed content with review schedule and lifecycle state.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'compliance_documents')
BEGIN
    CREATE TABLE compliance_documents (
        id                    INT IDENTITY(1,1) PRIMARY KEY,
        document_path         NVARCHAR(500) NOT NULL,
        title                 NVARCHAR(300) NOT NULL,
        category              NVARCHAR(50) NOT NULL,  -- policy, regulatory, treatment-model, guide, template, training, operational, cqi, logic-model, general
        content_type          NVARCHAR(50) NULL,       -- policy, procedure, cqi-model, logic-model, service-plan-template, operational-guide, etc.
        service_packages      NVARCHAR(500) NULL,      -- comma-separated (e.g., 'idd-autism,mental-health') or 'all'
        owner_user_id         INT NULL,                -- FK to user in Pulse (not enforced here — cross-system reference)
        review_frequency_days INT NULL,                -- review cycle in days (90, 180, 365)
        next_review_date      DATE NULL,
        last_reviewed_date    DATE NULL,
        last_reviewed_by      INT NULL,                -- FK to user in Pulse
        status                NVARCHAR(30) NOT NULL DEFAULT 'draft',
        effective_date        DATE NULL,
        content_hash          NVARCHAR(64) NULL,       -- SHA256 hash from knowbase content
        version               INT NOT NULL DEFAULT 1,  -- increments when content changes are approved
        superseded_by         INT NULL,                -- FK to compliance_documents.id (replacement doc)
        sunset_reason         NVARCHAR(500) NULL,
        sunset_date           DATE NULL,
        created_at            DATETIME2 NOT NULL DEFAULT GETDATE(),
        updated_at            DATETIME2 NULL,

        CONSTRAINT UQ_compliance_documents_path UNIQUE (document_path),
        CONSTRAINT CK_compliance_documents_status CHECK (
            status IN ('current', 'under-review', 'revision-pending', 'expired', 'draft', 'sunset', 'deprecated', 'archived')
        ),
        CONSTRAINT CK_compliance_documents_category CHECK (
            category IN ('policy', 'regulatory', 'treatment-model', 'guide', 'template', 'training', 'operational', 'cqi', 'logic-model', 'general')
        ),
        CONSTRAINT FK_compliance_documents_superseded_by FOREIGN KEY (superseded_by) REFERENCES compliance_documents(id)
    );

    CREATE INDEX IX_compliance_documents_status ON compliance_documents(status);
    CREATE INDEX IX_compliance_documents_category ON compliance_documents(category);
    CREATE INDEX IX_compliance_documents_next_review ON compliance_documents(next_review_date);
    CREATE INDEX IX_compliance_documents_owner ON compliance_documents(owner_user_id);

    PRINT 'Created table: compliance_documents';
END
ELSE
    PRINT 'Table already exists: compliance_documents';
GO

-- ============================================================================
-- 2. regulatory_sources
--    Registry of regulating entities and their specific regulations.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'regulatory_sources')
BEGIN
    CREATE TABLE regulatory_sources (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        authority       NVARCHAR(100) NOT NULL,   -- DFPS, HHSC, TJJD, CMS, etc.
        reference_code  NVARCHAR(100) NULL,       -- 26 TAC 748.2253, DFPS Min Std 748.535, etc.
        title           NVARCHAR(300) NOT NULL,
        description     NVARCHAR(MAX) NULL,
        source_url      NVARCHAR(500) NULL,       -- link to official regulation text
        effective_date  DATE NULL,
        last_updated    DATE NULL,                -- when the authority last modified this
        status          NVARCHAR(30) NOT NULL DEFAULT 'active',
        knowbase_path   NVARCHAR(500) NULL,       -- path in knowbase repo if stored there
        created_at      DATETIME2 NOT NULL DEFAULT GETDATE(),
        updated_at      DATETIME2 NULL,

        CONSTRAINT CK_regulatory_sources_status CHECK (
            status IN ('active', 'amended', 'repealed', 'proposed')
        )
    );

    CREATE INDEX IX_regulatory_sources_authority ON regulatory_sources(authority);
    CREATE INDEX IX_regulatory_sources_status ON regulatory_sources(status);
    CREATE INDEX IX_regulatory_sources_reference ON regulatory_sources(reference_code);

    PRINT 'Created table: regulatory_sources';
END
ELSE
    PRINT 'Table already exists: regulatory_sources';
GO

-- ============================================================================
-- 3. document_regulatory_mappings
--    Links documents to the regulations they implement. Many-to-many.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'document_regulatory_mappings')
BEGIN
    CREATE TABLE document_regulatory_mappings (
        id                    INT IDENTITY(1,1) PRIMARY KEY,
        document_id           INT NOT NULL,
        regulatory_source_id  INT NOT NULL,
        mapping_type          NVARCHAR(30) NOT NULL DEFAULT 'implements',
        notes                 NVARCHAR(500) NULL,
        created_at            DATETIME2 NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_doc_reg_map_document FOREIGN KEY (document_id) REFERENCES compliance_documents(id),
        CONSTRAINT FK_doc_reg_map_regulation FOREIGN KEY (regulatory_source_id) REFERENCES regulatory_sources(id),
        CONSTRAINT CK_doc_reg_map_type CHECK (
            mapping_type IN ('implements', 'supports', 'references', 'required-by')
        ),
        CONSTRAINT UQ_doc_reg_mapping UNIQUE (document_id, regulatory_source_id, mapping_type)
    );

    CREATE INDEX IX_doc_reg_map_document ON document_regulatory_mappings(document_id);
    CREATE INDEX IX_doc_reg_map_regulation ON document_regulatory_mappings(regulatory_source_id);

    PRINT 'Created table: document_regulatory_mappings';
END
ELSE
    PRINT 'Table already exists: document_regulatory_mappings';
GO

-- ============================================================================
-- 4. document_dependencies
--    Relationships between documents (procedure implements policy, etc.).
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'document_dependencies')
BEGIN
    CREATE TABLE document_dependencies (
        id                     INT IDENTITY(1,1) PRIMARY KEY,
        parent_document_id     INT NOT NULL,        -- the document being depended on
        dependent_document_id  INT NOT NULL,         -- the document that depends on the parent
        dependency_type        NVARCHAR(30) NOT NULL DEFAULT 'references',
        notes                  NVARCHAR(500) NULL,
        created_at             DATETIME2 NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_doc_dep_parent FOREIGN KEY (parent_document_id) REFERENCES compliance_documents(id),
        CONSTRAINT FK_doc_dep_dependent FOREIGN KEY (dependent_document_id) REFERENCES compliance_documents(id),
        CONSTRAINT CK_doc_dep_type CHECK (
            dependency_type IN ('implements', 'measures', 'supplements', 'references', 'derived-from')
        ),
        CONSTRAINT UQ_doc_dependency UNIQUE (parent_document_id, dependent_document_id, dependency_type),
        CONSTRAINT CK_doc_dep_no_self CHECK (parent_document_id != dependent_document_id)
    );

    CREATE INDEX IX_doc_dep_parent ON document_dependencies(parent_document_id);
    CREATE INDEX IX_doc_dep_dependent ON document_dependencies(dependent_document_id);

    PRINT 'Created table: document_dependencies';
END
ELSE
    PRINT 'Table already exists: document_dependencies';
GO

-- ============================================================================
-- 5. compliance_reviews
--    Individual review/approval workflow records, anchored to git versions.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'compliance_reviews')
BEGIN
    CREATE TABLE compliance_reviews (
        id                                INT IDENTITY(1,1) PRIMARY KEY,
        document_id                       INT NOT NULL,
        review_type                       NVARCHAR(30) NOT NULL,
        status                            NVARCHAR(30) NOT NULL DEFAULT 'pending',
        requested_by                      INT NULL,              -- FK to user in Pulse
        requested_at                      DATETIME2 NULL,
        assigned_to                       INT NULL,              -- FK to user in Pulse
        due_date                          DATE NULL,
        completed_at                      DATETIME2 NULL,
        completed_by                      INT NULL,              -- FK to user in Pulse
        decision_notes                    NVARCHAR(MAX) NULL,
        revision_summary                  NVARCHAR(MAX) NULL,
        knowbase_commit_sha               NVARCHAR(40) NULL,     -- git commit SHA at time of review
        content_hash_at_review            NVARCHAR(64) NULL,     -- document hash at time of review
        triggered_by_regulatory_source_id INT NULL,              -- if triggered by regulation change
        triggered_by_document_id          INT NULL,              -- if triggered by parent document change (cascade)
        created_at                        DATETIME2 NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_reviews_document FOREIGN KEY (document_id) REFERENCES compliance_documents(id),
        CONSTRAINT FK_reviews_triggered_reg FOREIGN KEY (triggered_by_regulatory_source_id) REFERENCES regulatory_sources(id),
        CONSTRAINT FK_reviews_triggered_doc FOREIGN KEY (triggered_by_document_id) REFERENCES compliance_documents(id),
        CONSTRAINT CK_reviews_type CHECK (
            review_type IN ('scheduled', 'ad-hoc', 'revision', 'initial', 'regulatory-change', 'content-change-detected', 'relevance-review', 'dependency-cascade')
        ),
        CONSTRAINT CK_reviews_status CHECK (
            status IN ('pending', 'in-progress', 'approved', 'revision-requested', 'rejected', 'recommend-sunset')
        )
    );

    CREATE INDEX IX_reviews_document ON compliance_reviews(document_id);
    CREATE INDEX IX_reviews_status ON compliance_reviews(status);
    CREATE INDEX IX_reviews_assigned ON compliance_reviews(assigned_to);
    CREATE INDEX IX_reviews_due_date ON compliance_reviews(due_date);
    CREATE INDEX IX_reviews_type ON compliance_reviews(review_type);

    PRINT 'Created table: compliance_reviews';
END
ELSE
    PRINT 'Table already exists: compliance_reviews';
GO

-- ============================================================================
-- 6. compliance_review_approvals
--    Multi-step approval chains (reviewer -> supervisor -> director).
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'compliance_review_approvals')
BEGIN
    CREATE TABLE compliance_review_approvals (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        review_id         INT NOT NULL,
        approver_user_id  INT NOT NULL,              -- FK to user in Pulse
        approval_order    INT NOT NULL,              -- sequence: 1, 2, 3...
        status            NVARCHAR(30) NOT NULL DEFAULT 'pending',
        comments          NVARCHAR(MAX) NULL,
        acted_at          DATETIME2 NULL,

        CONSTRAINT FK_approvals_review FOREIGN KEY (review_id) REFERENCES compliance_reviews(id),
        CONSTRAINT CK_approvals_status CHECK (
            status IN ('pending', 'approved', 'revision-requested', 'rejected')
        )
    );

    CREATE INDEX IX_approvals_review ON compliance_review_approvals(review_id);
    CREATE INDEX IX_approvals_user ON compliance_review_approvals(approver_user_id);
    CREATE INDEX IX_approvals_status ON compliance_review_approvals(status);

    PRINT 'Created table: compliance_review_approvals';
END
ELSE
    PRINT 'Table already exists: compliance_review_approvals';
GO

-- ============================================================================
-- 7. approval_chain_templates
--    Default approval chains by category/content type.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'approval_chain_templates')
BEGIN
    CREATE TABLE approval_chain_templates (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        name              NVARCHAR(100) NOT NULL,
        category          NVARCHAR(50) NOT NULL DEFAULT 'all',   -- matches compliance_documents.category or 'all'
        content_type      NVARCHAR(50) NOT NULL DEFAULT 'all',   -- matches compliance_documents.content_type or 'all'
        chain_definition  NVARCHAR(MAX) NOT NULL,                -- JSON array: [{"order":1,"role":"compliance-officer"},...]
        is_default        BIT NOT NULL DEFAULT 0,
        created_at        DATETIME2 NOT NULL DEFAULT GETDATE(),
        updated_at        DATETIME2 NULL
    );

    CREATE INDEX IX_chain_templates_category ON approval_chain_templates(category, content_type);

    PRINT 'Created table: approval_chain_templates';
END
ELSE
    PRINT 'Table already exists: approval_chain_templates';
GO

-- ============================================================================
-- 8. compliance_review_history
--    Immutable audit trail — every state change logged.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'compliance_review_history')
BEGIN
    CREATE TABLE compliance_review_history (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        document_id         INT NOT NULL,
        review_id           INT NULL,                    -- nullable: some actions aren't tied to a review
        action              NVARCHAR(50) NOT NULL,
        performed_by        INT NULL,                    -- FK to user in Pulse (null for system actions)
        details             NVARCHAR(MAX) NULL,          -- JSON blob with context
        knowbase_commit_sha NVARCHAR(40) NULL,
        created_at          DATETIME2 NOT NULL DEFAULT GETDATE(),

        CONSTRAINT FK_history_document FOREIGN KEY (document_id) REFERENCES compliance_documents(id),
        CONSTRAINT FK_history_review FOREIGN KEY (review_id) REFERENCES compliance_reviews(id),
        CONSTRAINT CK_history_action CHECK (
            action IN (
                'review-initiated', 'assigned', 'approved', 'revision-requested', 'rejected',
                'reminder-sent', 'content-changed-detected', 'schedule-changed',
                'sunset-initiated', 'sunset-completed', 'regulatory-change-detected',
                'dependency-cascade-triggered', 'recommend-sunset', 'document-registered',
                'document-updated', 'status-changed'
            )
        )
    );

    CREATE INDEX IX_history_document ON compliance_review_history(document_id);
    CREATE INDEX IX_history_review ON compliance_review_history(review_id);
    CREATE INDEX IX_history_action ON compliance_review_history(action);
    CREATE INDEX IX_history_created ON compliance_review_history(created_at);

    PRINT 'Created table: compliance_review_history';
END
ELSE
    PRINT 'Table already exists: compliance_review_history';
GO

-- ============================================================================
-- 9. compliance_reminders
--    Configurable reminder schedule per document.
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'compliance_reminders')
BEGIN
    CREATE TABLE compliance_reminders (
        id                     INT IDENTITY(1,1) PRIMARY KEY,
        document_id            INT NOT NULL,
        reminder_days_before   INT NOT NULL,             -- days before next_review_date (e.g., 30, 14, 7)
        notify_role            NVARCHAR(50) NOT NULL DEFAULT 'owner',
        last_sent_at           DATETIME2 NULL,
        enabled                BIT NOT NULL DEFAULT 1,

        CONSTRAINT FK_reminders_document FOREIGN KEY (document_id) REFERENCES compliance_documents(id),
        CONSTRAINT CK_reminders_role CHECK (
            notify_role IN ('owner', 'reviewer', 'supervisor', 'all')
        )
    );

    CREATE INDEX IX_reminders_document ON compliance_reminders(document_id);
    CREATE INDEX IX_reminders_enabled ON compliance_reminders(enabled) WHERE enabled = 1;

    PRINT 'Created table: compliance_reminders';
END
ELSE
    PRINT 'Table already exists: compliance_reminders';
GO

PRINT '';
PRINT '============================================================================';
PRINT 'RadiusCompliance schema creation complete — 9 tables created.';
PRINT '============================================================================';
GO
