async function getAccessToken(context) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: context.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };

  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signatureInput = `${encode(header)}.${encode(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(context.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '').trim()), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signatureInput));
  const jwt = `${signatureInput}.${encode(Array.from(new Uint8Array(signature)))}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to get access token');
  }

  const { access_token } = await tokenResponse.json();
  return access_token;
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
