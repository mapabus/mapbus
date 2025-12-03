import { google } from 'googleapis';
import crypto from 'crypto';

// Funkcija za heširanje lozinke
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Funkcija za verifikaciju lozinke
function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

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

  const { action, username, password, token, userIndex, status, captcha, currentPassword, newPassword, favorites } = 
    req.method === 'POST' ? req.body : req.query;

  try {
    let users = [];
    
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`, // Prošireno na I kolonu (Favorites)
      });

      const rows = response.data.values || [];
      
      if (rows.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          }
        });
      } else {
        users = rows.slice(1).map(row => ({
          username: row[0] || '',
          passwordHash: row[1] || '',
          status: row[2] || 'pending',
          registeredAt: row[3] || '',
          lastIP: row[4] || '',
          ipHistory: row[5] || '',
          isAdmin: row[6] === 'true' || row[6] === 'TRUE' || false,
          lastAccess: row[7] || '',
          favorites: row[8] || '', // Nova kolona
        }));
      }
    } catch (error) {
      if (error.message && error.message.includes('Unable to parse range')) {
        console.log('Creating Users sheet...');
        
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: USERS_SHEET
                }
              }
            }]
          }
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!A1:I1`,
          valueInputOption: 'RAW',
          resource: {
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          }
        });
        
        console.log('Users sheet created successfully');
      } else {
        throw error;
      }
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               'unknown';

    // ====== REGISTRACIJA ======
    if (action === 'register') {
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
      const hashedPassword = hashPassword(password);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`,
        valueInputOption: 'RAW',
        resource: {
          values: [[username, hashedPassword, 'pending', now, ip, ip, 'false', '', '']]
        }
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Zahtev za registraciju poslat!  Čekajte odobrenje.' 
      });
    }

    // ====== LOGIN ======
    if (action === 'login') {
      const user = users.find(u => u.username === username);

      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        });
      }

      // Proveri da li je lozinka hešovana ili plain text (za migraciju starih naloga)
      let isPasswordValid = false;
      let needsMigration = false;

      if (verifyPassword(password, user.passwordHash)) {
        // Lozinka je već hešovana i tačna
        isPasswordValid = true;
      } else if (user.passwordHash === password) {
        // Stara plain text lozinka - treba migrirati
        isPasswordValid = true;
        needsMigration = true;
      }

      if (!isPasswordValid) {
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

      // Ažuriraj IP i poslednji pristup
      const userIdx = users.findIndex(u => u.username === username);
      const ipHistory = user.ipHistory ? `${user.ipHistory}, ${ip}` : ip;
      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

      // Ako je potrebna migracija, hešuj lozinku
      const passwordToStore = needsMigration ? hashPassword(password) : user.passwordHash;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!B${userIdx + 2}:I${userIdx + 2}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[passwordToStore, user.status, user.registeredAt, ip, ipHistory, user.isAdmin ?  'true' : 'false', now, user.favorites || '']]
        }
      });

      if (needsMigration) {
        console.log(`✓ Migrated password for user: ${username}`);
      }

      const authToken = Buffer.from(`${username}:${Date.now()}`).toString('base64');

      return res.status(200).json({ 
        success: true, 
        message: 'Uspešna prijava',
        token: authToken,
        username: username,
        isAdmin: user.isAdmin
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
        
        if (! user || user.status !== 'approved') {
          return res.status(401).json({ success: false, message: 'Nevažeći token' });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        // Ažuriraj poslednji pristup pri svakoj verifikaciji
        const userIdx = users.findIndex(u => u.username === tokenUsername);
        const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!H${userIdx + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[now]]
          }
        });

        return res.status(200).json({ success: true, username: tokenUsername, isAdmin: user.isAdmin });
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }
    }

    // ====== LISTA KORISNIKA (za admin) ======
    if (action === 'listUsers') {
      if (! token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }

      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (! requestUser || ! requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }

      const sanitizedUsers = users.map(u => ({
        username: u.username,
        status: u.status,
        registeredAt: u.registeredAt,
        lastIP: u.lastIP,
        ipHistory: u.ipHistory,
        isAdmin: u.isAdmin,
        lastAccess: u.lastAccess
      }));

      return res.status(200).json({ success: true, users: sanitizedUsers });
    }

    // ====== AŽURIRANJE STATUSA (za admin) ======
    if (action === 'updateStatus') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Neautorizovan pristup' });
      }

      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (!requestUser || ! requestUser.isAdmin) {
          return res.status(403).json({ success: false, message: 'Nemate admin privilegije' });
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }

      if (! userIndex || !status) {
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

    // ====== UČITAVANJE KORISNIČKIH PODATAKA ======
    if (action === 'getUserData') {
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

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        return res.status(200).json({ 
          success: true, 
          username: tokenUsername,
          favorites: user.favorites || ''
        });
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Nevažeći token' });
      }
    }

    // ====== ČUVANJE OMILJENIH LINIJA ======
    if (action === 'saveFavorites') {
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

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        const userIdx = users.findIndex(u => u.username === tokenUsername);

        // Sačuvaj favorites u kolonu I
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}!I${userIdx + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[favorites || '']]
          }
        });

        return res.status(200).json({ success: true, message: 'Omiljene linije sačuvane' });
      } catch (e) {
        console.error('Save favorites error:', e);
        return res.status(500).json({ success: false, message: 'Greška pri čuvanju' });
      }
    }

    // ====== PROMENA LOZINKE ======
    if (action === 'changePassword') {
      if (!token) {
        return res.status(401).json({ success: false, message: 'Nema tokena' });
      }

      if (!currentPassword || ! newPassword) {
        return res.status(400).json({ success: false, message: 'Nedostaju parametri' });
      }

      try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [tokenUsername, timestamp] = decoded.split(':');

        const user = users.find(u => u.username === tokenUsername);
        
        if (!user || user.status !== 'approved') {
          return res.status(401).json({ success: false, message: 'Nevažeći token' });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ success: false, message: 'Token je istekao' });
        }

        // Proveri trenutnu lozinku
        let isPasswordValid = false;
        if (verifyPassword(currentPassword, user.passwordHash)) {
          isPasswordValid = true;
        } else if (user.passwordHash === currentPassword) {
          // Stara plain text lozinka
          isPasswordValid = true;
        }

        if (!isPasswordValid) {
          return res.status(400).json({ success: false, message: 'Pogrešna trenutna lozinka' });
        }

        // Heširaj novu lozinku i sačuvaj
        const newHashedPassword = hashPassword(newPassword);
        const userIdx = users.findIndex(u => u.username === tokenUsername);

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${USERS_SHEET}! B${userIdx + 2}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[newHashedPassword]]
          }
        });

        return res.status(200).json({ success: true, message: 'Lozinka uspešno promenjena' });
      } catch (e) {
        console.error('Change password error:', e);
        return res.status(500).json({ success: false, message: 'Greška pri promeni lozinke' });
      }
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
