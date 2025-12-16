async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hashedPassword) {
  return await hashPassword(password) === hashedPassword;
}

import { google } from 'googleapis';

const USERS_SHEET = 'Users';

export async function onRequest(context) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: context.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: context.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SPREADSHEET_ID = context.env.GOOGLE_SPREADSHEET_ID;

  const req = context.request;
  const url = new URL(req.url);
  const method = req.method;

  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  if (method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  let body = {};
  if (method === 'POST') {
    body = await req.json();
  } else {
    const params = url.searchParams;
    body = {
      action: params.get('action'),
      username: params.get('username'),
      password: params.get('password'),
      token: params.get('token'),
      userIndex: params.get('userIndex'),
      status: params.get('status'),
      captcha: params.get('captcha'),
      currentPassword: params.get('currentPassword'),
      newPassword: params.get('newPassword'),
      favorites: params.get('favorites'),
    };
  }

  const { action, username, password, token, userIndex, status, captcha, currentPassword, newPassword, favorites } = body;

  try {
    let users = [];
    
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`,
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
          favorites: row[8] || '',
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

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

    // ====== REGISTRACIJA ======
    if (action === 'register') {
      if (!captcha || captcha.trim() === '') {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Molimo potvrdite da niste robot' 
        }), { status: 400, headers });
      }

      const existingUser = users.find(u => 
        u.username.toLowerCase() === username.toLowerCase()
      );

      if (existingUser) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Korisničko ime već postoji' 
        }), { status: 400, headers });
      }

      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });
      const hashedPassword = await hashPassword(password);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:I`,
        valueInputOption: 'RAW',
        resource: {
          values: [[username, hashedPassword, 'pending', now, ip, ip, 'false', '', '']]
        }
      });

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Zahtev za registraciju poslat!  Čekajte odobrenje.' 
      }), { status: 200, headers });
    }

    // ====== LOGIN ======
    if (action === 'login') {
      const user = users.find(u => u.username === username);

      if (!user) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        }), { status: 401, headers });
      }

      let isPasswordValid = false;
      let needsMigration = false;

      if (await verifyPassword(password, user.passwordHash)) {
        isPasswordValid = true;
      } else if (user.passwordHash === password) {
        isPasswordValid = true;
        needsMigration = true;
      }

      if (!isPasswordValid) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Pogrešno korisničko ime ili lozinka' 
        }), { status: 401, headers });
      }

      if (user.status !== 'approved') {
        return new Response(JSON.stringify({ 
          success: false, 
          message: user.status === 'rejected' ? 'Nalog je odbijen' : 'Nalog još nije odobren' 
        }), { status: 403, headers });
      }

      const userIdx = users.findIndex(u => u.username === username);
      const ipHistory = user.ipHistory ? `${user.ipHistory}, ${ip}` : ip;
      const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

      const passwordToStore = needsMigration ? await hashPassword(password) : user.passwordHash;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!B${userIdx + 2}:I${userIdx + 2}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[passwordToStore, user.status, user.registeredAt, ip, ipHistory, user.isAdmin ?  'true' : 'false', now, user.favorites || '']]
        }
      });

      if (needsMigration) {
        console.log(`Migrated password for user: ${username}`);
      }

      const authToken = btoa(`${username}:${Date.now()}`);

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Uspešna prijava',
        token: authToken,
        username: username,
        isAdmin: user.isAdmin
      }), { status: 200, headers });
    }

    // ====== PROVERA TOKENA ======
    if (action === 'verify') {
      if (!token) {
        return new Response(JSON.stringify({ success: false, message: 'Nema tokena' }), { status: 401, headers });
      }

      try {
        const decoded = atob(token);
        const [tokenUsername, timestamp] = decoded.split(':');

        const user = users.find(u => u.username === tokenUsername);
        
        if (! user || user.status !== 'approved') {
          return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return new Response(JSON.stringify({ success: false, message: 'Token je istekao' }), { status: 401, headers });
        }

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

        return new Response(JSON.stringify({ success: true, username: tokenUsername, isAdmin: user.isAdmin }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
      }
    }

    // ====== LISTA KORISNIKA (za admin) ======
    if (action === 'listUsers') {
      if (! token) {
        return new Response(JSON.stringify({ success: false, message: 'Neautorizovan pristup' }), { status: 401, headers });
      }

      try {
        const decoded = atob(token);
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (! requestUser || ! requestUser.isAdmin) {
          return new Response(JSON.stringify({ success: false, message: 'Nemate admin privilegije' }), { status: 403, headers });
        }
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
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

      return new Response(JSON.stringify({ success: true, users: sanitizedUsers }), { status: 200, headers });
    }

    // ====== AŽURIRANJE STATUSA (za admin) ======
    if (action === 'updateStatus') {
      if (!token) {
        return new Response(JSON.stringify({ success: false, message: 'Neautorizovan pristup' }), { status: 401, headers });
      }

      try {
        const decoded = atob(token);
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (!requestUser || ! requestUser.isAdmin) {
          return new Response(JSON.stringify({ success: false, message: 'Nemate admin privilegije' }), { status: 403, headers });
        }
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
      }

      if (! userIndex || !status) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'Nedostaju parametri' 
        }), { status: 400, headers });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!C${userIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[status]]
        }
      });

      return new Response(JSON.stringify({ success: true, message: 'Status ažuriran' }), { status: 200, headers });
    }

    // ====== UČITAVANJE KORISNIČKIH PODATAKA ======
    if (action === 'getUserData') {
      if (!token) {
        return new Response(JSON.stringify({ success: false, message: 'Nema tokena' }), { status: 401, headers });
      }

      try {
        const decoded = atob(token);
        const [tokenUsername, timestamp] = decoded.split(':');

        const user = users.find(u => u.username === tokenUsername);
        
        if (!user || user.status !== 'approved') {
          return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return new Response(JSON.stringify({ success: false, message: 'Token je istekao' }), { status: 401, headers });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          username: tokenUsername,
        }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
      }
    }

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500, headers });
  }
}
