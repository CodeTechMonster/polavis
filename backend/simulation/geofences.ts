/**
 * Southern Ontario facility/city geofences used for simulated truck movement and
 * automated arrival/departure detention timestamping. Coordinates are approximate
 * city centers (public geographic data), radius is the simulated facility catchment.
 */

export interface Geofence {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

export const GEOFENCES: Geofence[] = [
  { name: "MILTON, ON", lat: 43.5183, lon: -79.8774, radiusKm: 4 },
  { name: "LONDON, ON", lat: 42.9849, lon: -81.2453, radiusKm: 5 },
  { name: "WHITBY, ON", lat: 43.8975, lon: -78.9429, radiusKm: 4 },
  { name: "OSHAWA, ON", lat: 43.8971, lon: -78.8658, radiusKm: 4 },
  { name: "MISSISSAUGA, ON", lat: 43.589, lon: -79.6441, radiusKm: 6 },
  { name: "BRAMPTON, ON", lat: 43.7315, lon: -79.7624, radiusKm: 5 },
  { name: "PICKERING, ON", lat: 43.8384, lon: -79.0868, radiusKm: 4 },
  { name: "BARRIE, ON", lat: 44.3894, lon: -79.6903, radiusKm: 4 },
  { name: "PETERBOROUGH, ON", lat: 44.3091, lon: -78.3197, radiusKm: 4 },
  { name: "NIAGARA FALLS, ON", lat: 43.0896, lon: -79.0849, radiusKm: 4 },
  { name: "KITCHENER, ON", lat: 43.4516, lon: -80.4925, radiusKm: 5 },
  { name: "HAMILTON, ON", lat: 43.2557, lon: -79.8711, radiusKm: 5 },
  { name: "TORONTO, ON", lat: 43.6532, lon: -79.3832, radiusKm: 8 },
  // Added after auditing the real dataset's ORIG/DEST_ZONE_DESC values (Phase 9): many real
  // legs were being marked "not simulatable" simply because their city wasn't in this list yet,
  // even though it's a legitimate Southern Ontario / GTA city within or near the brief's coverage
  // boundary (Barrie/Peterborough/Pickering/London/Niagara Falls). See README caveat for the
  // few outside that boundary (e.g. Kingston) that are included anyway because they appear often
  // enough in the data to be worth simulating.
  { name: "AJAX, ON", lat: 43.8509, lon: -79.0204, radiusKm: 4 },
  { name: "BELLEVILLE, ON", lat: 44.1628, lon: -77.3832, radiusKm: 4 },
  { name: "BOLTON, ON", lat: 43.8834, lon: -79.7301, radiusKm: 3 },
  { name: "BRANTFORD, ON", lat: 43.1394, lon: -80.2644, radiusKm: 4 },
  { name: "BURLINGTON, ON", lat: 43.3255, lon: -79.799, radiusKm: 4 },
  { name: "CALEDON, ON", lat: 43.8617, lon: -79.8686, radiusKm: 5 },
  { name: "CAMBRIDGE, ON", lat: 43.3616, lon: -80.3144, radiusKm: 4 },
  { name: "CHATHAM, ON", lat: 42.4048, lon: -82.191, radiusKm: 4 },
  { name: "COBOURG, ON", lat: 43.9598, lon: -78.1656, radiusKm: 3 },
  { name: "CONCORD, ON", lat: 43.7969, lon: -79.5288, radiusKm: 3 },
  { name: "DUNDAS, ON", lat: 43.2657, lon: -79.9527, radiusKm: 3 },
  { name: "EAST YORK, ON", lat: 43.6912, lon: -79.3266, radiusKm: 3 },
  { name: "ETOBICOKE, ON", lat: 43.6205, lon: -79.5132, radiusKm: 5 },
  { name: "GRIMSBY, ON", lat: 43.1998, lon: -79.5716, radiusKm: 3 },
  { name: "GUELPH, ON", lat: 43.5448, lon: -80.2482, radiusKm: 4 },
  { name: "HALTON HILLS, ON", lat: 43.6467, lon: -79.9309, radiusKm: 4 },
  { name: "KINGSTON, ON", lat: 44.2312, lon: -76.486, radiusKm: 5 },
  { name: "NORTH YORK, ON", lat: 43.7615, lon: -79.4111, radiusKm: 5 },
  { name: "OAKVILLE, ON", lat: 43.4675, lon: -79.6877, radiusKm: 5 },
  { name: "PORT HOPE, ON", lat: 43.9502, lon: -78.2957, radiusKm: 3 },
  { name: "REXDALE, ON", lat: 43.7278, lon: -79.5764, radiusKm: 3 },
  { name: "SCARBOROUGH, ON", lat: 43.7764, lon: -79.2318, radiusKm: 5 },
  { name: "STONEY CREEK, ON", lat: 43.223, lon: -79.7595, radiusKm: 3 },
  { name: "UNIONVILLE, ON", lat: 43.8647, lon: -79.314, radiusKm: 3 },
  { name: "VAUGHAN, ON", lat: 43.8361, lon: -79.4985, radiusKm: 5 },
  { name: "WOODBRIDGE, ON", lat: 43.7788, lon: -79.5986, radiusKm: 4 },
  { name: "WOODSTOCK, ON", lat: 43.1305, lon: -80.7467, radiusKm: 3 },
  // Added after auditing the "Highest risk legs" HOS<99 list (v2.0.11): most legs in that list
  // are long-haul US/cross-border destinations rather than short Ontario hops, so with the
  // original city list, clicking most of them on the Fleet Map showed "No mappable route" even
  // though the feature itself was working correctly — it was a coverage gap, not a bug. These are
  // real ORIG/DEST_ZONE_DESC values that recur in the dataset's own top-risk rankings.
  { name: "CAMPBELLVILLE, ON", lat: 43.4833, lon: -79.95, radiusKm: 3 },
  { name: "BANCROFT, ON", lat: 45.0576, lon: -77.8517, radiusKm: 3 },
  { name: "CARLETON PLACE, ON", lat: 45.1387, lon: -76.1447, radiusKm: 3 },
  { name: "STITTSVILLE, ON", lat: 45.2559, lon: -75.9169, radiusKm: 3 },
  { name: "NEPEAN, ON", lat: 45.3236, lon: -75.7492, radiusKm: 4 },
  { name: "PARRY SOUND, ON", lat: 45.3436, lon: -80.0378, radiusKm: 3 },
  { name: "ELLIOT LAKE, ON", lat: 46.3833, lon: -82.65, radiusKm: 3 },
  // The source data itself spells this "EAST GWILLIMURY" (missing the B in Gwillimbury) — the
  // geofence name has to match that exact spelling for findGeofence()'s substring match to work,
  // even though "East Gwillimbury" is the real town name.
  { name: "EAST GWILLIMURY, ON", lat: 44.1057, lon: -79.4252, radiusKm: 3 },
  { name: "GATINEAU, QC", lat: 45.4765, lon: -75.7013, radiusKm: 5 },
  { name: "SPRINGFIELD, MO", lat: 37.209, lon: -93.2923, radiusKm: 5 },
  { name: "PHOENIX, AZ", lat: 33.4484, lon: -112.074, radiusKm: 8 },
  { name: "KENOSHA, WI", lat: 42.5847, lon: -87.8212, radiusKm: 4 },
  { name: "GROVEPORT, OH", lat: 39.8531, lon: -82.8843, radiusKm: 3 },
  { name: "MORRIS, IL", lat: 41.3556, lon: -88.4276, radiusKm: 3 },
  { name: "RICHMOND, IN", lat: 39.8289, lon: -84.8902, radiusKm: 3 },
  { name: "SAN MARCOS, CA", lat: 33.1434, lon: -117.1661, radiusKm: 3 },
  { name: "SCOTTSVILLE, KY", lat: 36.7529, lon: -86.1866, radiusKm: 3 },
  { name: "DONNA, TX", lat: 26.1637, lon: -98.0536, radiusKm: 3 },
  { name: "FAIRBURN, GA", lat: 33.5651, lon: -84.5941, radiusKm: 3 },
  { name: "MORENO VALLEY, CA", lat: 33.9425, lon: -117.2297, radiusKm: 4 },
  { name: "ORLANDO, FL", lat: 28.5383, lon: -81.3792, radiusKm: 6 },
  { name: "WHITTIER, CA", lat: 33.9792, lon: -118.0328, radiusKm: 4 },
];

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").replace(",ON", ", ON").trim();

export function findGeofence(zoneDesc: string): Geofence | undefined {
  const n = norm(zoneDesc);
  return GEOFENCES.find((g) => n.includes(g.name.split(",")[0]));
}
