export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    console.log('Hourly check triggered at:', new Date().toISOString());
    
    const now = new Date();
    const currentHour = parseInt(now.toLocaleString('en-US', { 
      timeZone: 'Europe/Belgrade', 
      hour: 'numeric', 
      hour12: false 
    }));
    const currentMinute = parseInt(now.toLocaleString('en-US', { 
      timeZone: 'Europe/Belgrade', 
      minute: 'numeric' 
    }));
    
    if (currentHour === 1 && currentMinute < 30) {
      console.log('Resetting departures sheet (scheduled at 01:00)...');
      try {
        const baseUrl = new URL(req.url).origin;
        const resetResponse = await fetch(`${baseUrl}/api/reset-departures`, {
          method: 'GET',
        });
        
        if (resetResponse.ok) {
          console.log('Departures sheet reset successful');
        } else {
          console.log('Departures sheet reset failed');
        }
      } catch (resetError) {
        console.error('Reset error:', resetError.message);
      }
    }
    
    const baseUrl = new URL(req.url).origin;
    const vehiclesResponse = await fetch(`${baseUrl}/api/vehicles`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }
    });

    if (!vehiclesResponse.ok) {
      throw new Error(`Vehicles API failed with status ${vehiclesResponse.status}`);
    }

    const vehiclesData = await vehiclesResponse.json();
    
    if (! vehiclesData || !vehiclesData.vehicles || vehiclesData.vehicles.length === 0) {
      console.log('No vehicles found');
      return new Response('SUCCESS - No vehicles to update', { status: 200 });
    }

    const [stationsResponse, routeNamesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/stations`),
      fetch(`${baseUrl}/route-mapping.json`)
    ]);

    const stationsMap = await stationsResponse.json();
    const routeNamesMap = await routeNamesResponse.json();

    const vehicleDestinations = {};
    if (vehiclesData.tripUpdates) {
      vehiclesData.tripUpdates.forEach(update => {
        vehicleDestinations[update.vehicleId] = update.destination;
      });
    }

    const formattedVehicles = vehiclesData.vehicles.map(vehicle => {
      const destId = vehicleDestinations[vehicle.id] || "Unknown";
      
      let normalizedId = destId;
      if (typeof destId === 'string' && destId.length === 5 && destId.startsWith('2')) {
        normalizedId = destId.substring(1);
        normalizedId = parseInt(normalizedId, 10).toString();
      }
      
      const station = stationsMap[normalizedId];
      const destName = station ? station.name : destId;
      
      let normalizedRouteId = vehicle.routeId;
      if (typeof vehicle.routeId === 'string') {
        normalizedRouteId = parseInt(vehicle.routeId, 10).toString();
      }
      
      const routeDisplayName = routeNamesMap[normalizedRouteId] || normalizedRouteId;
      
      return {
        vehicleLabel: vehicle.label,
        routeDisplayName: routeDisplayName,
        startTime: vehicle.startTime || "N/A",
        destName: destName
      };
    });

    console.log(`Formatted ${formattedVehicles.length} vehicles for update`);

    const updateResponse = await fetch(`${baseUrl}/api/update-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        vehicles: formattedVehicles 
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`Update failed with status ${updateResponse.status}: ${errorText}`);
    }

    const result = await updateResponse.json();
    
    console.log('Hourly update completed:', result);
    
    try {
      const departuresResponse = await fetch(`${baseUrl}/api/update-departures-sheet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (departuresResponse.ok) {
        const departuresResult = await departuresResponse.json();
        console.log('Departures sheet updated:', departuresResult);
      } else {
        console.log('Departures sheet update failed');
      }
    } catch (departuresError) {
      console.error('Departures sheet error:', departuresError.message);
    }
    
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    return new Response(
      `SUCCESS - Updated at ${timestamp} | ` +
      `Vehicles: ${result.totalProcessed || 0} | ` +
      `New: ${result.newVehicles || 0} | ` +
      `Updated: ${result.updatedVehicles || 0}` +
      (currentHour === 1 && currentMinute < 30 ? ' | RESET EXECUTED' : ''),
      { status: 200 }
    );
    
  } catch (error) {
    console.error('Hourly check error:', error);
    
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    return new Response(
      `ERROR - Failed at ${timestamp}: ${error.message}`,
      { status: 500 }
    );
  }
}