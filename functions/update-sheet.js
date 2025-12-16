import { google } from 'googleapis';

export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  console.log('=== Google Sheets Update Request ===');
  
  try {
    const body = await req.json();
    const { vehicles } = body;

    if (!vehicles || !Array.isArray(vehicles)) {
      console.error('Invalid data format');
      return new Response(JSON.stringify({ error: 'Invalid data format' }), { status: 400, headers });
    }

    console.log(`Received ${vehicles.length} vehicles`);

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return new Response(JSON.stringify({ 
        error: 'Missing environment variables'
      }), { status: 500, headers });
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

    const sheetName = 'Baza';
    console.log(`Target sheet: ${sheetName}`);

    let sheetId = null;
    let spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    let existingSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );
    
    if (existingSheet) {
      sheetId = existingSheet.properties.sheetId;
      console.log(`Sheet "${sheetName}" already exists (ID: ${sheetId})`);
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount: 100000,
                  columnCount: 6,
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });
      
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${sheetName}" (ID: ${sheetId})`);
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:F1`,
        valueInputOption: 'RAW',
        resource: {
          values: [['Vozilo', 'Linija', 'Polazak', 'Smer', 'Vreme upisa', 'Datum']]
        }
      });
      
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 6
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.12, green: 0.24, blue: 0.45 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    fontSize: 11,
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          }]
        }
      });
    }

    let existingData = [];
    try {
      const readResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:F`,
      });
      existingData = readResponse.data.values || [];
      console.log(`Found ${existingData.length} existing rows in ${sheetName}`);
    } catch (readError) {
      console.log('No existing data:', readError.message);
    }

    const existingVehicles = new Map();
    existingData.forEach((row, index) => {
      if (row[0]) {
        existingVehicles.set(row[0], {
          rowIndex: index + 2,
          data: row
        });
      }
    });

    const finalData = [...existingData];
    let newCount = 0;
    let updateCount = 0;

    vehicles.forEach(v => {
      const vehicleLabel = v.vehicleLabel || '';
      const rowData = [
        vehicleLabel,
        v.routeDisplayName || '',
        v.startTime || '',
        v.destName || '',
        timestamp,
        timestamp.split(',')[0].trim()
      ];

      if (existingVehicles.has(vehicleLabel)) {
        const existingRow = existingVehicles.get(vehicleLabel);
        const arrayIndex = existingRow.rowIndex - 2;
        finalData[arrayIndex] = rowData;
        updateCount++;
      } else {
        finalData.push(rowData);
        newCount++;
        existingVehicles.set(vehicleLabel, { 
          rowIndex: finalData.length + 1, 
          data: rowData 
        });
      }
    });

    console.log(`Processing: ${updateCount} updates, ${newCount} new vehicles`);

    const BATCH_SIZE = 500;
    const batches = [];
    
    for (let i = 0; i < finalData.length; i += BATCH_SIZE) {
      batches.push(finalData.slice(i, i + BATCH_SIZE));
    }

    console.log(`Writing ${batches.length} batches to Google Sheets`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const startRow = (batchIndex * BATCH_SIZE) + 2;
      const endRow = startRow + batch.length - 1;

      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A${startRow}:F${endRow}`,
          valueInputOption: 'RAW',
          resource: {
            values: batch
          }
        });
        console.log(`Batch ${batchIndex + 1}/${batches.length} written (rows ${startRow}-${endRow})`);
      } catch (updateError) {
        console.error(`Failed to write batch ${batchIndex + 1}:`, updateError.message);
        throw updateError;
      }

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            sortRange: {
              range: {
                sheetId: sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
              sortSpecs: [{
                dimensionIndex: 0,
                sortOrder: 'ASCENDING',
              }],
            },
          }],
        },
      });
      console.log('Data sorted successfully');
    } catch (sortError) {
      console.warn('Sort error (non-critical):', sortError.message);
    }

    console.log('=== Update Complete ===');

    return new Response(JSON.stringify({ 
      success: true, 
      newVehicles: newCount,
      updatedVehicles: updateCount,
      totalProcessed: vehicles.length,
      timestamp,
      sheetUsed: sheetName,
      batchesWritten: batches.length
    }), { status: 200, headers });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ 
      error: 'Unexpected error',
      details: error.message
    }), { status: 500, headers });
  }
}