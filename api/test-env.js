export default async function handler(req, res) {
  // Debug endpoint - proveri environment variables
  
  const hasClientEmail = !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const hasPrivateKey = !!process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const hasSpreadsheetId = !!process.env.GOOGLE_SPREADSHEET_ID;
  
  const clientEmailLength = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.length || 0;
  const privateKeyLength = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.length || 0;
  const spreadsheetIdLength = process.env.GOOGLE_SPREADSHEET_ID?.length || 0;
  
  const privateKeyStart = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.substring(0, 30) || '';
  const privateKeyEnd = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.slice(-30) || '';
  
  res.status(200).json({
    status: 'Environment Variables Check',
    variables: {
      GOOGLE_SHEETS_CLIENT_EMAIL: {
        exists: hasClientEmail,
        length: clientEmailLength,
        preview: process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.substring(0, 20) + '...'
      },
      GOOGLE_SHEETS_PRIVATE_KEY: {
        exists: hasPrivateKey,
        length: privateKeyLength,
        startsWithBegin: privateKeyStart.includes('BEGIN PRIVATE KEY'),
        endsWithEnd: privateKeyEnd.includes('END PRIVATE KEY'),
        preview: `${privateKeyStart}...${privateKeyEnd}`
      },
      GOOGLE_SPREADSHEET_ID: {
        exists: hasSpreadsheetId,
        length: spreadsheetIdLength,
        preview: process.env.GOOGLE_SPREADSHEET_ID
      }
    },
    allPresent: hasClientEmail && hasPrivateKey && hasSpreadsheetId,
    timestamp: new Date().toISOString()
  });
}
