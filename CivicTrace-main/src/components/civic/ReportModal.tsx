import { useEffect, useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/civic/StatusBadge";
import { REPORT_ISSUE_TYPES } from "@/lib/civic/schema";
import { formatFix, requestDeviceFix, type GeoFix } from "@/lib/civic/geo";
import { useCivic } from "@/lib/civic/store";
import { reportStatusFor } from "@/lib/civic/rules";
import type { CivicEntity } from "@/lib/civic/types";

export function ReportModal({
  entity,
  open,
  onOpenChange,
}: {
  entity: CivicEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { submitReport, events } = useCivic();
  const [issue, setIssue] = useState<string>(REPORT_ISSUE_TYPES[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<GeoFix | null>(null);

  useEffect(() => {
    if (!open || done) return;
    let cancelled = false;
    void requestDeviceFix().then((result) => {
      if (!cancelled) setFix(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, done]);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next)
      setTimeout(() => {
        setDone(false);
        setNote("");
        setError(null);
        setIssue(REPORT_ISSUE_TYPES[0]);
      }, 200);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await submitReport({
      entityId: entity.id,
      issueType: issue,
      note: note || undefined,
      position: fix,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "The report could not be saved.");
      toast.error("Report not saved", { description: result.error ?? undefined });
      return;
    }
    setDone(true);
    toast.success("Report recorded", { description: `${entity.id} · ${issue} · Unverified` });
  };

  const patternStatus = reportStatusFor(events, entity.id);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-normal" />
            <h2 className="mt-3 text-lg font-semibold">Report recorded</h2>
            <div className="mt-2 flex justify-center">
              <StatusBadge status="pending" label="Unverified" size="sm" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Your report has been stored against {entity.id} in the shared database and will be
              reviewed by the relevant municipal authority.
            </p>
            {patternStatus !== "pending" && patternStatus !== "normal" && (
              <div className="mt-4 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
                Repeated reports on this entity have raised it to{" "}
                <StatusBadge status={patternStatus} size="sm" className="mx-1 align-middle" /> for
                municipal review.
              </div>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">
              CivicTrace detects patterns. MCD verifies.
            </p>
            <Button className="mt-4 w-full" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report an Issue</DialogTitle>
              <DialogDescription>
                Recorded from the ward dashboard against the entity's QR identity. In the field, the
                same report is captured from the public QR website.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Entity</p>
              <p className="mono-id mt-0.5">{entity.id}</p>
              <p className="text-xs text-muted-foreground">
                {entity.servicePoint}, {entity.ward}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase">Issue type</Label>
              <RadioGroup value={issue} onValueChange={setIssue}>
                {REPORT_ISSUE_TYPES.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent"
                  >
                    <RadioGroupItem value={option} />
                    {option}
                  </label>
                ))}
              </RadioGroup>
            </div>

            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (not required)"
              rows={2}
            />

            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              {fix
                ? `Location attached: ${formatFix(fix)}`
                : "No location fix available for this device."}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Photo evidence is captured from the public QR website, where the reporter's device
              camera uploads to the shared event-photos bucket.
            </p>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
