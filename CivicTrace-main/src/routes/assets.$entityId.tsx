import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  History,
  Map as MapIcon,
  Megaphone,
  PackageCheck,
  QrCode as QrIcon,
  Repeat,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CollectionModal } from "@/components/civic/CollectionModal";
import { EventDetailDialog } from "@/components/civic/EventDetailDialog";
import { EventTimeline } from "@/components/civic/EventTimeline";
import { InsightCard } from "@/components/civic/InsightCard";
import { InsightDialog } from "@/components/civic/InsightDialog";
import {
  DetectVerifyActNote,
  DataSourceNote,
  SchemaCoverageNote,
} from "@/components/civic/PageHeader";
import { QrCode } from "@/components/civic/QrCode";
import { QrScanDialog } from "@/components/civic/QrScanDialog";
import { ReportModal } from "@/components/civic/ReportModal";
import { StatusBadge } from "@/components/civic/StatusBadge";
import { useCivic } from "@/lib/civic/store";
import { eventsFor, fmtDate, fmtTime, lastCollection, openReports } from "@/lib/civic/rules";
import type { AssetEntity, CivicEvent, Flag } from "@/lib/civic/types";

export const Route = createFileRoute("/assets/$entityId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.entityId} — Municipal Waste Asset · CivicTrace` },
      {
        name: "description",
        content: `Digital identity, collection record, citizen reports and full event history for municipal waste asset ${params.entityId}.`,
      },
      { property: "og:title", content: `${params.entityId} — Municipal Waste Asset · CivicTrace` },
      {
        property: "og:description",
        content: `Connected event history for ${params.entityId} across collections, citizen reports and maintenance.`,
      },
    ],
  }),
  component: AssetDetail,
});

function EntityLoading({ id }: { id: string }) {
  return (
    <div className="panel p-8 text-center text-sm text-muted-foreground">
      Loading the shared record for <span className="mono-id">{id}</span>…
    </div>
  );
}

