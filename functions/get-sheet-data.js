async function getAccessToken(context) {
  // Isti helper kao gore
  // (Kopiraj iz auth.js da bi fajl bio samostalan)
}

export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const access_token = await getAccessToken(context);
    const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

    const sheetName = 'Baza';
    console.log(`Reading from sheet: ${sheetName}`);

    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A2:F`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to read sheet');
    }

    const data = await response.json();
    const rows = data.values;

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        vehicles: [],
        count: 0,
        sheetName: sheetName
      }), { status: 200 });
    }

    const vehicles = rows.map(row => ({
      vozilo: row[0] || '',
      linija: row[1] || '',
      polazak: row[2] || '',
      smer: row[3] || '',
      timestamp: row[4] || '',
      datum: row[5] || ''
    }));

    return new Response(JSON.stringify({ 
      success: true, 
      vehicles: vehicles,
      count: vehicles.length,
      lastUpdate: vehicles[vehicles.length - 1]?.timestamp || null,
      sheetName: sheetName
    }), { status: 200 });

  } catch (error) {
    console.error('Google Sheets error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to read sheet',
      details: error.message 
    }), { status: 500 });
  }
}
