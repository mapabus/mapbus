import { google } from 'googleapis';

export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (method === 'GET') {
    const isYesterdayRequest = new URL(req.url).searchParams.get('yesterday') === 'true';
    const sheetName = isYesterdayRequest ? 'Juce' : 'Polasci';
    
    console.log(`=== Reading ${sheetName} Sheet ===`);
    
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });

      const rows = response.data.values || [];
      const routes = [];
      let currentRoute = null;
      let currentDirection = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row[0] || row[0].includes('resetovan')) continue;
        
        if (row[0].startsWith('Linija ')) {
          if (currentRoute) routes.push(currentRoute);
          currentRoute = {
            routeName: row[0].replace('Linija ', '').trim(),
            directions: []
          };
        }
        else if (row[0].startsWith('Smer: ') && currentRoute) {
          currentDirection = {
            directionName: row[0].replace('Smer: ', '').trim(),
            departures: []
          };
          currentRoute.directions.push(currentDirection);
        }
        else if (row[0] === 'Polazak') continue;
        else if (currentDirection && row[0] && row[0].match(/^\d{1,2}:\d{2}/)) {
          currentDirection.departures.push({
            startTime: row[0],
            vehicleLabel: row[1] || '',
            timestamp: row[2] || ''
          });
        }
      }

      if (currentRoute) routes.push(currentRoute);

      return new Response(JSON.stringify({
        success: true,
        routes: routes,
        totalRoutes: routes.length,
        sheetName: sheetName
      }), { status: 200, headers });

    } catch (error) {
      console.error('Read error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), { status: 500, headers });
    }
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  console.log('=== Updating Polasci from Baza Sheet ===');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    console.log('Reading from Baza sheet...');
    const bazaResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Baza!A2:F',
    });

    const bazaRows = bazaResponse.data.values || [];
    
    if (bazaRows.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No data in Baza sheet',
        newDepartures: 0,
        updatedDepartures: 0
      }), { status: 200, headers });
    }

    console.log(`Found ${bazaRows.length} vehicles in Baza`);

    const now = new Date();
    const belgradTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Belgrade' }));
    const todayDate = belgradTime.toLocaleDateString('sr-RS', { 
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    const currentHour = belgradTime.getHours();
    const currentMinute = belgradTime.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    console.log(`Today's date: ${todayDate}, Current time: ${currentHour}:${currentMinute}`);

    const vehicleLatestDeparture = new Map();
    
    bazaRows.forEach(row => {
      const vozilo = row[0] || '';
      const linija = row[1] || '';
      const polazak = row[2] || '';
      const smer = row[3] || '';
      const timestamp = row[4] || '';
      const datumFull = row[5] || '';

      if (!vozilo || !linija || !polazak || !smer) return;

      const datum = datumFull.split(' ')[0].trim();
      
      if (datum !== todayDate) return;
      
      const polazakParts = polazak.split(':');
      const polazakHour = parseInt(polazakParts[0]) || 0;
      const polazakMinute = parseInt(polazakParts[1]) || 0;
      const polazakTimeInMinutes = polazakHour * 60 + polazakMinute;

      const isNightTime = currentHour >= 0 && currentHour < 1;
      const isLateEvening = polazakHour >= 22;

      if (isNightTime && isLateEvening) {
      } else if (polazakTimeInMinutes > currentTimeInMinutes) {
        return;
      }

      const vehicleKey = `${vozilo}|${linija}|${smer}`;
      
      if (!vehicleLatestDeparture.has(vehicleKey)) {
        vehicleLatestDeparture.set(vehicleKey, {
          vozilo,
          linija,
          polazak,
          smer,
          timestamp,
          polazakTimeInMinutes
        });
      } else {
        const existing = vehicleLatestDeparture.get(vehicleKey);
        if (polazakTimeInMinutes > existing.polazakTimeInMinutes) {
          vehicleLatestDeparture.set(vehicleKey, {
            vozilo,
            linija,
            polazak,
            smer,
            timestamp,
            polazakTimeInMinutes
          });
          console.log(`Replacing ${vozilo}: ${existing.polazak} → ${polazak} (later departure)`);
        }
      }
    });

    console.log(`Deduplicated to ${vehicleLatestDeparture.size} unique vehicles`);

    const routeMap = {};
    let processedToday = 0;

    bazaRows.forEach(row => {
      const vozilo = row[0] || '';
      const linija = row[1] || '';
      const polazak = row[2] || '';
      const smer = row[3] || '';
      const timestamp = row[4] || '';
      const datumFull = row[5] || '';

      if (!vozilo || !linija || !polazak || !smer) return;

      const datum = datumFull.split(' ')[0].trim();
      
      if (datum !== todayDate) return;

      if (!routeMap[linija]) {
        routeMap[linija] = {};
      }
      
      if (!routeMap[linija][smer]) {
        routeMap[linija][smer] = [];
      }
      
      routeMap[linija][smer].push({
        startTime: polazak,
        vehicleLabel: vozilo,
        timestamp: timestamp
      });
      
      processedToday++;
    });

    console.log(`Processed ${processedToday} valid departures`);
    console.log(`Grouped into ${Object.keys(routeMap).length} routes`);

    if (Object.keys(routeMap).length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No vehicles seen today',
        newDepartures: 0,
        updatedDepartures: 0
      }), { status: 200, headers });
    }

    const sheetName = 'Polasci';
    let sheetId = null;
    
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );
    
    if (existingSheet) {
      sheetId = existingSheet.properties.sheetId;
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { rowCount: 60000, columnCount: 10 }
              }
            }
          }]
        }
      });
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
    }

    let existingData = [];
    const existingDeparturesMap = new Map();
    const routeStructure = new Map();
    
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });
      existingData = readResponse.data.values || [];

      let currentRoute = null;
      let currentDirection = null;
      
      for (let i = 0; i < existingData.length; i++) {
        const row = existingData[i];
        
        if (row[0] && row[0].startsWith('Linija ')) {
          currentRoute = row[0].replace('Linija ', '').trim();
          if (!routeStructure.has(currentRoute)) {
            routeStructure.set(currentRoute, new Map());
          }
        } 
        else if (currentRoute && row[0] && row[0].startsWith('Smer: ')) {
          currentDirection = row[0].replace('Smer: ', '').trim();
          if (!routeStructure.get(currentRoute).has(currentDirection)) {
            routeStructure.get(currentRoute).set(currentDirection, []);
          }
        }
        else if (currentRoute && currentDirection && row[0] && row[0].match(/^\d{1,2}:\d{2}/)) {
          const startTime = row[0];
          const vehicleLabel = row[1] || '';
          const oldTimestamp = row[2] || '';
          
          const key = `${currentRoute}|${currentDirection}|${startTime}|${vehicleLabel}`;
          existingDeparturesMap.set(key, {
            row: i,
            startTime,
            vehicleLabel,
            timestamp: oldTimestamp
          });
          
          routeStructure.get(currentRoute).get(currentDirection).push({
            startTime,
            vehicleLabel,
            timestamp: oldTimestamp
          });
        }
      }
      
      console.log(`Mapped ${existingDeparturesMap.size} existing departures`);
      
    } catch (readError) {
      console.log('No existing data, starting fresh');
    }

    let updatedCount = 0;
    let newCount = 0;

    for (let route in routeMap) {
      const directions = routeMap[route];
      
      if (!routeStructure.has(route)) {
        routeStructure.set(route, new Map());
      }
      
      for (let direction in directions) {
        if (!routeStructure.get(route).has(direction)) {
          routeStructure.get(route).set(direction, []);
        }
        
        const departures = directions[direction];
        const existingDepartures = routeStructure.get(route).get(direction);
        
        departures.forEach(dep => {
          const key = `${route}|${direction}|${dep.startTime}|${dep.vehicleLabel}`;
          
          if (existingDeparturesMap.has(key)) {
            const existing = existingDeparturesMap.get(key);
            const index = existingDepartures.findIndex(
              d => d.startTime === dep.startTime && d.vehicleLabel === dep.vehicleLabel
            );
            if (index !== -1) {
              existingDepartures[index].timestamp = dep.timestamp;
              updatedCount++;
            }
          } else {
            existingDepartures.push(dep);
            newCount++;
          }
        });
        
        existingDepartures.sort((a, b) => a.startTime.localeCompare(b.startTime));
      }
    }

    console.log(`Updates: ${updatedCount}, New: ${newCount}`);

    const allRows = [];
    const formatRequests = [];
    let currentRow = 0;

    const sortedRoutes = Array.from(routeStructure.keys()).sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });

    for (const route of sortedRoutes) {
      allRows.push([`Linija ${route}`]);
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: currentRow,
            endRowIndex: currentRow + 1,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
              textFormat: {
                bold: true,
                fontSize: 12
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
      });

      currentRow++;

      const directions = routeStructure.get(route);
      const sortedDirections = Array.from(directions.keys()).sort();

      for (const direction of sortedDirections) {
        allRows.push([`Smer: ${direction}`]);
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: currentRow,
              endRowIndex: currentRow + 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: {
                  italic: true,
                  fontSize: 11
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });

        currentRow++;

        allRows.push(['Polazak', 'Vozilo', 'Vreme upisa']);

        currentRow++;

        const departures = directions.get(direction);
        departures.forEach(dep => {
          allRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp]);
          currentRow++;
        });

        allRows.push([]); // Prazan red između smerova
        currentRow++;
      }

      allRows.push([]); // Prazan red između linija
      currentRow++;
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A1:J`
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: {
        values: allRows
      }
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: formatRequests
      }
    });

    console.log('=== Update Complete ===');

    return new Response(JSON.stringify({
      success: true,
      newDepartures: newCount,
      updatedDepartures: updatedCount,
      totalRoutes: routeStructure.size
    }), { status: 200, headers });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Unexpected error',
      details: error.message
    }), { status: 500, headers });
  }
}