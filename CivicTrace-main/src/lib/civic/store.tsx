import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { CURRENT_OFFICIAL } from "./identity";
import {
  appendEvent,
  fetchSharedData,
  subscribeToSharedChanges,
  type RealtimeStatus,
  type SharedData,
  type WriteResult,
} from "./repo";
import { AUDIT_RESULTS, EVENT_STATUS } from "./schema";
import { detectClusters, detectFlags, deriveStatus, isToday, type Cluster } from "./rules";
import type {
  CivicEntity,
  CivicEvent,
  CivicNotification,
  Flag,
  IssueType,
  StatusLevel,
  VerificationRecord,
} from "./types";

const READ_NOTIFICATIONS_KEY = "civictrace.read-notifications.v1";

interface CivicContextValue {
  /* data */
  entities: CivicEntity[];
  events: CivicEvent[];
  flags: Flag[];
  clusters: Cluster[];
  verifications: VerificationRecord[];
  notifications: CivicNotification[];
  unreadCount: number;
  ward: string;
  wards: string[];
  official: typeof CURRENT_OFFICIAL;
  totals: {
    assets: number;
    bwgs: number;
    collections: number;
    reports: number;
    flags: number;
  };
  /* load state */
  status: "loading" | "ready" | "error";
  error: string | null;
  refresh: () => void;
  lastUpdated: string | null;
  realtimeStatus: RealtimeStatus;
  realtimeDetail: string | null;
  /** Illustrative Ward 142 modelled rows included in the live figures. */
  seededRows: number;
  /** Integration-test rows held out of the live figures. */
  excludedTestRows: number;
  includeTestRows: boolean;
  setIncludeTestRows: (include: boolean) => void;
  /* selectors */
  setWard: (ward: string) => void;
  getEntity: (id: string) => CivicEntity | undefined;
  statusOf: (id: string) => StatusLevel;
  flagsFor: (id: string) => Flag[];
  issueTypes: string[];
  /* writes — each resolves only after Supabase confirms the record */
  recordCollection: (input: {
    entityId: string;
    worker: string;
    vehicle: string;
    route: string;
    position?: { latitude: number; longitude: number; accuracy?: number | null } | null;
  }) => Promise<WriteResult>;
  submitReport: (input: {
    entityId: string;
    issueType: IssueType;
    note?: string | undefined;
    position?: { latitude: number; longitude: number; accuracy?: number | null } | null;
  }) => Promise<WriteResult>;
  recordVerification: (input: {
    entityId: string;
    flagTitle: string;
    outcome: VerificationRecord["outcome"];
    note: string;
  }) => Promise<WriteResult>;
  dismissFlag: (flagId: string) => Promise<WriteResult>;
  markNotificationsRead: () => void;
}

const CivicContext = createContext<CivicContextValue | null>(null);

const EMPTY: SharedData = {
  entities: [],
  events: [],
  seededRows: 0,
  excludedTestRows: 0,
  fetchedAt: "",
};

