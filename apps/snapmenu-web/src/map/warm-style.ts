// Map adapted from the team's wohin app (apps/web/src/screens/map/warm-style.ts), recoloured to Snapmenu's palette:
// sage land, white roads, basil-tinted parks, muted water. Applied as paint overrides after the style loads,
// so tiles and labels stay OpenFreeMap's (free, no key; © OpenMapTiles, © OpenStreetMap contributors).
import type { Map as MlMap } from 'maplibre-gl'

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
export const LAND = '#eef1e9'

const ROAD = '#ffffff'
const CASING = '#dde3d6'
const RAIL = '#d9dfd2'
const LABEL = '#66726a'
const HALO = '#eef1e9'

const PAINT: Record<string, Record<string, string>> = {
  background: { 'background-color': LAND },
  park: { 'fill-color': '#dbe8d9' },
  landcover_wood: { 'fill-color': '#d4e3d1' },
  water: { 'fill-color': '#cbdfe0' },
  waterway: { 'line-color': '#cbdfe0' },
  landuse_residential: { 'fill-color': '#eaeee4' },
  building: { 'fill-color': '#e4e9dd', 'fill-outline-color': '#d9dfd1' },
  road_area_pier: { 'fill-color': LAND },
  road_pier: { 'line-color': LAND },
  'aeroway-area': { 'fill-color': ROAD },
  highway_path: { 'line-color': '#e2e7db' },
  highway_minor: { 'line-color': ROAD },
  highway_major_casing: { 'line-color': CASING },
  highway_major_inner: { 'line-color': ROAD },
  highway_major_subtle: { 'line-color': '#e3e8dc' },
  highway_motorway_casing: { 'line-color': '#d6ddcd' },
  highway_motorway_inner: { 'line-color': '#fbfcf8' },
  highway_motorway_subtle: { 'line-color': '#e3e8dc' },
  highway_motorway_bridge_casing: { 'line-color': '#d6ddcd' },
  highway_motorway_bridge_inner: { 'line-color': '#fbfcf8' },
  tunnel_motorway_casing: { 'line-color': CASING },
  tunnel_motorway_inner: { 'line-color': '#eef1e9' },
  railway: { 'line-color': RAIL },
  railway_dashline: { 'line-color': '#f6f8f3' },
  railway_transit: { 'line-color': RAIL },
  railway_transit_dashline: { 'line-color': '#f6f8f3' },
  railway_service: { 'line-color': RAIL },
  railway_service_dashline: { 'line-color': '#f6f8f3' },
  boundary_2: { 'line-color': '#c9d1c2' },
  boundary_3: { 'line-color': '#c9d1c2' },
  waterway_line_label: { 'text-color': '#6f9198', 'text-halo-color': HALO },
  water_name_point_label: { 'text-color': '#62858d', 'text-halo-color': HALO },
  water_name_line_label: { 'text-color': '#62858d', 'text-halo-color': HALO },
  'highway-name-path': { 'text-color': '#97a299', 'text-halo-color': HALO },
  'highway-name-minor': { 'text-color': LABEL, 'text-halo-color': HALO },
  'highway-name-major': { 'text-color': LABEL, 'text-halo-color': HALO },
  label_other: { 'text-color': '#7b867e', 'text-halo-color': HALO },
  label_village: { 'text-color': '#44524a', 'text-halo-color': HALO },
  label_town: { 'text-color': '#44524a', 'text-halo-color': HALO },
}

/** The page already names the area; the city label would only sit under the pins. */
const HIDDEN = ['label_city', 'label_city_capital', 'airport']

export function applyWarmStyle(map: MlMap) {
  for (const [id, paint] of Object.entries(PAINT)) {
    if (!map.getLayer(id)) continue
    for (const [prop, value] of Object.entries(paint)) {
      try {
        map.setPaintProperty(id, prop as Parameters<MlMap['setPaintProperty']>[1], value)
      } catch {
        // A style update renamed a property: keep OpenFreeMap's colour.
      }
    }
  }
  for (const id of HIDDEN) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
  }
}
