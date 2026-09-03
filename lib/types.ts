export type CustomerStatus =
  | 'fresh'
  | 'working'
  | 'aging_45_90'
  | 'aging_90_plus'
  | 'invalid'
  | 'disputed'
  | 'dnc'
  | 'sold'
  | 'lost'
  | 'archived';

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  marital_status: string | null;
  military: number;
  military_branch: string | null;
  coverage_wanted: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  timezone: string | null;
  ad_type: string | null;
  platform: string | null;
  lead_vendor_id: string | null;
  best_time: string | null;
  lead_cost: number;
  trusted_form_url: string | null;
  last_followed_up_at: string | null;
  was_import_duplicate: number;
  duplicate_of_customer_id: string | null;
  retry_after: string | null;
  status: CustomerStatus;
  purchased_at: string;
  lead_date: string;
  sold_at: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface NoteVersion {
  id: string;
  customer_id: string;
  label: string;
  name: string | null;
  note_date: string | null;
  phone: string | null;
  beneficiary: string | null;
  beneficiary_dob: string | null;
  budget: string | null;
  health: string | null;
  discount: string | null;
  bank_name: string | null;
  bank_state: string | null;
  routing_number: string | null;
  account_number: string | null;
  mailing_address: string | null;
  email: string | null;
  born_in: string | null;
  ssn: string | null;
  plan_bronze_coverage: string | null;
  plan_bronze_price: string | null;
  plan_silver_coverage: string | null;
  plan_silver_price: string | null;
  plan_gold_coverage: string | null;
  plan_gold_price: string | null;
  selected_plan: string | null;
  draft_date: string | null;
  code_word: string | null;
  free_text: string | null;
  created_at: string;
  created_by: string;
}

export interface CallRecord {
  id: string;
  customer_id: string;
  direction: string;
  attempt_number: number;
  outcome: string;
  disposition: string | null;
  duration_seconds: number;
  notes: string | null;
  occurred_at: string;
}

export interface Policy {
  id: string;
  customer_id: string;
  application_id: string | null;
  carrier: string;
  product: string | null;
  policy_type: string | null;
  face_amount: number | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  effective_date: string | null;
  policy_number: string | null;
  agent: string | null;
  status: string;
  created_at: string;
}

export interface Commission {
  id: string;
  policy_id: string;
  customer_id: string;
  commission_pct: number | null;
  expected_commission: number | null;
  commission_type: string;
  expected_pay_date: string | null;
  actual_pay_date: string | null;
  chargeback: number;
  net_commission: number | null;
  status: string;
  created_at: string;
}

export interface LeadVendor {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export interface Carrier {
  id: string;
  name: string;
  agent_portal_url: string | null;
  application_url: string | null;
  claims_url: string | null;
  support_phone: string | null;
  notes: string | null;
  sort_order: number;
}

export interface CarrierRule {
  id: string;
  carrier_id: string;
  keywords: string;
  tier_note: string | null;
  priority: number;
  is_knockout: number;
  created_at: string;
}

export interface QuickLink {
  id: string;
  category: string;
  label: string;
  url: string;
  sort_order: number;
}

export interface DuplicateLead {
  id: string;
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  dob: string | null;
  state: string | null;
  raw_data: string;
  source: string | null;
  created_at: string;
}

export interface DailyGoal {
  date: string;
  target_dials: number | null;
  target_appointments: number | null;
  target_ap: number | null;
  created_at: string;
}

export interface WeeklyGoal {
  week_start: string;
  target_dials: number | null;
  target_appointments: number | null;
  target_ap: number | null;
  created_at: string;
}

export interface RoutingEntry {
  id: string;
  bank_name: string;
  state: string;
  routing_number: string;
  institution_type: string;
  source_note: string | null;
}
