import { CircleAlert, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCivic } from "@/lib/civic/store";

/**
 * Global state for the shared database connection: an outage must never look
 * like "no records exist".
 */
export function DataStatusBanner() {
  const { status, error, refresh, realtimeStatus, seededRows, excludedTestRows, includeTestRows } =
    useCivic();

  if (status === "error") {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <CircleAlert className="size-4 shrink-0" />
        <span className="font-semibold">Shared database unavailable.</span>
        <span className="text-destructive/90">
          {error ?? "The CivicTrace Supabase project could not be reached."} Figures below may be
          incomplete or stale.
        </span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => refresh()}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading shared records from the CivicTrace Supabase project…
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-muted px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>
        <span className="font-semibold">Shared database connected.</span>{" "}
        {realtimeStatus === "subscribed"
          ? "Streaming live changes."
          : "Refetching on an interval and on window focus (Realtime is not enabled for these tables)."}
      </span>
      {seededRows > 0 && (
        <span>
          Includes the illustrative Ward 142 modelled dataset — {seededRows} seed record
          {seededRows === 1 ? "" : "s"} labelled ILLUSTRATIVE, not official MCD data.
        </span>
      )}
      {excludedTestRows > 0 && !includeTestRows && (
        <span>
          {excludedTestRows} integration-test record{excludedTestRows === 1 ? "" : "s"} held out of
          the live figures — switch on “Include integration-test rows” in the database menu to see
          them.
        </span>
      )}
    </div>
  );
}
