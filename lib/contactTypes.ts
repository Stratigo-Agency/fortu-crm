// Types for Kontak and Perusahaan, shared by server and client (no database code).

export type ContactSort = "last_new" | "last_old" | "first_new" | "name";
export const CONTACT_SORTS: readonly ContactSort[] = ["last_new", "last_old", "first_new", "name"];
export type CompanySort = "name" | "pipeline" | "won";
export const COMPANY_SORTS: readonly CompanySort[] = ["name", "pipeline", "won"];

export const ACTIVITY_TYPES = ["whatsapp", "call", "meeting", "visit", "email", "note"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const INDUSTRIES = [
  "hotel", "hospital", "apartment", "education", "government", "corporate", "retail_fnb", "automotive", "media", "partner", "other",
] as const;

export type ContactRow = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  phone_e164: string;
  company_name: string | null;
  source_channel: string | null;
  owner_name: string | null;
  first_chat_at: Date;
  last_chat_at: Date;
  open_deals: number;
  needs_followup: boolean;
  followup_days: number;
};

export type CompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  owner_name: string | null;
  contact_count: number;
  open_deals: number;
  pipeline: string;
  total_done: string;
  last_chat_at: Date | null;
};

export type TimelineItem = {
  id: string;
  kind: "activity" | "lead";
  type: ActivityType | "lead";
  at: string;
  by: string | null;
  text: string | null;
};

export type DealSummary = { id: string; name: string; stageKey: string; amount: string };

export type ContactDetail = {
  id: string | null;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  companyName: string;
  ownerName: string | null;
  canEdit: boolean;
  lastChatAt: string | null;
  needsFollowup: boolean;
  timeline: TimelineItem[];
  deals: DealSummary[];
};

export type CompanyDetail = {
  id: string | null;
  name: string;
  industry: string;
  city: string;
  website: string;
  ownerName: string | null;
  canEdit: boolean;
  contacts: { id: string; name: string | null; phone: string; jobTitle: string | null }[];
  deals: DealSummary[];
};
