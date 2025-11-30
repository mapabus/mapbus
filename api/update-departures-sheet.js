import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Departures Sheet Update Request ===');
  
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

    // Grupisanje vozila po linijama
    const routeMap = {};
    
    vehicles.forEach(v => {
      const route = v.routeDisplayName || v.routeId;
      const destName = v.destName || 'Unknown';
      const vehicleLabel = v.vehicleLabel || '';
      const startTime = v.startTime || 'N/A';
      
      if (!routeMap[route]) {
        routeMap[route] = {};
      }
      
      if (!routeMap[route][destName]) {
        routeMap[route][destName] = [];
      }
      
      routeMap[route][destName].push({
        startTime: startTime,
        vehicleLabel: vehicleLabel,
        timestamp: timestamp
      });
    });

    // Sortiraj polaske po vremenu
    for (let route in routeMap) {
      for (let direction in routeMap[route]) {
        routeMap[route][direction].sort((a, b) => {
          return a.startTime.localeCompare(b.startTime);
        });
      }
    }

    console.log(`Grouped into ${Object.keys(routeMap).length} routes`);

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

    // Pročitaj postojeće podatke
    let existingData = [];
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:J`,
      });
      existingData = readResponse.data.values || [];
      console.log(`Found ${existingData.length} existing rows`);
    } catch (readError) {
      console.log('No existing data');
    }

    // Pronađi postojeće linije
    const existingRoutes = new Map();
    let currentRoute = null;
    
    for (let i = 0; i < existingData.length; i++) {
      const row = existingData[i];
      if (row[0] && row[0].startsWith('Linija ')) {
        currentRoute = row[0].replace('Linija ', '');
        if (!existingRoutes.has(currentRoute)) {
          existingRoutes.set(currentRoute, {
            startRow: i,
            directions: new Map()
          });
        }
      } else if (currentRoute && row[0] && row[0].startsWith('Smer: ')) {
        const direction = row[0].replace('Smer: ', '');
        existingRoutes.get(currentRoute).directions.set(direction, {
          row: i,
          departures: new Map()
        });
      } else if (currentRoute && row[0] && row[0] !== '') {
        const time = row[0];
        const vehicle = row[1];
        const lastDir = Array.from(existingRoutes.get(currentRoute).directions.values()).pop();
        if (lastDir) {
          lastDir.departures.set(`${time}_${vehicle}`, {
            row: i,
            data: row
          });
        }
      }
    }

    // Gradi nove podatke
    const newData = [];
    let updatedRoutes = 0;
    let newRoutes = 0;
    let updatedDepartures = 0;
    let newDepartures = 0;

    // Sortiraj linije numerički
    const sortedRoutes = Object.keys(routeMap).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    for (let route of sortedRoutes) {
      const directions = routeMap[route];
      const isExisting = existingRoutes.has(route);
      
      if (isExisting) {
        updatedRoutes++;
      } else {
        newRoutes++;
      }
      
      // Header linije
      newData.push([`Linija ${route}`, '', '', '', '', '', '', '', '', '']);
      
      // Sortiraj smerove
      const sortedDirections = Object.keys(directions).sort();
      
      for (let direction of sortedDirections) {
        const departures = directions[direction];
        
        // Smer header
        newData.push([`Smer: ${direction}`, '', '', '', '', '', '', '', '', '']);
        newData.push(['Polazak', 'Vozilo', 'Poslednji put viđen', '', '', '', '', '', '', '']);
        
        // Dodaj polaske
        departures.forEach(dep => {
          const existingRoute = existingRoutes.get(route);
          const existingDir = existingRoute?.directions.get(direction);
          const key = `${dep.startTime}_${dep.vehicleLabel}`;
          
          if (existingDir?.departures.has(key)) {
            updatedDepartures++;
          } else {
            newDepartures++;
          }
          
          newData.push([
            dep.startTime,
            dep.vehicleLabel,
            dep.timestamp,
            '', '', '', '', '', '', ''
          ]);
        });
        
        newData.push(['', '', '', '', '', '', '', '', '', '']);
      }
      
      newData.push(['', '', '', '', '', '', '', '', '', '']);
    }

    console.log(`Routes: ${newRoutes} new, ${updatedRoutes} updated`);
    console.log(`Departures: ${newDepartures} new, ${updatedDepartures} updated`);

    // Obriši stare podatke i upiši nove
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A1:J`
      });
      
      const BATCH_SIZE = 1000;
      const batches = [];
      
      for (let i = 0; i < newData.length; i += BATCH_SIZE) {
        batches.push(newData.slice(i, i + BATCH_SIZE));
      }

      console.log(`Writing ${batches.length} batches`);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const startRow = (batchIndex * BATCH_SIZE) + 1;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A${startRow}:J`,
          valueInputOption: 'RAW',
          resource: {
            values: batch
          }
        });
        
        console.log(`✓ Batch ${batchIndex + 1}/${batches.length} written`);

        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Formatiraj headere
      const formatRequests = [];
      
      for (let i = 0; i < newData.length; i++) {
        const row = newData[i];
        
        if (row[0] && row[0].startsWith('Linija ')) {
          formatRequests.push({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: i,
                endRowIndex: i + 1,
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
                startRowIndex: i,
                endRowIndex: i + 1,
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
                startRowIndex: i,
                endRowIndex: i + 1,
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

    } catch (updateError) {
      console.error('Failed to write data:', updateError.message);
      throw updateError;
    }

    console.log('=== Departures Update Complete ===');

    res.status(200).json({ 
      success: true, 
      newRoutes: newRoutes,
      updatedRoutes: updatedRoutes,
      newDepartures: newDepartures,
      updatedDepartures: updatedDepartures,
      totalRoutes: sortedRoutes.length,
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
