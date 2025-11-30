import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== GET za čitanje podataka iz Polasci sheet-a =====
  if (req.method === 'GET') {
    console.log('=== Reading Polasci Sheet ===');
    
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
      const sheetName = 'Polasci';

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

      return res.status(200).json({
        success: true,
        routes: routes,
        totalRoutes: routes.length
      });

    } catch (error) {
      console.error('Read error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // ===== POST za ažuriranje - čita iz Baza sheet-a =====
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    // KORAK 1: Pročitaj podatke iz Baza sheet-a
    console.log('Reading from Baza sheet...');
    const bazaResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Baza!A2:F',
    });

    const bazaRows = bazaResponse.data.values || [];
    
    if (bazaRows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No data in Baza sheet',
        newDepartures: 0,
        updatedDepartures: 0
      });
    }

    console.log(`Found ${bazaRows.length} vehicles in Baza`);

    // Datum danas (u Beogradu)
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

    // Grupisanje po linijama i smerovima - samo današnja vozila sa prošlim polascima
    const routeMap = {};
    let skippedOld = 0;
    let skippedFuture = 0;
    let processedToday = 0;
    
    bazaRows.forEach(row => {
      const vozilo = row[0] || '';
      const linija = row[1] || '';
      const polazak = row[2] || '';
      const smer = row[3] || '';
      const timestamp = row[4] || '';
      const datumFull = row[5] || ''; // Ovo sadrži "30.11.2025. 10:36:26"

      if (!linija || !polazak || !smer) return;

      // Izvuci samo datum deo (pre prvog razmaka ili cele ako nema razmaka)
      const datum = datumFull.split(' ')[0].trim();
      
      // Proveri da li je vozilo viđeno danas
      if (datum !== todayDate) {
        skippedOld++;
        return;
      }
      
      // Proveri da li je polazak u budućnosti
      // Format polaska je "HH:MM:SS" ili "HH:MM"
      const polazakParts = polazak.split(':');
      const polazakHour = parseInt(polazakParts[0]) || 0;
      const polazakMinute = parseInt(polazakParts[1]) || 0;
      const polazakTimeInMinutes = polazakHour * 60 + polazakMinute;
      
      // Ako je polazak u budućnosti, preskoči
      if (polazakTimeInMinutes > currentTimeInMinutes) {
        skippedFuture++;
        return;
      }
      
      processedToday++;

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
    });

    console.log(`Processed ${processedToday} valid departures`);
    console.log(`Skipped: ${skippedOld} old dates, ${skippedFuture} future departures`);
    console.log(`Grouped into ${Object.keys(routeMap).length} routes`);

    if (Object.keys(routeMap).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No vehicles seen today',
        newDepartures: 0,
        updatedDepartures: 0
      });
    }

    // KORAK 2: Proveri/kreiraj Polasci sheet
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
                gridProperties: { rowCount: 10000, columnCount: 10 }
              }
            }
          }]
        }
      });
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
    }

    // KORAK 3: Pročitaj postojeće podatke iz Polasci
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

    // KORAK 4: Integracija novih podataka u strukturu
    let updatedCount = 0;
    let newCount = 0;

    for (let route in routeMap) {
      const directions = routeMap[route];
      
      if (!routeStructure.has(route)) {
        // Nova linija
        routeStructure.set(route, new Map());
      }
      
      for (let direction in directions) {
        if (!routeStructure.get(route).has(direction)) {
          // Novi smer
          routeStructure.get(route).set(direction, []);
        }
        
        // Dodaj/ažuriraj polaske
        const departures = directions[direction];
        const existingDepartures = routeStructure.get(route).get(direction);
        
        departures.forEach(dep => {
          const key = `${route}|${direction}|${dep.startTime}|${dep.vehicleLabel}`;
          
          if (existingDeparturesMap.has(key)) {
            // Ažuriraj timestamp postojećeg polaska
            const existing = existingDeparturesMap.get(key);
            const index = existingDepartures.findIndex(
              d => d.startTime === dep.startTime && d.vehicleLabel === dep.vehicleLabel
            );
            if (index !== -1) {
              existingDepartures[index].timestamp = dep.timestamp;
              updatedCount++;
            }
          } else {
            // Dodaj novi polazak
            existingDepartures.push(dep);
            newCount++;
          }
        });
        
        // Sortiraj polaske po vremenu
        existingDepartures.sort((a, b) => a.startTime.localeCompare(b.startTime));
      }
    }

    console.log(`Updates: ${updatedCount}, New: ${newCount}`);

    // KORAK 5: Regeneriši ceo sheet sa ažuriranim podacima
    const allRows = [];
    const formatRequests = [];
    let currentRow = 0;

    // Sortiraj linije numerički
    const sortedRoutes = Array.from(routeStructure.keys()).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    for (let route of sortedRoutes) {
      // Red za liniju
      allRows.push([`Linija ${route}`, '', '', '', '', '', '', '', '', '']);
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
              backgroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                fontSize: 14,
                bold: true
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
      });
      currentRow++;

      const directions = routeStructure.get(route);
      const sortedDirections = Array.from(directions.keys()).sort();

      for (let direction of sortedDirections) {
        // Red za smer
        allRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
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
                backgroundColor: { red: 0.85, green: 0.92, blue: 0.95 },
                textFormat: {
                  foregroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
                  fontSize: 12,
                  bold: true
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
        currentRow++;

        // Red za header
        allRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: currentRow,
              endRowIndex: currentRow + 1,
              startColumnIndex: 0,
              endColumnIndex: 3
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: { fontSize: 10, bold: true }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        });
        currentRow++;

        // Redovi za polaske (već sortirani)
        const departures = directions.get(direction);
        departures.forEach(dep => {
          allRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp, '', '', '', '', '', '', '']);
          currentRow++;
        });

        // Prazan red posle smera
        allRows.push(['', '', '', '', '', '', '', '', '', '']);
        currentRow++;
      }

      // Prazan red posle linije
      allRows.push(['', '', '', '', '', '', '', '', '', '']);
      currentRow++;
    }

    // Obriši postojeće podatke i upiši nove
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:J`
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: { values: allRows }
    });
    console.log(`✓ Wrote ${allRows.length} rows to sheet`);

    // Primeni formatiranje
    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: formatRequests }
      });
      console.log(`✓ Applied ${formatRequests.length} format rules`);
    }

    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    console.log('=== Update Complete ===');

    res.status(200).json({ 
      success: true, 
      newDepartures: newCount,
      updatedDepartures: updatedCount,
      totalRows: allRows.length,
      timestamp,
      sheetUsed: sheetName
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Update failed',
      details: error.message
    });
  }
}
