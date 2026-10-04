import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { cleanName, sanitizeGender, extractDob } from './services/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export interface User {
  id: string;
  email: string;
  phone: string;
  full_name: string | null;
  created_at: string;
  last_login: string | null;
}

export interface OtpCode {
  id: string;
  user_id: string;
  code: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface UserSession {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  upload_status: 'pending' | 'processing' | 'extracted' | 'error';
  uploaded_at: string;
  extracted_at: string | null;
}

export interface DocumentExtraction {
  id: string;
  document_id: string;
  raw_text: string;
  extraction_method: string;
  extracted_at: string;
}

export interface ExtractedFact {
  id: string;
  document_id: string;
  user_id: string;
  category: string;
  field_name: string;
  field_value: string;
  unit: string | null;
  reference_range: string | null;
  status: string;
  flag?: string | null;
  report_date: string | null;
  source_text: string | null;
  extracted_at: string;
}

export interface PatientProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  age: string | null;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string | null;
  address: string | null;
  emergency_contact: string | null;
  updated_at: string;
}

export interface MedicalSummary {
  id: string;
  user_id: string;
  title: string;
  summary_type: string;
  content: string;
  generated_at: string;
  document_ids: string[];
}

export interface SymptomReport {
  id: string;
  user_id: string;
  primary_symptom: string;
  duration: string;
  severity: number;
  associated_symptoms: string[];
  notes: string;
  assessment: {
    probable_problem: string;
    urgency: string;
    explanation: string;
    red_flags: string[];
    recommended_actions: string[];
  };
  created_at: string;
}

export interface QAConversation {
  id: string;
  user_id: string;
  question: string;
  answer: string;
  created_at: string;
}

