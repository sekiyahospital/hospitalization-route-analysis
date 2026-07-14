"use client";

import { useEffect, useState } from "react";
import { GeoLocation } from "@/lib/geocode";

export default function HospitalMap({ locations }: { locations: GeoLocation[] }) {
  const [mapReady, setMapReady] = useState(false);
  const [MapContainer, setMapContainer] = useState<typeof import("react-leaflet").MapContainer | null>(null);
  const [TileLayer, setTileLayer] = useState<typeof import("react-leaflet").TileLayer | null>(null);
  const [CircleMarker, setCircleMarker] = useState<typeof import("react-leaflet").CircleMarker | null>(null);
  const [Tooltip, setTooltip] = useState<typeof import("react-leaflet").Tooltip | null>(null);
  const [Popup, setPopup] = useState<typeof import("react-leaflet").Popup | null>(null);

  useEffect(() => {
    (async () => {
      const rl = await import("react-leaflet");
      await import("leaflet/dist/leaflet.css");
      setMapContainer(() => rl.MapContainer);
      setTileLayer(() => rl.TileLayer);
      setCircleMarker(() => rl.CircleMarker);
      setTooltip(() => rl.Tooltip);
      setPopup(() => rl.Popup);
      setMapReady(true);
    })();
  }, []);

  if (!mapReady || !MapContainer || !TileLayer || !CircleMarker || !Tooltip || !Popup) {
    return (
      <div className="h-[500px] bg-gray-50 rounded-xl flex items-center justify-center">
        <div className="text-gray-400">地図を読み込み中...</div>
      </div>
    );
  }

  const maxCount = Math.max(...locations.map((l) => l.count), 1);
  const center: [number, number] = [34.53, 135.72];

  return (
    <MapContainer
      center={center}
      zoom={10}
      style={{ height: "500px", width: "100%", borderRadius: "12px" }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {locations.map((loc) => {
        const ratio = loc.count / maxCount;
        const radius = 8 + ratio * 30;
        const color = ratio > 0.6 ? "#dc2626" : ratio > 0.3 ? "#f59e0b" : "#3b82f6";
        const fillColor = ratio > 0.6 ? "#fca5a5" : ratio > 0.3 ? "#fde68a" : "#93c5fd";
        return (
          <CircleMarker
            key={loc.address}
            center={[loc.lat, loc.lng]}
            radius={radius}
            pathOptions={{
              color,
              fillColor,
              fillOpacity: 0.6,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -radius]} permanent={ratio > 0.5}>
              <div className="text-center" style={{ fontFamily: "sans-serif" }}>
                <div style={{ fontWeight: "bold", fontSize: "13px" }}>{loc.address}</div>
                <div style={{ color: "#1e40af", fontSize: "12px" }}>{loc.count}件</div>
              </div>
            </Tooltip>
            <Popup>
              <div style={{ fontFamily: "sans-serif", minWidth: "140px" }}>
                <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }}>
                  {loc.address}
                </div>
                <div style={{ fontSize: "13px", color: "#374151" }}>
                  入院数（CV）: <strong style={{ color: "#1e40af" }}>{loc.count}件</strong>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                  全体の{Math.round((loc.count / locations.reduce((s, l) => s + l.count, 0)) * 100)}%
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
