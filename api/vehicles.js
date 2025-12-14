export default async function handler(req, res) {
  const isAuthenticated = req.session?.user || req.cookies?.authToken;
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' }); // Vrati JSON grešku
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  try {

    const linesParam = req.query.lines;
    let selectedLines = null;
    
    if (linesParam) {
      selectedLines = linesParam.split(',').map(l => l.trim());
    }

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

    data.entity.forEach(entitet => {
      // Process vehicle positions
      if (entitet.vehicle && entitet.vehicle.position) {
        const info = entitet.vehicle;
        const vehicleLabel = info.vehicle.label;
        const routeId = normalizeRouteId(info.trip.routeId);


        if (!isValidGarageNumber(vehicleLabel)) {
          return;
        }

        // Filter by selected lines if provided
        if (selectedLines && !selectedLines.includes(routeId)) {
          return;
        }

        vehicles.push({
          id: info.vehicle.id,
          label: vehicleLabel,
          routeId: info.trip.routeId,
          startTime: info.trip.startTime,
          lat: parseFloat(info.position.latitude),
          lon: parseFloat(info.position.longitude)
        });
      }

      // Process trip updates
      // Process trip updates
      if (entitet.tripUpdate && entitet.tripUpdate.trip && 
          entitet.tripUpdate.stopTimeUpdate && entitet.tripUpdate.vehicle) {
        const updates = entitet.tripUpdate.stopTimeUpdate;
        const vehicleId = entitet.tripUpdate.vehicle.id;

        if (updates.length > 0 && vehicleId) {
          const lastStopId = updates[updates.length - 1].stopId;
          
          // Extract delay from first stop
          let delay = undefined;
          if (updates[0].arrival && updates[0].arrival.delay !== undefined) {
            delay = updates[0].arrival.delay;
          }
          
          tripUpdates.push({
            vehicleId: vehicleId,
            destination: lastStopId,
            delay: delay
          });
        }
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
