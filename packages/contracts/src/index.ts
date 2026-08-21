export type Presence = "available" | "busy" | "do_not_disturb" | "offline";

export interface Person {
  id: string;
  name: string;
  initials: string;
  title: string;
  presence: Presence;
}

export interface MeetingRequest {
  id: string;
  from: Person;
  to: Person;
  message?: string;
  createdAt: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
}

export interface MeetingSummary {
  id: string;
  title: string;
  occurredAt: string;
  durationMinutes: number;
  participants: Person[];
  summary: string;
  actionItemCount: number;
}
