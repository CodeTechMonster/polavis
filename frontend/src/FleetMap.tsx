import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useLivePositions, useLegRoute } from "./hooks";
import { useDashboardStore } from "./store";

const STREET_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// v1.1: default map center when no location data is available — Milton, ON (one of the two
// terminal hubs named in the hackathon brief), per the enhancement request.
const DEFAULT_CENTER: [number, number] = [43.5183, -79.8774];
const NEARBY_ZOOM = 13;

function statusColor(status: string) {
  if (status === "driving") return "#378ADD";
  if (status === "dwelling") return "#EF9F27";
  return "#5F5E5A";
}

// Flies the map to a location when the dispatcher clicks a truck's current position — the
// "Show Nearby Area" behavior from the enhancement request.
function FlyToOnSelect({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, NEARBY_ZOOM, { duration: 0.75 });
  }, [target, map]);
  return null;
}

// Fits the map to show a leg's full origin->destination span whenever a new trip is selected
// (from "Highest risk legs", All Legs, an edge-case modal — anything that calls selectTrip).
function FitToRoute({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.flyToBounds(bounds, { padding: [60, 60], duration: 0.75, maxZoom: 11 });
  }, [bounds, map]);
  return null;
}

export default function FleetMap() {
  const { data: positions = [] } = useLivePositions();
  const [satellite, setSatellite] = useState(false);
  const [focused, setFocused] = useState<[number, number] | null>(null);

  const selected = useDashboardStore((s) => s.selected);
  const { data: route } = useLegRoute(selected?.TRIP_NUMBER, selected?.DRIVER_NAME);
  const hasRoute = !!(route?.origin && route?.destination);
  const routeBounds: [[number, number], [number, number]] | null = hasRoute
    ? [
        [route!.origin!.lat, route!.origin!.lon],
        [route!.destination!.lat, route!.destination!.lon],
      ]
    : null;

  return (
    <div id="fleet-map-section" className="rounded-2xl border border-[var(--border)] overflow-hidden relative" style={{ height: 420 }}>
      <button
        onClick={() => setSatellite((s) => !s)}
        className="absolute z-[1000] top-3 right-3 text-xs bg-black/60 text-white px-3 py-1.5 rounded-lg border border-white/20 backdrop-blur"
      >
        {satellite ? "Street view" : "Satellite view"}
      </button>
      {selected && (
        <div className="absolute z-[1000] top-3 left-3 text-xs bg-black/60 text-white px-3 py-1.5 rounded-lg border border-white/20 backdrop-blur max-w-[70%]">
          {hasRoute ? (
            <>
              <span className="text-emerald-400">●</span> Trip {selected.TRIP_NUMBER} · {selected.DRIVER_NAME}: {route!.origin!.name} → {route!.destination!.name}
            </>
          ) : (
            <>No mappable route for Trip {selected.TRIP_NUMBER} — {selected.ORIG_ZONE_DESC} / {selected.DEST_ZONE_DESC} isn't in the mapped zone list.</>
          )}
        </div>
      )}
      <MapContainer center={DEFAULT_CENTER} zoom={9} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url={satellite ? SATELLITE_TILES : STREET_TILES}
          attribution={satellite ? "Tiles &copy; Esri" : '&copy; OpenStreetMap contributors'}
        />
        <FlyToOnSelect target={focused} />
        <FitToRoute bounds={routeBounds} />
        {hasRoute && (
          <>
            <Polyline
              positions={[
                [route!.origin!.lat, route!.origin!.lon],
                [route!.destination!.lat, route!.destination!.lon],
              ]}
              pathOptions={{ color: "#818CF8", weight: 3, dashArray: "6 6" }}
            />
            <CircleMarker
              center={[route!.origin!.lat, route!.origin!.lon]}
              radius={9}
              pathOptions={{ color: "#34D399", fillColor: "#34D399", fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">Origin — {route!.origin!.name}</div>
                  <div>Trip {selected!.TRIP_NUMBER} · {selected!.DRIVER_NAME}</div>
                </div>
              </Popup>
            </CircleMarker>
            <CircleMarker
              center={[route!.destination!.lat, route!.destination!.lon]}
              radius={9}
              pathOptions={{ color: "#F87171", fillColor: "#F87171", fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">Destination — {route!.destination!.name}</div>
                  <div>Trip {selected!.TRIP_NUMBER} · {selected!.DRIVER_NAME}</div>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}
        {positions.map((p) => (
          <CircleMarker
            key={p.trip_number}
            center={[p.lat, p.lon]}
            radius={7}
            pathOptions={{ color: statusColor(p.status), fillColor: statusColor(p.status), fillOpacity: 0.85 }}
            eventHandlers={{ click: () => setFocused([p.lat, p.lon]) }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">Trip {p.trip_number} · {p.driver_name}</div>
                <div>Status: {p.status}</div>
                <div>Speed: {Math.round(p.speed_kmh)} km/h</div>
                <div>HOS remaining: {p.hos_remaining.toFixed(1)}h</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

