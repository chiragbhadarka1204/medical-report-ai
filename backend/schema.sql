-- Medical Report AI - PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- OTP table
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Documents table — stores uploaded files metadata
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    original_filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size_bytes BIGINT,
    upload_status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, extracted, error
    uploaded_at TIMESTAMP DEFAULT NOW(),
    extracted_at TIMESTAMP
);

-- Raw extracted text per document — never modified after creation
CREATE TABLE IF NOT EXISTS document_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    raw_text TEXT,
    extraction_method VARCHAR(100),
    extracted_at TIMESTAMP DEFAULT NOW()
);

-- Structured facts extracted from documents
-- Each row = one discrete data point extracted from a document
CREATE TABLE IF NOT EXISTS extracted_facts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(100),           -- e.g. lab_result, diagnosis, medication, vital_sign, allergy, procedure, symptom
    field_name VARCHAR(255),         -- e.g. Hemoglobin, Blood Pressure, Metformin
    field_value TEXT,                -- e.g. 10.2, 120/80, 500mg
    unit VARCHAR(100),               -- e.g. g/dL, mmHg, mg
    reference_range VARCHAR(255),    -- e.g. 12-16 g/dL
    status VARCHAR(50) DEFAULT 'found',  -- found, not_found
    report_date DATE,                -- date from the document
    source_text TEXT,                -- verbatim snippet from doc that produced this fact
    extracted_at TIMESTAMP DEFAULT NOW()
);

-- Patient profile — aggregated demographic info from documents
CREATE TABLE IF NOT EXISTS patient_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    date_of_birth DATE,
    gender VARCHAR(50),
    blood_group VARCHAR(20),
    address TEXT,
    emergency_contact VARCHAR(255),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- AI-generated summaries
CREATE TABLE IF NOT EXISTS medical_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    summary_type VARCHAR(50),        -- full, medication, timeline, analysis
    content TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT NOW(),
    document_ids UUID[]              -- which documents were included
);

-- Q&A conversation history
CREATE TABLE IF NOT EXISTS qa_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(512) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_user ON extracted_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_document ON extracted_facts(document_id);
CREATE INDEX IF NOT EXISTS idx_facts_category ON extracted_facts(category);
CREATE INDEX IF NOT EXISTS idx_summaries_user ON medical_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_user ON qa_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_codes(user_id);
