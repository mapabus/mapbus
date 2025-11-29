// api/hourly-check.js
// Endpoint koji će UptimeRobot pozivati svaki sat

export default async function handler(req, res) {
  // Dozvoli samo GET zahteve
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🕐 Hourly check triggered at:', new Date().toISOString());
    
    // Pozovi postojeći update-sheet endpoint
    const baseUrl = `https://${req.headers.host}`;
    const updateResponse = await fetch(`${baseUrl}/api/update-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trigger: 'uptimerobot-hourly',
        timestamp: new Date().toISOString()
      })
    });

    if (!updateResponse.ok) {
      throw new Error(`Update failed with status ${updateResponse.status}`);
    }

    const result = await updateResponse.json();
    
    console.log('✅ Hourly update completed:', result);
    
    // Vrati odgovor sa ključnom rečju "SUCCESS" za UptimeRobot
    return res.status(200).send(
      `SUCCESS - Updated at ${new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })} | ` +
      `Vehicles: ${result.totalProcessed || 0} | ` +
      `New: ${result.newVehicles || 0} | ` +
      `Updated: ${result.updatedVehicles || 0}`
    );
    
  } catch (error) {
    console.error('❌ Hourly check error:', error);
    
    // Vrati ERROR da UptimeRobot zna da nešto nije u redu
    return res.status(500).send(
      `ERROR - Failed at ${new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })}: ${error.message}`
    );
  }
}
