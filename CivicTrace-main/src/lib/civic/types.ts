export type EntityKind = "asset" | "bwg";

export type StatusLevel =
  "normal" | "pending" | "attention" | "priority" | "verification" | "maintenance";

export type EventType =
  | "collection"
  | "report"
  | "inspection"
  | "maintenance"
  | "replacement"
  | "compliance"
  | "verification"
  | "installation"
  /** Any event_type stored in Supabase that this UI does not model yet. */
  | "other";

/** Citizen-report issue vocabulary (values are free text in Supabase). */
export type IssueType = string;

export type VerificationStatus = "unverified" | "attention" | "priority" | "verified" | "dismissed";

export interface CivicEvent {
  id: string;
  entityId: string;
  type: EventType;
  /** The raw `event_type` stored in Supabase (shown when the type is not modelled). */
  rawType: string;
  /** ISO timestamp (Supabase `created_at`). */
  timestamp: string;
  actor: string;
  title: string;
  detail?: string | undefined;
  location?: string | undefined;
  issueType?: IssueType | undefined;
  hasPhoto?: boolean | undefined;
  /** Public URL of the stored evidence photo, when one exists. */
  photoUrl?: string | null | undefined;
  verification?: VerificationStatus | undefined;
  /** True for records this dashboard writes back to Supabase (verification / resolution). */
  isResolution?: boolean | undefined;
  /** How a verification / inspection record settled the case. */
  resolution?: "scheduled" | "verified" | "dismissed" | undefined;
  /** True for records from the illustrative Ward 142 modelled dataset. */
  isSeeded?: boolean | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  accuracy?: number | null | undefined;
  source?: string | null | undefined;
  environment?: string | null | undefined;
  /** Raw Supabase `status` value. */
  status?: string | null | undefined;
  /** Raw Supabase `audit_result` value. */
  auditResult?: string | null | undefined;
}

export interface BaseEntity {
  id: string;
  kind: EntityKind;
  /** `entity_type` as stored in the shared Supabase table. */
  entityType: string;
  /** Not present in the shared schema — optional so the UI can show "Not recorded". */
  name?: string | undefined;
  servicePoint: string;
  ward: string;
  active: boolean;
  /**
   * Coordinates are only ever populated from a stored GPS fix on one of the
   * entity's events. Entities with no recorded fix stay `null` — the UI must
   * never invent a position.
   */
  lat?: number | null;
  lng?: number | null;
  coordinatesFrom?: { eventId: string; recordedAt: string; accuracy: number | null } | null;
  installedOn?: string | undefined;
  /** At least one recorded event on this entity comes from the modelled dataset. */
  isSeeded?: boolean | undefined;
}

export interface AssetEntity extends BaseEntity {
  kind: "asset";
  /** Not present in the shared schema. */
  capacityLitres?: number | undefined;
  /** Not present in the shared schema. */
  expectedCollectionTime?: string | undefined;
  /** Derived from recorded repair / maintenance events. */
  maintenanceRequired: boolean;
  /** Derived: reports of the same issue recorded before today. */
  historicalSimilarIncidents: number;
  /** Real counts of recorded events for this entity. */
  lifetime: {
    collections: number;
    reports: number;
    repairs: number;
    maintenance: number;
  };
  replacedById?: string | undefined;
  replacesId?: string | undefined;
  replacementReason?: string | undefined;
  replacementDate?: string | undefined;
}

export interface BwgEntity extends BaseEntity {
  kind: "bwg";
  /** Not present in the shared schema. */
  bwgType?: string | undefined;
  /** Derived: a verification or inspection event with a clean audit result exists. */
  registrationVerified: boolean;
  /** Not present in the shared schema. */
  segregationStreams?: number | undefined;
  /** Not present in the shared schema. */
  collectionFrequency?: string | undefined;
  /** Not present in the shared schema. */
  authorisedHandler?: string | undefined;
  /** Derived from recorded compliance events. */
  segregationIssues: number;
  /** Derived from the latest recorded inspection. */
  inspectionIssue: boolean;
}

export type CivicEntity = AssetEntity | BwgEntity;

export type FlagSeverity = "priority" | "attention" | "verification" | "maintenance";

export interface Flag {
  id: string;
  entityId: string;
  title: string;
  ruleId: string;
  ruleName: string;
  severity: FlagSeverity;
  evidence: string[];
  historicalSimilarIncidents?: number;
  suggestedReview: string;
  detectedAt: string;
}

export interface VerificationRecord {
  id: string;
  entityId: string;
  flagTitle: string;
  outcome: "scheduled" | "verified" | "dismissed";
  note: string;
  createdAt: string;
  actor: string;
}

export interface CivicNotification {
  id: string;
  message: string;
  entityId: string;
  createdAt: string;
  severity: FlagSeverity | "info";
}
