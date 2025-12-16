async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hashedPassword) {
  return await hashPassword(password) === hashedPassword;
}

async function getAccessToken(context) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: context.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };

  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signatureInput = `${encode(header)}.${encode(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(context.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '').trim()), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signatureInput));
  const jwt = `${signatureInput}.${encode(Array.from(new Uint8Array(signature)))}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to get access token');
  }

  const { access_token } = await tokenResponse.json();
  return access_token;
}

const USERS_SHEET = 'Users';

export async function onRequest(context) {
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
    const access_token = await getAccessToken(context);
    const SPREADSHEET_ID = context.env.GOOGLE_SPREADSHEET_ID;

    let users = [];
    
    let response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A:I`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (errorData.error.message.includes('Unable to parse range')) {
        console.log('Creating Users sheet...');
        
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              addSheet: {
                properties: {
                  title: USERS_SHEET
                }
              }
            }]
          })
        });
        
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A1:I1?valueInputOption=RAW`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          })
        });
        
        console.log('Users sheet created successfully');
      } else {
        throw new Error(errorData.error.message);
      }
    } else {
      const data = await response.json();
      const rows = data.values || [];

      if (rows.length === 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A1:I1?valueInputOption=RAW`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [['Username', 'PasswordHash', 'Status', 'RegisteredAt', 'LastIP', 'IPHistory', 'IsAdmin', 'LastAccess', 'Favorites']]
          })
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

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!A:I:append?valueInputOption=RAW`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[username, hashedPassword, 'pending', now, ip, ip, 'false', '', '']]
        })
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

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!B${userIdx + 2}:I${userIdx + 2}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[passwordToStore, user.status, user.registeredAt, ip, ipHistory, user.isAdmin ? 'true' : 'false', now, user.favorites || '']]
        })
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
        
        if (!user || user.status !== 'approved') {
          return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
        }

        const tokenAge = Date.now() - parseInt(timestamp);
        if (tokenAge > 7 * 24 * 60 * 60 * 1000) {
          return new Response(JSON.stringify({ success: false, message: 'Token je istekao' }), { status: 401, headers });
        }

        const userIdx = users.findIndex(u => u.username === tokenUsername);
        const now = new Date().toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' });

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!H${userIdx + 2}?valueInputOption=RAW`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: [[now]]
          })
        });

        return new Response(JSON.stringify({ success: true, username: tokenUsername, isAdmin: user.isAdmin }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
      }
    }

    // ====== LISTA KORISNIKA (za admin) ======
    if (action === 'listUsers') {
      if (!token) {
        return new Response(JSON.stringify({ success: false, message: 'Neautorizovan pristup' }), { status: 401, headers });
      }

      try {
        const decoded = atob(token);
        const [tokenUsername] = decoded.split(':');
        const requestUser = users.find(u => u.username === tokenUsername);
        
        if (!requestUser || !requestUser.isAdmin) {
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
        
        if (!requestUser || !requestUser.isAdmin) {
          return new Response(JSON.stringify({ success: false, message: 'Nemate admin privilegije' }), { status: 403, headers });
        }
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: 'Nevažeći token' }), { status: 401, headers });
      }

      if (!userIndex || !status) {
        return new Response(JSON.stringify({ success: false, message: 'Nedostaju parametri' }), { status: 400, headers });
      }

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USERS_SHEET}!C${userIndex}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: [[status]]
        })
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
