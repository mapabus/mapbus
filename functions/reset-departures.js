async function getAccessToken(context) {
  // Isti helper
}

export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  console.log('=== Departures Sheet Reset Request ===');
  
  try {
    const access_token = await getAccessToken(context);
    const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

    const polasciSheetName = 'Polasci';
    const juceSheetName = 'Juce';
    
    console.log('Reading current Polasci data...');
    let polasciData = [];
    
    let polasciResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${polasciSheetName}!A:J`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    if (polasciResponse.ok) {
      const data = await polasciResponse.json();
      polasciData = data.values || [];
      console.log(`Read ${polasciData.length} rows from Polasci`);
    } else {
      console.log('No data in Polasci sheet or sheet does not exist');
    }

    let spreadsheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const spreadsheetData = await spreadsheetResponse.json();

    let juceSheetId = null;
    const existingJuceSheet = spreadsheetData.sheets.find(s => s.properties.title === juceSheetName);
    
    if (existingJuceSheet) {
      juceSheetId = existingJuceSheet.properties.sheetId;
      console.log(`Found sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    } else {
      const addSheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            addSheet: {
              properties: {
                title: juceSheetName,
                gridProperties: {
                  rowCount: 10000,
                  columnCount: 10
                }
              }
            }
          }]
        })
      });
      
      const addSheetData = await addSheetResponse.json();
      juceSheetId = addSheetData.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    }

    console.log('Clearing Juce sheet...');
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${juceSheetName}!A:J:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}` }
    });
    console.log('Cleared Juce sheet');

    if (polasciData.length > 0) {
      console.log('Copying Polasci data to Juce...');
      
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${juceSheetName}!A1?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: polasciData
        })
      });
      
      console.log(`Copied ${polasciData.length} rows to Juce`);

      const polasciSheet = spreadsheetData.sheets.find(s => s.properties.title === polasciSheetName);
      
      if (polasciSheet) {
        const polasciSheetId = polasciSheet.properties.sheetId;
        
        try {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{
                copyPaste: {
                  source: {
                    sheetId: polasciSheetId,
                    startRowIndex: 0,
                    endRowIndex: polasciData.length,
                    startColumnIndex: 0,
                    endColumnIndex: 10
                  },
                  destination: {
                    sheetId: juceSheetId,
                    startRowIndex: 0,
                    endRowIndex: polasciData.length,
                    startColumnIndex: 0,
                    endColumnIndex: 10
                  },
                  pasteType: 'PASTE_FORMAT'
                }
              }]
            })
          });
          console.log('Copied formatting to Juce');
        } catch (formatError) {
          console.log('Could not copy formatting:', formatError.message);
        }
      }
    } else {
      console.log('No data to copy to Juce');
    }

    let polasciSheetId = null;
    const existingPolasciSheet = spreadsheetData.sheets.find(s => s.properties.title === polasciSheetName);
    
    if (existingPolasciSheet) {
      polasciSheetId = existingPolasciSheet.properties.sheetId;
      console.log(`Found sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    } else {
      const addSheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            addSheet: {
              properties: {
                title: polasciSheetName,
                gridProperties: {
                  rowCount: 10000,
                  columnCount: 10
                }
              }
            }
          }]
        })
      });
      
      const addSheetData = await addSheetResponse.json();
      polasciSheetId = addSheetData.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    }

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${polasciSheetName}!A1:J:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}` }
    });

    console.log(`Cleared all data from sheet "${polasciSheetName}"`);

    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${polasciSheetName}!A1:J1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [[`Sheet resetovan u ${timestamp}`, '', '', '', '', '', '', '', '', '']]
      })
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          repeatCell: {
            range: {
              sheetId: polasciSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
                textFormat: {
                  italic: true,
                  fontSize: 10
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }]
      })
    });

    console.log('=== Departures Reset Complete ===');

    return new Response(`SUCCESS - Departures reset at ${timestamp} | Saved ${polasciData.length} rows to Juce sheet`, { status: 200 });

  } catch (error) {
    console.error('Unexpected error:', error);
    const timestamp = new Date().toLocaleString('sr-RS', { 
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    return new Response(`ERROR - Reset failed at ${timestamp}: ${error.message}`, { status: 500 });
  }
}
