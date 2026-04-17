// Leaflet-backed deal map. Clusters nearby deals at low zoom levels so
// the Quebec view doesn't turn into an unreadable stack of pins. Reads
// Leaflet from window.L (loaded via <script> tag in index.html) because
// bundling the full library wasn't worth the extra ~40 kB on first paint.
//
// Props:
//   deals       - array of deals (each must have .coords.{lat,lng} to render)
//   onOpenDeal  - (dealId) => void, invoked when the popup "Ouvrir" button clicks
//   interactive - false for compact dashboard previews (no drag/zoom/fit-on-change)
//   height      - CSS height string/number for the map container

import { useState, useRef, useEffect, useCallback } from "react";
import { STAGES, PRIORITY } from "../lib/stages.js";
import { esc } from "../lib/format.js";
import { dealLabel, stageColor } from "../lib/dealHelpers.js";

// Greedy geographic clustering. The threshold shrinks as the user zooms in:
// at zoom ≥ 9 every deal gets its own pin; below that we fold pins within
// a fixed lat/lng distance into a single cluster marker.
function clusterDeals(items, zoom) {
  if (zoom >= 9) return items.map(item => ({ items:[item], lat:item.coords.lat, lng:item.coords.lng }));
  const threshold = zoom <= 6 ? 1.1 : zoom === 7 ? 0.55 : 0.3;
  const groups = [];
  items.forEach((item) => {
    const found = groups.find((g) => Math.hypot(g.lat - item.coords.lat, g.lng - item.coords.lng) <= threshold);
    if (!found) {
      groups.push({ items:[item], lat:item.coords.lat, lng:item.coords.lng });
      return;
    }
    found.items.push(item);
    const n = found.items.length;
    found.lat = (found.lat * (n - 1) + item.coords.lat) / n;
    found.lng = (found.lng * (n - 1) + item.coords.lng) / n;
  });
  return groups;
}

export default function DealMap({ deals, onOpenDeal, interactive = true, height = "calc(100vh - 140px)" }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const fittedRef = useRef(false);
  const [zoom, setZoom] = useState(7);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapElRef.current || mapRef.current) return;

    const map = L.map(mapElRef.current, {
      zoomControl: interactive,
      scrollWheelZoom: interactive,
      dragging: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      touchZoom: interactive,
      attributionControl: true,
    });
    map.setView([46.8139, -71.2080], 7);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setZoom(map.getZoom());

    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    if (!interactive || !mapRef.current) return;
    const map = mapRef.current;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [interactive]);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    const safeDeals = (deals || []).filter((deal) => Number.isFinite(Number(deal?.coords?.lat)) && Number.isFinite(Number(deal?.coords?.lng)));
    const clusters = clusterDeals(safeDeals, interactive ? zoom : 7);

    clusters.forEach((group) => {
      if (group.items.length === 1) {
        const deal = group.items[0];
        const color = stageColor(deal.stage);
        const priority = PRIORITY[deal.priority || "medium"] || PRIORITY.medium;
        const icon = L.divIcon({
          className: "",
          html: `<div class="map-pin" style="background:${color}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        });
        const marker = L.marker([group.lat, group.lng], { icon }).addTo(layer);
        marker.bindPopup(`
          <div class="map-popup">
            <div class="map-popup-title">${esc(dealLabel(deal))}</div>
            <div class="map-popup-sub">${esc(STAGES.find((s) => s.id === deal.stage)?.label || "Prospection")}</div>
            <div class="map-popup-row">Contact: ${esc(deal.contact?.name || "N/A")}</div>
            <div class="map-popup-row">Priorité: <span class="map-pill" style="background:${priority.color}22;color:${priority.color}">${esc(priority.label)}</span></div>
            <div class="map-popup-row">Follow-up: ${esc(deal.followUpDate || "Non défini")}</div>
            <button class="map-open-btn" data-open-deal="${esc(deal.id)}">Ouvrir le deal</button>
          </div>
        `);
      } else {
        const icon = L.divIcon({
          className: "",
          html: `<div class="map-cluster-pin" style="background:${"#C9A84C"}">${group.items.length}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([group.lat, group.lng], { icon }).addTo(layer);
        const rows = group.items.slice(0, 8).map((deal) => (
          `<div class="map-popup-row">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stageColor(deal.stage)};margin-right:6px;"></span>
            ${esc(dealLabel(deal))}
            <button class="map-open-btn" data-open-deal="${esc(deal.id)}" style="padding:3px 7px;font-size:10px;margin-top:4px;margin-left:8px;">Ouvrir</button>
          </div>`
        )).join("");
        marker.bindPopup(`
          <div class="map-popup">
            <div class="map-popup-title">${group.items.length} deals proches</div>
            ${rows}
          </div>
        `);
      }
    });

    if (safeDeals.length > 0) {
      const bounds = L.latLngBounds(safeDeals.map((deal) => [Number(deal.coords.lat), Number(deal.coords.lng)]));
      if (!interactive || !fittedRef.current) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
        fittedRef.current = true;
      }
    } else if (!interactive) {
      map.setView([46.8139, -71.2080], 7);
    }

    setTimeout(() => map.invalidateSize(), 0);
  }, [deals, interactive, zoom]);

  const onPopupAction = useCallback((event) => {
    const target = event.target?.closest?.("[data-open-deal]");
    if (!target) return;
    const dealId = target.getAttribute("data-open-deal");
    if (!dealId) return;
    event.preventDefault();
    onOpenDeal(dealId);
  }, [onOpenDeal]);

  const mapHeight = typeof height === "number" ? `${height}px` : height;

  if (!window.L) {
    return <div className="status-note">Leaflet n&apos;est pas chargé.</div>;
  }

  return (
    <div onClick={onPopupAction}>
      <div ref={mapElRef} className={`map-viewport${interactive ? "" : " mini"}`} style={{height: mapHeight}} />
    </div>
  );
}
