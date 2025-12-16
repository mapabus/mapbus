import { google } from 'googleapis';

export async function onRequest(context) {
  const req = context.request;
  const method = req.method;

  if (method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  console.log('=== Departures Sheet Reset Request ===');
  
  try {
    const clientEmail = context.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = context.env.GOOGLE_SHEETS_PRIVATE_KEY;
    const spreadsheetId = context.env.GOOGLE_SPREADSHEET_ID;

    if (!clientEmail || !privateKey || !spreadsheetId) {
      return new Response(JSON.stringify({ 
        error: 'Missing environment variables'
      }), { status: 500 });
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

    const polasciSheetName = 'Polasci';
    const juceSheetName = 'Juce';
    
    console.log('Reading current Polasci data...');
    let polasciData = [];
    
    try {
      const polasciResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${polasciSheetName}!A:J`,
      });
      polasciData = polasciResponse.data.values || [];
      console.log(`Read ${polasciData.length} rows from Polasci`);
    } catch (readError) {
      console.log('No data in Polasci sheet or sheet does not exist');
    }

    let juceSheetId = null;
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingJuceSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === juceSheetName
    );
    
    if (existingJuceSheet) {
      juceSheetId = existingJuceSheet.properties.sheetId;
      console.log(`Found sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
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
        }
      });
      
      juceSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${juceSheetName}" (ID: ${juceSheetId})`);
    }

    console.log('Clearing Juce sheet...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${juceSheetName}!A:J`
    });
    console.log('Cleared Juce sheet');

    if (polasciData.length > 0) {
      console.log('Copying Polasci data to Juce...');
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${juceSheetName}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: polasciData
        }
      });
      
      console.log(`Copied ${polasciData.length} rows to Juce`);

      const polasciSheet = spreadsheet.data.sheets.find(
        s => s.properties.title === polasciSheetName
      );
      
      if (polasciSheet) {
        const polasciSheetId = polasciSheet.properties.sheetId;
        
        try {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
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
            }
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
    const existingPolasciSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === polasciSheetName
    );
    
    if (existingPolasciSheet) {
      polasciSheetId = existingPolasciSheet.properties.sheetId;
      console.log(`Found sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    } else {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
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
        }
      });
      
      polasciSheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`Created new sheet "${polasciSheetName}" (ID: ${polasciSheetId})`);
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${polasciSheetName}!A1:J`
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

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${polasciSheetName}!A1:J1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[`Sheet resetovan u ${timestamp}`, '', '', '', '', '', '', '', '', '']]
      }
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
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
      }
    });

    console.log('=== Departures Reset Complete ===');

    return new Response(
      `SUCCESS - Departures reset at ${timestamp} | ` +
      `Saved ${polasciData.length} rows to Juce sheet`,
      { status: 200 }
    );

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
    
    return new Response(
      `ERROR - Reset failed at ${timestamp}: ${error.message}`,
      { status: 500 }
    );
  }
}
