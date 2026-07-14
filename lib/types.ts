export interface ContactLog {
  id: string;
  date: string;
  type: string;
  staff: string;
  content: string;
}

export interface HospitalRecord {
  status: string;
  name: string;
  family_inquiry_date: string | null;
  visit_date: string | null;
  referral_inquiry_date: string | null;
  medical_info_received_date: string | null;
  admission_response_date: string | null;
  family_meeting_booking_date: string | null;
  meeting_date: string | null;
  admission_application_date: string | null;
  admission_date: string | null;
  referral_route: string;
  referral_source: string;
  referral_source_2: string;
  pre_admission_location: string;
  kp_address: string;
  cancel_reason: string;
  not_admitted_reason: string;
  notes: string;
  // 定性情報
  disease?: string;
  medical_needs?: string;
  selection_reason?: string;
  family_situation?: string;
  key_concerns?: string;
  // コンタクト履歴
  contact_logs?: ContactLog[];
}

export interface DailyAdmission {
  date: string;
  label: string;
  count: number;
}

export type MonthlyAdmission = DailyAdmission;

export interface SourceCV {
  source: string;
  totalContacts: number;
  admissions: number;
  cvr: number;
}

export interface FunnelStep {
  name: string;
  count: number;
}
