import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import type { LatLngBoundsExpression, Map as LeafletMap, MarkerClusterGroup } from "leaflet";
import type {} from "leaflet.markercluster";

import { Button } from "@/components/ui/button";
import { useCivic } from "@/lib/civic/store";
import { fmtDateTime } from "@/lib/civic/rules";
import type { CivicEntity, StatusLevel } from "@/lib/civic/types";
import { cn } from "@/lib/utils";

type MapFilter = "all" | "assets" | "bwgs" | "issues" | "attention";

const FILTERS: { value: MapFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "assets", label: "Assets" },
  { value: "bwgs", label: "BWGs" },
  { value: "issues", label: "Issues" },
  { value: "attention", label: "Attention" },
];

/** Fallback centre only — used when the database holds no coordinates at all. */
// Centroid of the recovered Ward 142 modelled coordinates — the demo's own
// illustrative centre. Used only when no entity has a recorded GPS fix.
const FALLBACK_CENTER: [number, number] = [28.6422, 77.2204];
const FALLBACK_ZOOM = 12;

export function GisInteractiveMap({
  entities,
  statusOf,
  selectedId,
  onSelect,
  className,
}: {
  entities: CivicEntity[];
  statusOf: (id: string) => StatusLevel;
  selectedId?: string | null;
  onSelect: (entity: CivicEntity) => void;
  className?: string;
}) {
  const { events } = useCivic();
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [mapReady, setMapReady] = useState(false);

  const positioned = useMemo(
    () => entities.filter((entity) => entity.lat != null && entity.lng != null),
    [entities],
  );
  const unmapped = entities.length - positioned.length;

  /** Individual recorded GPS fixes (reports, collections, inspections) that carry coordinates. */
  const fixPoints = useMemo(
    () =>
      events
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => ({
          id: e.id,
          entityId: e.entityId,
          type: e.type,
          title: e.title,
          at: e.timestamp,
          lat: e.latitude as number,
          lng: e.longitude as number,
        })),
    [events],
  );

  const visibleEntities = useMemo(
    () =>
      positioned.filter((entity) => {
        const status = statusOf(entity.id);
        if (filter === "assets") return entity.kind === "asset";
        if (filter === "bwgs") return entity.kind === "bwg";
        if (filter === "issues") return status === "priority";
        if (filter === "attention") return status === "attention" || status === "maintenance";
        return true;
      }),
    [positioned, filter, statusOf],
  );

  useEffect(() => {
    const node = mapNodeRef.current;
    if (!node || mapRef.current) return;

    let disposed = false;
    void import("leaflet").then(async (leafletModule) => {
      const L = (
        "default" in leafletModule ? leafletModule.default : leafletModule
      ) as typeof import("leaflet");
      Object.assign(globalThis, { L });
      await import("leaflet.markercluster");
      if (disposed || !mapNodeRef.current) return;

      const map = L.map(mapNodeRef.current, {
        center: FALLBACK_CENTER,
        zoom: FALLBACK_ZOOM,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const clusterLayer = L.markerClusterGroup({
        maxClusterRadius: 48,
        disableClusteringAtZoom: 18,
        showCoverageOnHover: true,
        spiderfyOnMaxZoom: true,
        spiderfyDistanceMultiplier: 1.35,
        iconCreateFunction: (cluster) =>
          L.divIcon({
            className: "civic-map-cluster-wrap",
            html: `<span class="civic-map-cluster">${cluster.getChildCount()}</span>`,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          }),
      }).addTo(map);

      mapRef.current = map;
      clusterRef.current = clusterLayer;
      setMapReady(true);
    });

    return () => {
      disposed = true;
      clusterRef.current?.clearLayers();
      mapRef.current?.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const clusterLayer = clusterRef.current;
    if (!mapReady || !clusterLayer || !map) return;

    clusterLayer.clearLayers();
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed) return;
      const markers = visibleEntities.map((entity) => {
        const status = statusOf(entity.id);
        const selected = selectedId === entity.id;
        const icon = L.divIcon({
          className: "civic-map-icon",
          html: `<span class="civic-map-marker civic-map-marker--${status} civic-map-marker--${entity.kind}${selected ? " civic-map-marker--selected" : ""}" aria-hidden="true"></span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        const marker = L.marker([entity.lat as number, entity.lng as number], {
          icon,
          title: `${entity.id} — ${entity.servicePoint}`,
          keyboard: true,
        });
        const fixingEvent = fixPoints.find((p) => p.entityId === entity.id);
        marker.on("click", () => onSelect(entity));
        marker.bindTooltip(
          `${entity.id} · ${entity.servicePoint}${fixingEvent ? ` · fix ${fmtDateTime(fixingEvent.at)}` : ""}`,
          { direction: "top", offset: [0, -13] },
        );
        return marker;
      });

      // Recorded event fixes are shown as their own layer so a report and the
      // entity it belongs to can be told apart.
      const fixMarkers = fixPoints.map((point) => {
        const entity = entities.find((e) => e.id === point.entityId);
        const icon = L.divIcon({
          className: "civic-map-icon",
          html: `<span class="civic-map-fix civic-map-fix--${point.type}" aria-hidden="true"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const marker = L.marker([point.lat, point.lng], {
          icon,
          title: `${point.entityId} — ${point.title}`,
          keyboard: true,
        });
        marker.bindTooltip(`${point.entityId} · ${point.title} · ${fmtDateTime(point.at)}`, {
          direction: "top",
          offset: [0, -8],
        });
        if (entity) marker.on("click", () => onSelect(entity));
        return marker;
      });

      clusterLayer.addLayers([...markers, ...fixMarkers]);

      const points: [number, number][] = [
        ...visibleEntities.map((e) => [e.lat as number, e.lng as number] as [number, number]),
        ...fixPoints.map((p) => [p.lat, p.lng] as [number, number]),
      ];
      if (points.length > 1) {
        map.fitBounds(points as LatLngBoundsExpression, { padding: [36, 36], maxZoom: 17 });
      } else if (points.length === 1) {
        map.setView(points[0] as [number, number], 16);
      }
    });

    return () => {
      disposed = true;
    };
  }, [mapReady, onSelect, selectedId, statusOf, visibleEntities, fixPoints, entities]);

  const resetMap = () => {
    const map = mapRef.current;
    const current = selectedId ? entities.find((e) => e.id === selectedId) : undefined;
    if (map) {
      const points = [
        ...visibleEntities.map((e) => [e.lat as number, e.lng as number] as [number, number]),
        ...fixPoints.map((p) => [p.lat, p.lng] as [number, number]),
      ];
      if (points.length > 1) map.fitBounds(points as LatLngBoundsExpression, { padding: [36, 36] });
      else map.setView(FALLBACK_CENTER, FALLBACK_ZOOM, { animate: true });
    }
    if (current) onSelect(current);
  };

  return (
    <div className={cn("panel relative overflow-hidden", className)}>
      <div
        ref={mapNodeRef}
        className="h-full w-full"
        aria-label="Interactive clustered map of CivicTrace entities in Ward 142"
      />

      <div className="absolute top-3 left-12 z-[500] flex max-w-[calc(100%-7.75rem)] flex-wrap items-center gap-1 rounded-md border border-border bg-surface/95 p-1 shadow-panel backdrop-blur-sm">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={filter === item.value ? "secondary" : "ghost"}
            className="h-7 px-2.5"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="absolute top-3 right-3 z-[500] size-9 shadow-raised"
        onClick={resetMap}
        aria-label="Reset map view"
        title="Reset map view"
      >
        <LocateFixed className="size-4" />
      </Button>

      <div className="pointer-events-none absolute right-3 bottom-7 z-[500] rounded-md border border-border bg-surface/95 px-2 py-1 text-[10px] font-medium shadow-panel backdrop-blur-sm">
        {visibleEntities.length} location{visibleEntities.length === 1 ? "" : "s"} ·{" "}
        {fixPoints.length} GPS fix{fixPoints.length === 1 ? "" : "es"}
        {unmapped > 0 ? ` · ${unmapped} unmapped` : ""}
      </div>

      {positioned.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-surface/70 px-6 text-center text-xs text-muted-foreground">
          No coordinates recorded yet — markers appear once an event is stored with a GPS fix.
        </div>
      )}
    </div>
  );
}
