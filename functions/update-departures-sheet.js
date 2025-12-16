async function getAccessToken(context) {
  // Isti helper
}

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
    const isYesterdayRequest = url.searchParams.get('yesterday') === 'true';
    const sheetName = isYesterdayRequest ? 'Juce' : 'Polasci';
    
    console.log(`=== Reading ${sheetName} Sheet ===`);
    
    try {
      const access_token = await getAccessToken(context);
      const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:J`, {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to read sheet');
      }

      const data = await response.json();
      const rows = data.values || [];
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
    const access_token = await getAccessToken(context);
    const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

    console.log('Reading from Baza sheet...');
    const bazaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Baza!A2:F`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!bazaResponse.ok) {
      throw new Error('Failed to read Baza sheet');
    }

    const bazaData = await bazaResponse.json();
    const bazaRows = bazaData.values || [];
    
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
    
    const spreadsheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const spreadsheetData = await spreadsheetResponse.json();
    const existingSheet = spreadsheetData.sheets.find(s => s.properties.title === sheetName);
    
    if (existingSheet) {
      sheetId = existingSheet.properties.sheetId;
    } else {
      const addSheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: { rowCount: 60000, columnCount: 10 }
              }
            }
          }]
        })
      });
      const addSheetData = await addSheetResponse.json();
      sheetId = addSheetData.replies[0].addSheet.properties.sheetId;
    }

    let existingData = [];
    const existingDeparturesMap = new Map();
    const routeStructure = new Map();
    
    const readResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:J`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (readResponse.ok) {
      const readData = await readResponse.json();
      existingData = readData.values || [];

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
    } else {
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

        const departures = directions.get(direction);
        departures.forEach(dep => {
          allRows.push([
            dep.startTime,
            dep.vehicleLabel,
            dep.timestamp
          ]);
          currentRow++;
        });
      }
    }

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:J:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}` }
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: allRows
      })
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: formatRequests
      })
    });

    return new Response(JSON.stringify({
      success: true,
      newDepartures: newCount,
      updatedDepartures: updatedCount,
      totalRoutes: sortedRoutes.length
    }), { status: 200, headers });

  } catch (error) {
    console.error('Update error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers });
  }
}
