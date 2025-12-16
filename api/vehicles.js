export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  try {
    const linesParam = req.query.lines;
    let selectedLines = null;
    
    if (linesParam) {
      selectedLines = linesParam.split(',').map(l => l.trim());
    }

    // Pokušaj učitati stations map
    const stationsMap = await loadStations(req);

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
      return res.status(200).json({ vehicles: [], tripUpdates: [] });
    }

    const vehicles = [];
    const tripUpdates = [];

    // Prvo prikupi sve trip updates da bismo imali destinacije
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

    // Zatim obradi vozila
    data.entity.forEach(entitet => {
      if (entitet.vehicle && entitet.vehicle.position) {
        const info = entitet.vehicle;
        const vehicleLabel = info.vehicle.label;
        const vehicleId = info.vehicle.id;
        let routeId = info.trip.routeId;

        if (!isValidGarageNumber(vehicleLabel)) {
          return;
        }

        // ============ NOVA LOGIKA ZA UNDEFINED LINIJE ============
        if (!routeId || routeId === 'undefined' || routeId === '') {
          const destinationId = vehicleDestinations[vehicleId];
          
          if (destinationId) {
            const detectedRoute = detectRouteByDestination(destinationId, stationsMap);
            if (detectedRoute) {
              routeId = detectedRoute;
              console.log(`✓ Detected route ${detectedRoute} for vehicle ${vehicleLabel} (destination: ${destinationId})`);
            } else {
              console.log(`⚠ Could not detect route for vehicle ${vehicleLabel} (destination: ${destinationId})`);
              return; // Skip vozila sa nepoznatom linijom
            }
          } else {
            console.log(`⚠ No destination for vehicle ${vehicleLabel}, skipping`);
            return;
          }
        }
        // =========================================================

        const normalizedRouteId = normalizeRouteId(routeId);

        // Filter by selected lines if provided
        if (selectedLines && !selectedLines.includes(normalizedRouteId)) {
          return;
        }

        vehicles.push({
          id: vehicleId,
          label: vehicleLabel,
          routeId: routeId, // Koristi originalni routeId (može biti detektovani)
          startTime: info.trip.startTime,
          lat: parseFloat(info.position.latitude),
          lon: parseFloat(info.position.longitude)
        });
      }
    });

    res.status(200).json({
      vehicles: vehicles,
      tripUpdates: tripUpdates,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ 
      error: 'Failed to fetch vehicle data',
      message: error.message 
    });
  }
}

// ============ POBOLJŠANA FUNKCIJA ZA UČITAVANJE STANICA ============
async function loadStations(req) {
  try {
    // Pokušaj 1: iz lokalnog procesa (API route)
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['host'];
    const baseUrl = `${protocol}://${host}`;
    
    console.log(`Attempting to load stations from: ${baseUrl}/api/stations`);
    
    const response = await fetch(`${baseUrl}/api/stations`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      }
    });
    
    if (response.ok) {
      const stations = await response.json();
      console.log(`✓ Loaded ${Object.keys(stations).length} stations`);
      return stations;
    }
    
    console.warn('Failed to load stations from API, using fallback');
    return {};
    
  } catch (error) {
    console.error('Error loading stations:', error.message);
    return {};
  }
}

// ============ POBOLJŠANA FUNKCIJA ZA DETEKCIJU LINIJE ============
function detectRouteByDestination(stopId, stationsMap) {
  // HARDCODED ID-evi stanica kao fallback
  const STATION_IDS = {
    // Linija 492
    '492': ['29734', '29735', '28344'],  // Šumice ili Mladenovac AS
    
    // Linija 80
    '80': ['21005', '22908'],  // Ikea ili Čukarička Padina
    
    // Linija 40A
    '40A': ['21691', '20256']   // Banjica 2 ili Studentski Trg
  };

  const normalizedId = normalizeStopId(stopId);
  
  // Proveri hardcoded ID-eve prvo
  for (const [route, ids] of Object.entries(STATION_IDS)) {
    if (ids.includes(normalizedId) || ids.includes(stopId)) {
      console.log(`✓ Matched by ID: ${stopId} -> Route ${route}`);
      return route;
    }
  }
  
  // Ako postoji stations map, proveri i po nazivu
  if (Object.keys(stationsMap).length > 0) {
    const station = stationsMap[normalizedId];
    
    if (station && station.name) {
      const stationName = station.name.toLowerCase().trim();
      
      // Linija 492: Šumice ili Mladenovac AS
      if (stationName.includes('šumice') || stationName.includes('sumice') || 
          stationName.includes('mladenovac as')) {
        console.log(`✓ Matched by name: ${station.name} -> Route 492`);
        return '492';
      }
      
      // Linija 80: Ikea ili Čukarička Padina
      if (stationName.includes('ikea') || stationName.includes('čukarička padina') || 
          stationName.includes('cukaricka padina')) {
        console.log(`✓ Matched by name: ${station.name} -> Route 80`);
        return '80';
      }
      
      // Linija 41: Banjica 2 ili Studentski Trg
      if (stationName.includes('banjica 2') || stationName.includes('studentski trg')) {
        console.log(`✓ Matched by name: ${station.name} -> Route 41`);
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