export function CivicProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ward, setWard] = useState<string>(CURRENT_OFFICIAL.ward);
  const [includeTestRows, setIncludeTestRows] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [realtimeDetail, setRealtimeDetail] = useState<string | null>(null);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(READ_NOTIFICATIONS_KEY);
      if (raw) setReadNotificationIds(JSON.parse(raw) as string[]);
    } catch {
      /* ignore unreadable local preferences */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(readNotificationIds));
    } catch {
      /* storage unavailable — preferences stay in memory */
    }
  }, [hydrated, readNotificationIds]);

  /* ---------------- live data ---------------- */
  const query = useQuery({
    queryKey: ["shared-data", includeTestRows],
    queryFn: () => fetchSharedData({ includeTestRows }),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Realtime postgres_changes is not enabled on the shared tables, so an
    // interval refetch keeps both websites in step. It keeps running even while
    // the tab is in the background, and never stops completely — a live
    // subscription only slows it down. Guards against silent staleness.
    refetchInterval: realtimeStatus === "subscribed" ? 60_000 : 20_000,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["shared-data"] });
  }, [queryClient]);

  useEffect(() => {
    return subscribeToSharedChanges({
      onChange: invalidate,
      onStatus: (status, detail) => {
        setRealtimeStatus(status);
        if (detail) setRealtimeDetail(detail);
      },
    });
  }, [invalidate]);

  const data = query.data ?? EMPTY;

  /* ---------------- ward + scope ---------------- */
  const wards = useMemo(() => {
    const found = [...new Set(data.entities.map((e) => e.ward))].filter(Boolean).sort();
    return found.length ? found : [CURRENT_OFFICIAL.ward];
  }, [data.entities]);

  useEffect(() => {
    if (data.entities.length && !wards.includes(ward)) setWard(wards[0] as string);
  }, [data.entities.length, ward, wards]);

  const entities = useMemo(
    () => data.entities.filter((e) => e.ward === ward),
    [data.entities, ward],
  );

  const wardEntityIds = useMemo(() => new Set(entities.map((e) => e.id)), [entities]);

  const events = useMemo(
    () => data.events.filter((e) => wardEntityIds.has(e.entityId)),
    [data.events, wardEntityIds],
  );

  /* ---------------- derived intelligence ---------------- */
  const flags = useMemo(() => detectFlags(entities, events), [entities, events]);
  const clusters = useMemo(() => detectClusters(entities, flags), [entities, flags]);

  /** Verification records reconstructed from the shared event log. */
  const verifications = useMemo<VerificationRecord[]>(
    () =>
      events
        .filter((e) => e.type === "verification" || e.type === "inspection")
        .map((e) => {
          const status = (e.status ?? "").toLowerCase();
          const audit = e.auditResult ?? "";
          const outcome: VerificationRecord["outcome"] =
            status === "dismissed" || audit === AUDIT_RESULTS.ok
              ? "dismissed"
              : status === "scheduled"
                ? "scheduled"
                : "verified";
          return {
            id: e.id,
            entityId: e.entityId,
            flagTitle: e.title,
            outcome,
            note: e.detail ?? e.title,
            createdAt: e.timestamp,
            actor: e.actor,
          };
        })
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [events],
  );

  const statusOf = useCallback(
    (id: string) => {
      const entity = entities.find((e) => e.id === id);
      if (!entity) return "normal" as StatusLevel;
      return deriveStatus(entity, events, flags, verifications);
    },
    [entities, events, flags, verifications],
  );

  const flagsFor = useCallback((id: string) => flags.filter((f) => f.entityId === id), [flags]);

  const notifications = useMemo<CivicNotification[]>(() => {
    const fromFlags = flags.slice(0, 5).map((f) => ({
      id: `flag-${f.id}`,
      entityId: f.entityId,
      severity: f.severity,
      createdAt: f.detectedAt,
      message:
        f.ruleId === "R1"
          ? `${f.entityId} has repeated post-collection overflow reports.`
          : f.ruleId === "R4"
            ? `${f.entityId} requires MCD verification.`
            : f.ruleId === "R2"
              ? `${f.entityId} has an unresolved "not collected" report today.`
              : `${f.entityId} is flagged as a high-maintenance asset.`,
    }));
    const recent = events
      .filter((e) => e.type === "report" || e.type === "collection")
      .slice(0, 3)
      .map((e) => ({
        id: `event-${e.id}`,
        entityId: e.entityId,
        severity: "info" as const,
        createdAt: e.timestamp,
        message: `${e.title} at ${e.location ?? e.entityId}.`,
      }));
    return [...fromFlags, ...recent].sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    );
  }, [flags, events]);

  /* ---------------- writes ---------------- */
  const recordCollection: CivicContextValue["recordCollection"] = useCallback(
    async (input) => {
      const result = await appendEvent({
        entity_id: input.entityId,
        event_type: "collection",
        employee_number: input.worker,
        note: `${input.route} · Vehicle ${input.vehicle}`,
        latitude: input.position?.latitude ?? null,
        longitude: input.position?.longitude ?? null,
        accuracy: input.position?.accuracy ?? null,
      });
      if (result.ok) invalidate();
      return result;
    },
    [invalidate],
  );

  const submitReport: CivicContextValue["submitReport"] = useCallback(
    async (input) => {
      const result = await appendEvent({
        entity_id: input.entityId,
        event_type: "citizen_report",
        status: EVENT_STATUS.unverified,
        issue_type: input.issueType,
        note: input.note?.trim() ? input.note.trim() : null,
        latitude: input.position?.latitude ?? null,
        longitude: input.position?.longitude ?? null,
        accuracy: input.position?.accuracy ?? null,
      });
      if (result.ok) invalidate();
      return result;
    },
    [invalidate],
  );

  const recordVerification: CivicContextValue["recordVerification"] = useCallback(
    async (input) => {
      const status =
        input.outcome === "scheduled"
          ? EVENT_STATUS.scheduled
          : input.outcome === "verified"
            ? EVENT_STATUS.verified
            : EVENT_STATUS.dismissed;
      const auditResult =
        input.outcome === "scheduled"
          ? null
          : input.outcome === "verified"
            ? AUDIT_RESULTS.issueFound
            : AUDIT_RESULTS.ok;
      const result = await appendEvent({
        entity_id: input.entityId,
        event_type: "verification",
        status,
        audit_result: auditResult,
        note: `${input.flagTitle} — ${input.note}`,
      });
      if (result.ok) invalidate();
      return result;
    },
    [invalidate],
  );

  const dismissFlag: CivicContextValue["dismissFlag"] = useCallback(
    async (flagId) => {
      const [entityId = "", ruleId = ""] = flagId.split(":");
      const flag = flags.find((f) => f.id === flagId);
      const result = await appendEvent({
        entity_id: entityId,
        event_type: "verification",
        status: EVENT_STATUS.dismissed,
        audit_result: AUDIT_RESULTS.ok,
        note: `Attention signal dismissed from the ward dashboard (${ruleId} · ${
          flag?.title ?? "review signal"
        })`,
      });
      if (result.ok) invalidate();
      return result;
    },
    [flags, invalidate],
  );

  /* ---------------- totals ---------------- */
  const totals = useMemo(() => {
    return {
      assets: entities.filter((e) => e.kind === "asset").length,
      bwgs: entities.filter((e) => e.kind === "bwg").length,
      collections: events.filter((e) => e.type === "collection").length,
      reports: events.filter((e) => e.type === "report").length,
      flags: flags.length,
    };
  }, [entities, events, flags]);

  const issueTypes = useMemo(() => {
    const found = [
      ...new Set(
        data.events.map((e) => e.issueType).filter((v): v is string => !!v && v.length > 0),
      ),
    ].sort();
    return found;
  }, [data.events]);

  const status: CivicContextValue["status"] = query.isLoading
    ? "loading"
    : query.isError
      ? "error"
      : "ready";

  const value: CivicContextValue = {
    entities,
    events,
    flags,
    clusters,
    verifications,
    notifications,
    unreadCount: notifications.filter(
      (n) => !readNotificationIds.includes(n.id) && isToday(n.createdAt),
    ).length,
    ward,
    wards,
    official: CURRENT_OFFICIAL,
    totals,
    status,
    error:
      query.error instanceof Error ? query.error.message : query.isError ? "Query failed" : null,
    refresh: invalidate,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null,
    realtimeStatus,
    realtimeDetail,
    seededRows: data.seededRows,
    excludedTestRows: data.excludedTestRows,
    includeTestRows,
    setIncludeTestRows,
    setWard,
    getEntity: (id) => entities.find((e) => e.id === id),
    statusOf,
    flagsFor,
    issueTypes,
    recordCollection,
    submitReport,
    recordVerification,
    dismissFlag,
    markNotificationsRead: () => setReadNotificationIds(notifications.map((n) => n.id)),
  };

  return (
    <CivicContext.Provider value={value}>
      {hydrated ? (
        children
      ) : (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading CivicTrace…
        </div>
      )}
    </CivicContext.Provider>
  );
}

export function useCivic() {
  const ctx = useContext(CivicContext);
  if (!ctx) throw new Error("useCivic must be used inside CivicProvider");
  return ctx;
}
