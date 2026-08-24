export type Presence = "available" | "busy" | "do_not_disturb" | "offline";

export interface Person {
  id: string;
  name: string;
  initials: string;
  title: string;
  presence: Presence;
  isAdmin?: boolean;
  location?: {
    kind: "office" | "common_room";
    officeOwnerId: string | null;
    label: string;
    occupants: string[];
  };
}

export interface MeetingRequest {
  id: string;
  from: Person;
  to: Person;
  message?: string;
  createdAt: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
}

export interface ActionItem {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingOccurredAt: string | null;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  confidence: number | null;
  status: "proposed" | "accepted" | "dismissed" | "complete";
}

export interface MeetingSummary {
  id: string;
  title: string;
  occurredAt: string;
  durationMinutes: number;
  participants: Person[];
  summary: string;
  processingStatus: string;
  processingError: string | null;
  actionItemCount: number;
  actionItems: ActionItem[];
}
