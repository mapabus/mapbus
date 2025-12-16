async function getAccessToken(context) {
  // Isti helper
}

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

    const access_token = await getAccessToken(context);
    const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

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
    const spreadsheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const spreadsheetData = await spreadsheetResponse.json();
    let existingSheet = spreadsheetData.sheets.find(s => s.properties.title === sheetName);
    
    if (existingSheet) {
      sheetId = existingSheet.properties.sheetId;
      console.log(`Sheet "${sheetName}" already exists (ID: ${sheetId})`);
    } else {
      const addSheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        })
      });
      const addSheetData = await addSheetResponse.json();
      sheetId = addSheetData.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${sheetName}" (ID: ${sheetId})`);
      
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:F1?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [['Vozilo', 'Linija', 'Polazak', 'Smer', 'Vreme upisa', 'Datum']]
        })
      });
      
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        })
      });
    }

    let existingData = [];
    const readResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A2:F`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (readResponse.ok) {
      const readData = await readResponse.json();
      existingData = readData.values || [];
      console.log(`Found ${existingData.length} existing rows in ${sheetName}`);
    } else {
      console.log('No existing data');
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

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A${startRow}:F${endRow}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: batch
        })
      });
      console.log(`Batch ${batchIndex + 1}/${batches.length} written (rows ${startRow}-${endRow})`);

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    try {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        })
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
