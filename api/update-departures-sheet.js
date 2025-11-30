import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== GET za čitanje podataka =====
  if (req.method === 'GET') {
    console.log('=== Departures Sheet Read Request ===');
    
    try {
      const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
      const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
      const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

      if (!clientEmail || !privateKey || !spreadsheetId) {
        return res.status(500).json({ 
          error: 'Missing environment variables'
        });
      }

      let formattedPrivateKey = privateKey;
      if (privateKey.includes('\\n')) {
        formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
      }

      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: formattedPrivateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName = 'Polasci';

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });

      const rows = response.data.values || [];
      console.log(`Read ${rows.length} rows from sheet`);

      const routes = [];
      let currentRoute = null;
      let currentDirection = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row[0] || row[0].includes('resetovan')) continue;
        
        if (row[0].startsWith('Linija ')) {
          if (currentRoute) {
            routes.push(currentRoute);
          }
          
          currentRoute = {
            routeName: row[0].replace('Linija ', '').trim(),
            directions: []
          };
          currentDirection = null;
        }
        else if (row[0].startsWith('Smer: ')) {
          if (currentRoute) {
            currentDirection = {
              directionName: row[0].replace('Smer: ', '').trim(),
              departures: []
            };
            currentRoute.directions.push(currentDirection);
          }
        }
        else if (row[0] === 'Polazak') {
          continue;
        }
        else if (currentDirection && row[0] && row[0].match(/^\d{1,2}:\d{2}/)) {
          currentDirection.departures.push({
            startTime: row[0],
            vehicleLabel: row[1] || '',
            timestamp: row[2] || ''
          });
        }
      }

      if (currentRoute) {
        routes.push(currentRoute);
      }

      console.log(`Parsed ${routes.length} routes`);

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

  // ===== POST za kumulativno ažuriranje (BEZ BRISANJA) =====
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Departures Sheet Cumulative Update Request ===');
  
  try {
    const { vehicles } = req.body;

    if (!vehicles || !Array.isArray(vehicles)) {
      console.error('Invalid data format');
      return res.status(400).json({ error: 'Invalid data format' });
    }

    console.log(`Received ${vehicles.length} vehicles for departure tracking`);

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return res.status(500).json({ 
        error: 'Missing environment variables'
      });
    }

    let formattedPrivateKey = privateKey;
    if (privateKey.includes('\\n')) {
      formattedPrivateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: formattedPrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const now = new Date();
    const timestamp = now.toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Grupisanje novih vozila po linijama
    const newRouteMap = {};
    
    vehicles.forEach(v => {
      const route = v.routeDisplayName || v.routeId;
      const destName = v.destName || 'Unknown';
      const vehicleLabel = v.vehicleLabel || '';
      const startTime = v.startTime || 'N/A';
      
      if (!newRouteMap[route]) {
        newRouteMap[route] = {};
      }
      
      if (!newRouteMap[route][destName]) {
        newRouteMap[route][destName] = [];
      }
      
      newRouteMap[route][destName].push({
        startTime: startTime,
        vehicleLabel: vehicleLabel,
        timestamp: timestamp
      });
    });

    console.log(`Grouped into ${Object.keys(newRouteMap).length} routes`);

    // Proveri/Kreiraj sheet "Polasci"
    const sheetName = 'Polasci';
    let sheetId = null;
    
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheet = spreadsheet.data.sheets.find(
        s => s.properties.title === sheetName
      );
      
      if (existingSheet) {
        sheetId = existingSheet.properties.sheetId;
        console.log(`✓ Sheet "${sheetName}" exists (ID: ${sheetId})`);
      } else {
        const addSheetResponse = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: {
                    rowCount: 10000,
                    columnCount: 10
                  }
                }
              }
            }]
          }
        });
        
        sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
        console.log(`✓ Created new sheet "${sheetName}" (ID: ${sheetId})`);
      }
    } catch (error) {
      console.error('Error checking/creating sheet:', error.message);
      throw error;
    }

    // ===== KLJUČNA PROMENA: Pročitaj postojeće podatke i mapiraj ih =====
    let existingData = [];
    const existingDeparturesMap = new Map(); // Key: "route|direction|startTime|vehicle"
    const routeStructure = new Map(); // Struktura: route -> direction -> departures[]
    
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });
      existingData = readResponse.data.values || [];
      console.log(`Found ${existingData.length} existing rows`);

      // Parsiranje postojećih podataka
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

    // ===== Integracija novih podataka sa postojećima =====
    let updatedCount = 0;
    let newCount = 0;
    const updateRequests = [];
    const appendRows = [];

    // Prolazak kroz nove podatke
    for (let route in newRouteMap) {
      const directions = newRouteMap[route];
      
      // Ako linija ne postoji, dodaj celu strukturu
      if (!routeStructure.has(route)) {
        console.log(`New route: ${route}`);
        routeStructure.set(route, new Map());
        
        // Dodaj header za novu liniju
        appendRows.push([`Linija ${route}`, '', '', '', '', '', '', '', '', '']);
        
        for (let direction in directions) {
          routeStructure.get(route).set(direction, []);
          
          appendRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
          appendRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
          
          const departures = directions[direction].sort((a, b) => 
            a.startTime.localeCompare(b.startTime)
          );
          
          departures.forEach(dep => {
            appendRows.push([
              dep.startTime,
              dep.vehicleLabel,
              dep.timestamp,
              '', '', '', '', '', '', ''
            ]);
            
            routeStructure.get(route).get(direction).push(dep);
            newCount++;
          });
          
          appendRows.push(['', '', '', '', '', '', '', '', '', '']);
        }
        
        appendRows.push(['', '', '', '', '', '', '', '', '', '']);
      }
      // Ako linija postoji, proveri smerove i polaske
      else {
        for (let direction in directions) {
          
          // Ako smer ne postoji, dodaj ga
          if (!routeStructure.get(route).has(direction)) {
            console.log(`New direction: ${route} -> ${direction}`);
            routeStructure.get(route).set(direction, []);
            
            // Pronađi gde da ubacimo novi smer (nakon poslednjeg smera te linije)
            // Za sada samo append na kraj
            appendRows.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
            appendRows.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
            
            const departures = directions[direction].sort((a, b) => 
              a.startTime.localeCompare(b.startTime)
            );
            
            departures.forEach(dep => {
              appendRows.push([
                dep.startTime,
                dep.vehicleLabel,
                dep.timestamp,
                '', '', '', '', '', '', ''
              ]);
              
              routeStructure.get(route).get(direction).push(dep);
              newCount++;
            });
            
            appendRows.push(['', '', '', '', '', '', '', '', '', '']);
          }
          // Smer postoji, proveri pojedinačne polaske
          else {
            const departures = directions[direction];
            
            departures.forEach(dep => {
              const key = `${route}|${direction}|${dep.startTime}|${dep.vehicleLabel}`;
              
              // Ako polazak već postoji, ažuriraj samo timestamp
              if (existingDeparturesMap.has(key)) {
                const existing = existingDeparturesMap.get(key);
                updateRequests.push({
                  range: `${sheetName}!C${existing.row + 1}`,
                  values: [[dep.timestamp]]
                });
                updatedCount++;
              }
              // Ako je novi polazak, dodaj ga
              else {
                // Dodajemo na kraj smera - u appendRows
                // (Alternativa: insert na pravo mesto sa sortiranjem)
                appendRows.push([
                  dep.startTime,
                  dep.vehicleLabel,
                  dep.timestamp,
                  '', '', '', '', '', '', ''
                ]);
                
                routeStructure.get(route).get(direction).push(dep);
                newCount++;
              }
            });
          }
        }
      }
    }

    console.log(`Updates: ${updatedCount}, New departures: ${newCount}`);

    // ===== Primeni izmene =====
    
    // 1. Ažuriraj timestamp-ove postojećih polazaka
    if (updateRequests.length > 0) {
      const batchUpdateData = {
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updateRequests
        }
      };
      
      await sheets.spreadsheets.values.batchUpdate(batchUpdateData);
      console.log(`✓ Updated ${updateRequests.length} timestamps`);
    }

    // 2. Dodaj nove redove na kraj
    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:J`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: appendRows
        }
      });
      console.log(`✓ Appended ${appendRows.length} new rows`);
    }

    // 3. Primeni formatiranje na nove redove
    if (appendRows.length > 0) {
      const formatRequests = [];
      const startRow = existingData.length; // Početak novih redova
      
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
                  textFormat: {
                    fontSize: 10,
                    bold: true
                  }
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
          resource: {
            requests: formatRequests
          }
        });
        console.log(`✓ Applied ${formatRequests.length} format rules`);
      }
    }

    console.log('=== Cumulative Update Complete ===');

    res.status(200).json({ 
      success: true, 
      newDepartures: newCount,
      updatedDepartures: updatedCount,
      totalNewRows: appendRows.length,
      timestamp,
      sheetUsed: sheetName
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ 
      error: 'Unexpected error',
      details: error.message
    });
  }
                                                        }