class PersistentStore {
  users = new Map<string, User>();
  userByEmail = new Map<string, string>();
  otpCodes = new Map<string, OtpCode>();
  sessions = new Map<string, UserSession>();
  documents = new Map<string, DocumentRecord>();
  extractions = new Map<string, DocumentExtraction>();
  facts = new Map<string, ExtractedFact>();
  patientProfiles = new Map<string, PatientProfile>();
  summaries = new Map<string, MedicalSummary>();
  qaConversations = new Map<string, QAConversation>();
  symptomReports = new Map<string, SymptomReport>();

  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDataDir();
    this.loadFromDisk();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.users) {
          data.users.forEach((u: User) => {
            if (u.full_name) u.full_name = cleanName(u.full_name) || u.full_name;
            this.users.set(u.id, u);
            this.userByEmail.set(u.email, u.id);
          });
        }
        if (data.otpCodes) data.otpCodes.forEach((o: OtpCode) => this.otpCodes.set(o.id, o));
        if (data.sessions) data.sessions.forEach((s: UserSession) => this.sessions.set(s.token, s));
        if (data.documents) data.documents.forEach((d: DocumentRecord) => this.documents.set(d.id, d));
        if (data.extractions) data.extractions.forEach((e: DocumentExtraction) => this.extractions.set(e.id, e));
        if (data.facts) data.facts.forEach((f: ExtractedFact) => this.facts.set(f.id, f));
        if (data.patientProfiles) {
          data.patientProfiles.forEach((p: PatientProfile) => {
            if (p.full_name) p.full_name = cleanName(p.full_name) || p.full_name;
            p.gender = sanitizeGender(p.gender);
            if (p.age && (!p.gender || p.gender === '21')) {
              p.gender = 'Male';
            }
            if (p.age && (!p.date_of_birth || p.date_of_birth === 'null' || !p.date_of_birth.trim())) {
              p.date_of_birth = extractDob('', p.age);
            }
            this.patientProfiles.set(p.user_id, p);

            const user = this.users.get(p.user_id);
            if (user && p.full_name) {
              user.full_name = p.full_name;
            }
          });
        }
        if (data.summaries) data.summaries.forEach((s: MedicalSummary) => this.summaries.set(s.id, s));
        if (data.qaConversations) data.qaConversations.forEach((q: QAConversation) => this.qaConversations.set(q.id, q));
        if (data.symptomReports) data.symptomReports.forEach((sr: SymptomReport) => this.symptomReports.set(sr.id, sr));
      }
    } catch (err) {
      console.warn('Failed to load database from disk, starting fresh:', err);
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk();
    }, 150);
  }

  public saveToDisk() {
    try {
      this.ensureDataDir();
      const payload = {
        users: Array.from(this.users.values()),
        otpCodes: Array.from(this.otpCodes.values()),
        sessions: Array.from(this.sessions.values()),
        documents: Array.from(this.documents.values()),
        extractions: Array.from(this.extractions.values()),
        facts: Array.from(this.facts.values()),
        patientProfiles: Array.from(this.patientProfiles.values()),
        summaries: Array.from(this.summaries.values()),
        qaConversations: Array.from(this.qaConversations.values()),
        symptomReports: Array.from(this.symptomReports.values()),
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving store to disk:', err);
    }
  }

  findOrCreateUser(email: string, phone: string): User {
    const normalizedEmail = email.trim().toLowerCase();
    const existingId = this.userByEmail.get(normalizedEmail);
    if (existingId && this.users.has(existingId)) {
      const user = this.users.get(existingId)!;
      user.phone = phone.trim();
      this.scheduleSave();
      return user;
    }
    const id = uuidv4();
    const user: User = {
      id,
      email: normalizedEmail,
      phone: phone.trim(),
      full_name: null,
      created_at: new Date().toISOString(),
      last_login: null,
    };
    this.users.set(id, user);
    this.userByEmail.set(normalizedEmail, id);
    this.scheduleSave();
    return user;
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  createOtp(userId: string, code: string, expiryMinutes = 10): OtpCode {
    for (const otp of this.otpCodes.values()) {
      if (otp.user_id === userId && !otp.used) {
        otp.used = true;
      }
    }
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    const otp: OtpCode = {
      id,
      user_id: userId,
      code,
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    };
    this.otpCodes.set(id, otp);
    this.scheduleSave();
    return otp;
  }

  verifyOtp(userId: string, code: string): boolean {
    const now = new Date().toISOString();
    for (const otp of this.otpCodes.values()) {
      if (
        otp.user_id === userId &&
        otp.code === code &&
        !otp.used &&
        otp.expires_at > now
      ) {
        otp.used = true;
        const user = this.users.get(userId);
        if (user) {
          user.last_login = now;
        }
        this.scheduleSave();
        return true;
      }
    }
    return false;
  }

  createSession(userId: string, expiryHours = 24): string {
    const id = uuidv4();
    const token = uuidv4() + uuidv4();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    const session: UserSession = {
      id,
      user_id: userId,
      token,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
    this.sessions.set(token, session);
    this.scheduleSave();
    return token;
  }

  getSession(token: string): { user: User; session: UserSession } | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (new Date(session.expires_at) <= new Date()) {
      this.sessions.delete(token);
      this.scheduleSave();
      return null;
    }
    const user = this.users.get(session.user_id);
    if (!user) return null;
    return { user, session };
  }

  deleteSession(token: string): void {
    this.sessions.delete(token);
    this.scheduleSave();
  }

  addDocument(doc: DocumentRecord): void {
    this.documents.set(doc.id, doc);
    this.scheduleSave();
  }

  getDocument(id: string): DocumentRecord | undefined {
    return this.documents.get(id);
  }

  listDocuments(userId: string): DocumentRecord[] {
    return Array.from(this.documents.values())
      .filter((d) => d.user_id === userId)
      .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  }

  deleteDocument(id: string, userId: string): boolean {
    const doc = this.documents.get(id);
    if (!doc || doc.user_id !== userId) return false;
    this.documents.delete(id);
    for (const [factId, fact] of this.facts.entries()) {
      if (fact.document_id === id) {
        this.facts.delete(factId);
      }
    }
    this.scheduleSave();
    return true;
  }

  addFact(fact: Omit<ExtractedFact, 'id' | 'extracted_at'>): ExtractedFact {
    const id = uuidv4();
    const record: ExtractedFact = {
      ...fact,
      id,
      extracted_at: new Date().toISOString(),
    };
    this.facts.set(id, record);
    this.scheduleSave();
    return record;
  }

  getFactsForUser(userId: string): ExtractedFact[] {
    return Array.from(this.facts.values())
      .filter((f) => f.user_id === userId)
      .sort((a, b) => {
        if (a.report_date && b.report_date) {
          return a.report_date.localeCompare(b.report_date);
        }
        return a.extracted_at.localeCompare(b.extracted_at);
      });
  }

  upsertProfile(userId: string, profileData: Partial<PatientProfile>): PatientProfile {
    let profile = this.patientProfiles.get(userId);

    const cleanFullName = cleanName(profileData.full_name || null);
    const validGender = sanitizeGender(profileData.gender);
    const validAge = profileData.age || null;
    let validDob = profileData.date_of_birth || null;
    if ((!validDob || validDob.toLowerCase() === 'null') && validAge) {
      validDob = extractDob('', validAge);
    }

    if (!profile) {
      profile = {
        id: uuidv4(),
        user_id: userId,
        full_name: cleanFullName,
        age: validAge,
        date_of_birth: validDob,
        gender: validGender,
        blood_group: profileData.blood_group || null,
        address: profileData.address || null,
        emergency_contact: profileData.emergency_contact || null,
        updated_at: new Date().toISOString(),
      };
      this.patientProfiles.set(userId, profile);
    } else {
      if (cleanFullName) profile.full_name = cleanFullName;
      if (validAge) profile.age = validAge;
      if (validDob) profile.date_of_birth = validDob;
      if (validGender) profile.gender = validGender;
      else if (profile.gender === '21') profile.gender = null;
      if (profileData.blood_group) profile.blood_group = profileData.blood_group;
      if (profileData.address) profile.address = profileData.address;
      profile.updated_at = new Date().toISOString();
    }
    if (profile.full_name) {
      const user = this.users.get(userId);
      if (user) {
        user.full_name = profile.full_name;
      }
    }
    this.scheduleSave();
    return profile;
  }

  getProfile(userId: string): PatientProfile | null {
    return this.patientProfiles.get(userId) || null;
  }

  getFactsForDocument(docId: string): ExtractedFact[] {
    return Array.from(this.facts.values())
      .filter((f) => f.document_id === docId);
  }

  saveSummary(userId: string, type: string, content: string, title: string, documentIds: string[]): MedicalSummary {
    const id = uuidv4();
    const summary: MedicalSummary = {
      id,
      user_id: userId,
      title: title || 'Medical Summary Report',
      summary_type: type,
      content,
      generated_at: new Date().toISOString(),
      document_ids: documentIds,
    };
    this.summaries.set(id, summary);
    this.scheduleSave();
    return summary;
  }

  getLatestSummary(userId: string, type?: string): MedicalSummary | null {
    const userSummaries = Array.from(this.summaries.values())
      .filter((s) => s.user_id === userId && (!type || s.summary_type === type))
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
    return userSummaries[0] || null;
  }

  listSummaries(userId: string): MedicalSummary[] {
    return Array.from(this.summaries.values())
      .filter((s) => s.user_id === userId)
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
  }

  saveSymptomReport(userId: string, data: Omit<SymptomReport, 'id' | 'user_id' | 'created_at'>): SymptomReport {
    const id = uuidv4();
    const report: SymptomReport = {
      id,
      user_id: userId,
      ...data,
      created_at: new Date().toISOString(),
    };
    this.symptomReports.set(id, report);
    this.scheduleSave();
    return report;
  }

  getSymptomReports(userId: string): SymptomReport[] {
    return Array.from(this.symptomReports.values())
      .filter((s) => s.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getLatestSymptomReport(userId: string): SymptomReport | null {
    const reports = this.getSymptomReports(userId);
    return reports[0] || null;
  }

  addQA(userId: string, question: string, answer: string): QAConversation {
    const id = uuidv4();
    const conv: QAConversation = {
      id,
      user_id: userId,
      question,
      answer,
      created_at: new Date().toISOString(),
    };
    this.qaConversations.set(id, conv);
    this.scheduleSave();
    return conv;
  }

  getQAHistory(userId: string, limit = 50): QAConversation[] {
    return Array.from(this.qaConversations.values())
      .filter((q) => q.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  clearQAHistory(userId: string): void {
    for (const [id, q] of this.qaConversations.entries()) {
      if (q.user_id === userId) {
        this.qaConversations.delete(id);
      }
    }
    this.scheduleSave();
  }

  getPatientData(userId: string) {
    const profile = this.getProfile(userId) || {};
    const facts = this.getFactsForUser(userId);
    const docs = this.listDocuments(userId);

    const categorized: Record<string, ExtractedFact[]> = {};
    for (const f of facts) {
      if (!categorized[f.category]) categorized[f.category] = [];
      categorized[f.category].push(f);
    }

    return {
      profile,
      lab_results: categorized['lab_result'] || [],
      diagnoses: categorized['diagnosis'] || [],
      medications: categorized['medication'] || [],
      vital_signs: categorized['vital_sign'] || [],
      allergies: categorized['allergy'] || [],
      procedures: categorized['procedure'] || [],
      symptoms: categorized['symptom'] || [],
      symptom_reports: this.getSymptomReports(userId),
      documents: docs.map((d) => ({
        id: d.id,
        original_filename: d.original_filename,
        file_type: d.file_type,
        uploaded_at: d.uploaded_at,
      })),
    };
  }
}

export const store = new PersistentStore();
