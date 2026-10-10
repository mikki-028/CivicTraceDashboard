import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eventTypeLabel } from "@/components/civic/EventTimeline";
import { fmtDateTime } from "@/lib/civic/rules";
import type { CivicEvent } from "@/lib/civic/types";

export function EventDetailDialog({
  event,
  open,
  onOpenChange,
}: {
  event: CivicEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!event) return null;
  const isBwg = event.entityId.startsWith("BWG");

  const rows: [string, string][] = [
    ["Event ID", event.id],
    ["Event type", eventTypeLabel[event.type]],
    ["Stored type", event.rawType],
    ["Entity", event.entityId],
    ["Timestamp", fmtDateTime(event.timestamp)],
    ["Actor", event.actor],
    ["Location", event.location ?? "—"],
  ];
  if (event.issueType) rows.push(["Issue type", event.issueType]);
  if (event.status) rows.push(["Record status", event.status]);
  if (event.auditResult) rows.push(["Audit result", event.auditResult]);
  if (event.verification) rows.push(["Report state", event.verification]);
  if (event.source) rows.push(["Recorded by", event.source]);
  if (event.environment) rows.push(["Environment", event.environment]);
  if (event.latitude != null && event.longitude != null) {
    rows.push([
      "Recorded GPS",
      `${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}${
        event.accuracy != null ? ` (±${Math.round(event.accuracy)} m)` : ""
      }`,
    ]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
          <DialogDescription>{event.detail ?? "Full event record"}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {event.photoUrl && (
          <a
            href={event.photoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline"
          >
            Open stored photo evidence
          </a>
        )}
        <DialogFooter>
          <Button asChild>
            <Link
              to={isBwg ? "/bwgs/$entityId" : "/assets/$entityId"}
              params={{ entityId: event.entityId }}
              onClick={() => onOpenChange(false)}
            >
              Open entity & full history
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