function EntityUnavailable({
  id,
  message,
  onRetry,
}: {
  id: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="panel space-y-3 p-8 text-center text-sm text-muted-foreground">
      <p>
        The shared record for <span className="mono-id">{id}</span> could not be loaded.
      </p>
      <p className="text-xs">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function AssetDetail() {
  const { entityId } = Route.useParams();
  const { getEntity, events, statusOf, flagsFor, status: dataStatus, error, refresh } = useCivic();
  const entity = getEntity(entityId);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [activeEvent, setActiveEvent] = useState<CivicEvent | null>(null);
  const [activeFlag, setActiveFlag] = useState<Flag | null>(null);

  // The shared records load asynchronously, so only report a missing entity once
  // the database has actually answered.
  if (!entity && dataStatus === "loading") return <EntityLoading id={entityId} />;
  if (!entity && dataStatus === "error") {
    return (
      <EntityUnavailable
        id={entityId}
        message={error ?? "The shared database could not be reached."}
        onRetry={refresh}
      />
    );
  }
  if (!entity || entity.kind !== "asset") throw notFound();
  const asset = entity as AssetEntity;

  const status = statusOf(asset.id);
  const flags = flagsFor(asset.id);
  const history = eventsFor(events, asset.id);
  const last = lastCollection(events, asset.id);
  const reportCount = openReports(events, asset.id).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/assets" className="hover:underline">
              Waste Assets
            </Link>
            <span>/</span>
            <span className="mono-id">{asset.id}</span>
          </nav>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">
            <span className="font-mono">{asset.id}</span>
            <StatusBadge status={status} />
            {asset.isSeeded && (
              <span
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
                title="Illustrative Ward 142 modelled dataset — not official MCD data."
              >
                ILLUSTRATIVE
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Municipal Waste Asset · {asset.servicePoint}, {asset.ward}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCollectionOpen(true)}>
            <PackageCheck className="size-4" /> Record Collection
          </Button>
          <Button variant="secondary" onClick={() => setReportOpen(true)}>
            <Megaphone className="size-4" /> Report Issue
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              document.getElementById("entity-history")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <History className="size-4" /> View History
          </Button>
          <Button asChild variant="outline">
            <Link to="/map" search={{ entity: asset.id }}>
              <MapIcon className="size-4" /> Open on Map
            </Link>
          </Button>
        </div>
      </div>

      <DetectVerifyActNote />

      <section data-tour="entity-identity" className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="panel p-4">
          <h2 className="text-base font-semibold">Digital identity</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ["Entity ID", asset.id],
              ["Type", asset.entityType],
              ["Service Point", `${asset.servicePoint}, ${asset.ward}`],
              [
                "Capacity",
                asset.capacityLitres != null ? `${asset.capacityLitres} L` : "Not recorded",
              ],
              ["Expected collection", asset.expectedCollectionTime ?? "Not recorded"],
              [
                "Last collection",
                last ? `${fmtDate(last.timestamp)} · ${fmtTime(last.timestamp)}` : "—",
              ],
              ["Open citizen reports", `${reportCount}`],
              [
                "Maintenance",
                asset.maintenanceRequired ? "Required (derived from repairs)" : "None recorded",
              ],
              ["Installed", asset.installedOn ? fmtDate(asset.installedOn) : "Not recorded"],
              [
                "Recorded GPS",
                asset.lat != null && asset.lng != null
                  ? `${asset.lat.toFixed(5)}, ${asset.lng.toFixed(5)}${
                      asset.coordinatesFrom?.accuracy != null
                        ? ` (±${Math.round(asset.coordinatesFrom.accuracy)} m)`
                        : ""
                    }`
                  : "No fix recorded",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground uppercase">{label}</dt>
                <dd className="mt-0.5 font-medium">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-4">
            {[
              ["Collections", asset.lifetime.collections],
              ["Citizen reports", asset.lifetime.reports],
              ["Repairs", asset.lifetime.repairs],
              ["Maintenance events", asset.lifetime.maintenance],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md bg-surface-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <QrIcon className="size-4" /> Scan to access {asset.id}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The physical QR code on the asset opens the worker and citizen actions — no specialised
            hardware.
          </p>
          <div className="mx-auto mt-3 max-w-[200px] rounded-lg border border-border p-2">
            <QrCode value={`civictrace://${asset.id}`} />
          </div>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => setScanOpen(true)}>
            Simulate QR Scan
          </Button>
        </div>
      </section>

      {(asset.replacedById || asset.replacesId) && (
        <section className="panel p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Repeat className="size-4" /> Service point continuity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The replaced asset stays in history. The service point — and its event history —
            continues.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <Link
              to="/assets/$entityId"
              params={{ entityId: asset.replacesId ?? asset.id }}
              className="mono-id rounded-md border border-border px-3 py-2 hover:bg-surface-muted"
            >
              {asset.replacesId ?? asset.id}
            </Link>
            <span className="text-xs text-muted-foreground">
              ↓ Replaced{asset.replacementDate ? ` · ${fmtDate(asset.replacementDate)}` : ""}
              {asset.replacementReason ? ` · ${asset.replacementReason}` : ""}
            </span>
            <Link
              to="/assets/$entityId"
              params={{ entityId: asset.replacedById ?? asset.id }}
              className="mono-id rounded-md border border-border px-3 py-2 hover:bg-surface-muted"
            >
              {asset.replacedById ?? asset.id}
            </Link>
          </div>
        </section>
      )}

      {flags.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Detected patterns</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {flags.map((flag) => (
              <InsightCard key={flag.id} flag={flag} onOpenInsight={setActiveFlag} />
            ))}
          </div>
        </section>
      )}

      <section id="entity-history" className="panel scroll-mt-20 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Entity history</h2>
            <p className="text-xs text-muted-foreground">
              Installation, collections, citizen reports, repairs, replacement and verification —
              one connected record.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{history.length} events</span>
        </div>
        <div className="mt-3">
          <EventTimeline events={history} onSelect={setActiveEvent} showEntity={false} />
        </div>
        <DataSourceNote className="mt-3" />
        <SchemaCoverageNote
          className="mt-1"
          fields={["asset name", "capacity (litres)", "expected collection time"]}
        />
      </section>

      <CollectionModal entity={asset} open={collectionOpen} onOpenChange={setCollectionOpen} />
      <ReportModal entity={asset} open={reportOpen} onOpenChange={setReportOpen} />
      <QrScanDialog
        entity={asset}
        open={scanOpen}
        onOpenChange={setScanOpen}
        onRecordCollection={() => setCollectionOpen(true)}
        onReportIssue={() => setReportOpen(true)}
      />
      <EventDetailDialog
        event={activeEvent}
        open={!!activeEvent}
        onOpenChange={(open) => !open && setActiveEvent(null)}
      />
      <InsightDialog
        flag={activeFlag}
        open={!!activeFlag}
        onOpenChange={(open) => !open && setActiveFlag(null)}
      />
    </div>
  );
}
