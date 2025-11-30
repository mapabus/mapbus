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

    console.log(`Today's date: ${todayDate}`);

    // Grupisanje po linijama i smerovima - samo današnja vozila
    const routeMap = {};
    let skippedOld = 0;
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

    console.log(`Processed ${processedToday} today's vehicles, skipped ${skippedOld} old vehicles`);
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

    // KORAK 4: Integracija novih podataka
    let updatedCount = 0;
    let newCount = 0;
    const updateRequests = [];
    const appendRows = [];

    // Sortiraj linije numerički
    const sortedRoutes = Object.keys(routeMap).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    for (let route of sortedRoutes) {
      const directions = routeMap[route];
      
      if (!routeStructure.has(route)) {
        // Nova linija
        appendRows.push([`Linija ${route}`, '', '', '', '', '', '', '', '', '']);
        routeStructure.set(route, new Map());
        
        const sortedDirections = Object.keys(directions).sort();
        
        for (let direction of sortedDirections) {
          routeStructure.get(route).set(direction, []);
          appendRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
          appendRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
          
          const departures = directions[direction].sort((a, b) => 
            a.startTime.localeCompare(b.startTime)
          );
          
          departures.forEach(dep => {
            appendRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp, '', '', '', '', '', '', '']);
            routeStructure.get(route).get(direction).push(dep);
            newCount++;
          });
          
          appendRows.push(['', '', '', '', '', '', '', '', '', '']);
        }
        
        appendRows.push(['', '', '', '', '', '', '', '', '', '']);
      }
      else {
        // Postojeća linija
        for (let direction in directions) {
          
          if (!routeStructure.get(route).has(direction)) {
            // Novi smer
            routeStructure.get(route).set(direction, []);
            appendRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
            appendRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
            
            const departures = directions[direction].sort((a, b) => 
              a.startTime.localeCompare(b.startTime)
            );
            
            departures.forEach(dep => {
              appendRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp, '', '', '', '', '', '', '']);
              routeStructure.get(route).get(direction).push(dep);
              newCount++;
            });
            
            appendRows.push(['', '', '', '', '', '', '', '', '', '']);
          }
          else {
            // Postojeći smer - proveri polaske
            const departures = directions[direction];
            
            departures.forEach(dep => {
              const key = `${route}|${direction}|${dep.startTime}|${dep.vehicleLabel}`;
              
              if (existingDeparturesMap.has(key)) {
                // Ažuriraj timestamp
                const existing = existingDeparturesMap.get(key);
                updateRequests.push({
                  range: `${sheetName}!C${existing.row + 1}`,
                  values: [[dep.timestamp]]
                });
                updatedCount++;
              } else {
                // Novi polazak
                appendRows.push([dep.startTime, dep.vehicleLabel, dep.timestamp, '', '', '', '', '', '', '']);
                routeStructure.get(route).get(direction).push(dep);
                newCount++;
              }
            });
          }
        }
      }
    }

    console.log(`Updates: ${updatedCount}, New: ${newCount}`);

    // KORAK 5: Primeni izmene
    if (updateRequests.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updateRequests
        }
      });
      console.log(`✓ Updated ${updateRequests.length} timestamps`);
    }

    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:J`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: appendRows }
      });
      console.log(`✓ Appended ${appendRows.length} new rows`);

      // Formatiranje novih redova
      const formatRequests = [];
      const startRow = existingData.length;
      
      for (let i = 0; i < appendRows.length; i++) {
        const row = appendRows[i];
        const actualRow = startRow + i;
        
        if (row[0] && row[0].startsWith('Linija ')) {
          formatRequests.push({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: actualRow,
                endRowIndex: actualRow + 1,
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
        } else if (row[0] && row[0].startsWith('Smer: ')) {
          formatRequests.push({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: actualRow,
                endRowIndex: actualRow + 1,
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
        } else if (row[0] === 'Polazak') {
          formatRequests.push({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: actualRow,
                endRowIndex: actualRow + 1,
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
        }
      }

      if (formatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: { requests: formatRequests }
        });
        console.log(`✓ Applied ${formatRequests.length} format rules`);
      }
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
      totalNewRows: appendRows.length,
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
