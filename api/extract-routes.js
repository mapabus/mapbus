export default async function handler(req, res) {
  try {
    // Učitaj JSON sa URL-a
    const response = await fetch('https://rt.buslogic.baguette.pirnet.si/beograd/rt.json');
    const data = await response.json();
    
    const routeIds = new Set();
    const examples = [];
    
    if (data && data.entity) {
      data.entity.forEach(entity => {
        // Izvuci routeId iz vehicle
        if (entity.vehicle && entity.vehicle.trip && entity.vehicle.trip.routeId) {
          const routeId = entity.vehicle.trip.routeId;
          routeIds.add(routeId);
          
          // Sačuvaj primer za analizu
          if (examples.length < 50) {
            examples.push({
              routeId: routeId,
              vehicleLabel: entity.vehicle.vehicle?.label,
              tripId: entity.vehicle.trip?.tripId
            });
          }
        }
      });
    }
    
    const sortedRoutes = Array.from(routeIds).sort();
    
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      totalUniqueRoutes: sortedRoutes.length,
      allRouteIds: sortedRoutes,
      examples: examples,
      // Grupiši po dužini
      byLength: {
        short: sortedRoutes.filter(r => r.toString().length <= 3),
        medium: sortedRoutes.filter(r => r.toString().length === 4),
        long: sortedRoutes.filter(r => r.toString().length === 5),
        veryLong: sortedRoutes.filter(r => r.toString().length > 5)
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
