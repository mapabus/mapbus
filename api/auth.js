import { google } from 'googleapis';

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const USERS_SHEET = 'Users';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, username, password, token, userIndex, status, captcha } = 
    req.method === 'POST' ? req.body : req.query;

  try {
    // Učitaj korisnike
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!A:F`,
    });

    const rows = response.data.values || [];
    
    // Ako sheet ne postoji ili je prazan, inicijalizuj ga
    if (rows.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A1:F1`,
        valueInputOption: 'RAW',
        resource: {
          values: [['Username', 'Password', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory']]
        }
      });
      
      var users = [];
    } else {
      var users = rows.slice(1).map(row => ({
        username: row[0] || '',
        password: row[1] || '',
        status: row[2] || 'pending',
        registeredAt: row[3] || '',
        lastIP: row[4] || '',
        ipHistory: row[5] || '',
      }));
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               'unknown';

    // ====== REGISTRACIJA ======
    if (action === 'register') {
      // Proveri CAPTCHA
      if (!captcha || captcha.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: 'Molimo potvrdite da niste robot' 
        });
      }

      const existingUser = users.find(u => 
        u.username.toLowerCase() === username.toLowerCase()
      );

      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'Korisničko ime već postoji' 
        });
      }

      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:F`,
        valueInputOption: 'RAW',
        resource: {
          values: [[username, password, 'pending', now, ip, ip]]
        }
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Zahtev za registraciju poslat! Čekajte odobrenje.' 
      });
    }

    // ====== LOGIN ======
    if (action === 'login') {
      const user = users.find(u => 
        u.username === username && u.password === password
      );

      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        });
      }

      if (user.status !== 'approved') {
        return res.status(403).json({ 
          success: false, 
          message: user.status === 'rejected' ? 'Nalog je odbijen' : 'Nalog još nije odobren' 
        });
      }

      // Ažuriraj IP
      const userIndex = users.findIndex(u => u.username === username);
      const ipHistory = user.ipHistory ? `${user.ipHistory}, ${ip}` : ip;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!E${userIndex + 2}:F${userIndex + 2}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[ip, ipHistory]]
        }
      });

      const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');

      return res.status(200).json({ 
        success: true, 
        message: 'Uspešna prijava',
        token: token,
        username: username
      });
    }

    // ====== PROVERA TOKENA ======
    if (action === 'verify') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Nema tokena' });
      }

      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername, timestamp] = decoded.split(':');

        const user = users.find(u => u.username === tokenUsername);
        
        if (!user || user.status !== 'approved') {
          return res.status(401).json({ success: false, message: 'Nevažeći token' });
        }

        // Token važi 7 dana
        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        return res.status(200).json({ success: true, username: tokenUsername });
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }
    }

    // ====== LISTA KORISNIKA (za admin) ======
    if (action === 'listUsers') {
      return res.status(200).json({ success: true, users: users });
    }

    // ====== AŽURIRANJE STATUSA (za admin) ======
    if (action === 'updateStatus') {
      if (!userIndex || !status) {
        return res.status(400).json({ 
          success: false, 
          message: 'Nedostaju parametri' 
        });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!C${userIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[status]]
        }
      });

      return res.status(200).json({ success: true, message: 'Status ažuriran' });
    }

    return res.status(400).json({ error: 'Nevažeća akcija' });

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Server greška',
      details: error.message 
    });
  }
}
