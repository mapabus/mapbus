export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
  });

  try {
    const linesParam = url.searchParams.get('lines');
    let selectedLines = null;
    
    if (linesParam) {
      selectedLines = linesParam.split(',').map(l => l.trim());
    }

    const stationsMap = await loadStations(context);

    const timestamp = Date.now();
    const randomSalt = Math.random().toString(36).substring(2, 15);
    const BASE_URL = 'https://rt.buslogic.baguette.pirnet.si/beograd/rt.json';
    const targetUrl = `${BASE_URL}?_=${timestamp}&salt=${randomSalt}`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.entity) {
      return new Response(JSON.stringify({ vehicles: [], tripUpdates: [] }), { status: 200, headers });
    }

    const vehicles = [];
    const tripUpdates = [];

    const vehicleDestinations = {};
    data.entity.forEach(entitet => {
      if (entitet.tripUpdate && entitet.tripUpdate.trip && 
          entitet.tripUpdate.stopTimeUpdate && entitet.tripUpdate.vehicle) {
        const updates = entitet.tripUpdate.stopTimeUpdate;
        const vehicleId = entitet.tripUpdate.vehicle.id;

        if (updates.length > 0 && vehicleId) {
          const lastStopId = updates[updates.length - 1].stopId;
          vehicleDestinations[vehicleId] = lastStopId;
          
          tripUpdates.push({
            vehicleId: vehicleId,
            destination: lastStopId
          });
        }
      }
    });

    data.entity.forEach(entitet => {
      if (entitet.vehicle && entitet.vehicle.position) {
        const info = entitet.vehicle;
        const vehicleLabel = info.vehicle.label;
        const vehicleId = info.vehicle.id;
        let routeId = info.trip.routeId;

        if (!isValidGarageNumber(vehicleLabel)) {
          return;
        }

        if (!routeId || routeId === 'undefined' || routeId === '') {
          const destinationId = vehicleDestinations[vehicleId];
          
          if (destinationId) {
            const detectedRoute = detectRouteByDestination(destinationId, stationsMap);
            if (detectedRoute) {
              routeId = detectedRoute;
              console.log(`Detected route ${detectedRoute} for vehicle ${vehicleLabel} (destination: ${destinationId})`);
            } else {
              console.log(`Could not detect route for vehicle ${vehicleLabel} (destination: ${destinationId})`);
              return;
            }
          } else {
            console.log(`No destination for vehicle ${vehicleLabel}, skipping`);
            return;
          }
        }

        const normalizedRouteId = normalizeRouteId(routeId);

        if (selectedLines && !selectedLines.includes(normalizedRouteId)) {
          return;
        }

        vehicles.push({
          id: vehicleId,
          label: vehicleLabel,
          routeId: routeId,
          startTime: info.trip.startTime,
          lat: parseFloat(info.position.latitude),
          lon: parseFloat(info.position.longitude)
        });
      }
    });

    return new Response(JSON.stringify({
      vehicles: vehicles,
      tripUpdates: tripUpdates,
      timestamp: Date.now()
    }), { status: 200, headers });

  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch vehicle data',
      message: error.message 
    }), { status: 500, headers });
  }
}

async function loadStations(context) {
  try {
    const url = new URL(context.request.url);
    const origin = url.origin;
    
    console.log(`Attempting to load stations from: ${origin}/api/stations`);
    
    const response = await fetch(`${origin}/api/stations`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      }
    });
    
    if (response.ok) {
      const stations = await response.json();
      console.log(`Loaded ${Object.keys(stations).length} stations`);
      return stations;
    }
    
    console.warn('Failed to load stations from API, using fallback');
    return {};
    
  } catch (error) {
    console.error('Error loading stations:', error.message);
    return {};
  }
}

function detectRouteByDestination(stopId, stationsMap) {
  const STATION_IDS = {
    '492': ['29734', '29735', '28344'],
    
    '80': ['21005', '22908'],
    
    '40A': ['21691', '20256']
  };

  const normalizedId = normalizeStopId(stopId);
  
  for (const [route, ids] of Object.entries(STATION_IDS)) {
    if (ids.includes(normalizedId) || ids.includes(stopId)) {
      console.log(`Matched by ID: ${stopId} -> Route ${route}`);
      return route;
    }
  }
  
  if (Object.keys(stationsMap).length > 0) {
    const station = stationsMap[normalizedId];
    
    if (station && station.name) {
      const stationName = station.name.toLowerCase().trim();
      
      if (stationName.includes('šumice') || stationName.includes('sumice') || 
          stationName.includes('mladenovac as')) {
        console.log(`Matched by name: ${station.name} -> Route 492`);
        return '492';
      }
      
      if (stationName.includes('ikea') || stationName.includes('čukarička padina') || 
          stationName.includes('cukaricka padina')) {
        console.log(`Matched by name: ${station.name} -> Route 80`);
        return '80';
      }
      
      if (stationName.includes('banjica 2') || stationName.includes('studentski trg')) {
        console.log(`Matched by name: ${station.name} -> Route 41`);
        return '41';
      }
    }
  }
  
  return null;
}

function normalizeStopId(stopId) {
  if (typeof stopId === 'string' && stopId.length === 5 && stopId.startsWith('2')) {
    let normalized = stopId.substring(1);
    normalized = parseInt(normalized, 10).toString();
    return normalized;
  }
  return stopId;
}

function normalizeRouteId(routeId) {
  if (typeof routeId === 'string') {
    return parseInt(routeId, 10).toString();
  }
  return routeId;
}

function isValidGarageNumber(label) {
  if (!label || typeof label !== 'string') return false;
  
  if (label.startsWith('P')) {
    return label.length >= 6;
  }
  
  return true;
}