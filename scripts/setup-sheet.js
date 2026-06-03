const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sa = JSON.parse(fs.readFileSync(path.join(process.env.TEMP, 'tickets-se-sa-key.json'), 'utf8'));
const SPREADSHEET_ID = '1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = {};
    if (data) {
      headers['Content-Type'] = typeof body === 'string'
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = require('https').request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, data: d }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Get access token
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), sa.private_key);
  const jwt = header + '.' + payload + '.' + base64url(sig);

  const tokenRes = await request(
    'POST',
    'https://oauth2.googleapis.com/token',
    'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  );
  const token = JSON.parse(tokenRes.data).access_token;
  if (!token) {
    console.error('Token error:', tokenRes.data);
    process.exit(1);
  }
  console.log('1. Token OK');

  // Read spreadsheet metadata to verify access
  const metaRes = await request(
    'GET',
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=properties.title,sheets.properties.title`,
    null,
    token
  );
  console.log('2. Access check:', metaRes.status);
  if (metaRes.status !== 200) {
    console.error('Cannot access sheet. Did you share it with tickets-sheets@tickets-se.iam.gserviceaccount.com?');
    console.error(metaRes.data);
    process.exit(1);
  }

  const meta = JSON.parse(metaRes.data);
  console.log('   Title:', meta.properties.title);
  const existingTabs = meta.sheets.map((s) => s.properties.title);
  console.log('   Existing tabs:', existingTabs.join(', '));

  // Rename Sheet1 to 2026-06 if needed
  const tabName = '2026-06';
  if (!existingTabs.includes(tabName)) {
    const sheetId = meta.sheets[0].properties.sheetId || 0;
    const renameRes = await request(
      'POST',
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: sheetId, title: tabName },
              fields: 'title',
            },
          },
        ],
      },
      token
    );
    console.log('3. Renamed tab to', tabName, ':', renameRes.status);
  } else {
    console.log('3. Tab', tabName, 'already exists');
  }

  // Add headers
  const hdrRes = await request(
    'PUT',
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A1:J1?valueInputOption=RAW`,
    {
      values: [
        [
          'Fecha Ticket',
          'Comercio',
          'Producto',
          'Cantidad',
          'Monto',
          'Categoria',
          'Sucursal',
          'Empleado',
          'Archivo',
          'Confirmado',
        ],
      ],
    },
    token
  );
  console.log('4. Headers written:', hdrRes.status);

  console.log('\nDONE - Sheet is ready');
  console.log('Spreadsheet ID:', SPREADSHEET_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
