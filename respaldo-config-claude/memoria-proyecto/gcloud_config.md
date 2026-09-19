---
name: gcloud-config
description: "Google Cloud project tickets-se - service account, Sheets API, key location"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7d41b7f3-06db-472f-b1e8-4ddc8d569232
---

Google Cloud project `tickets-se` (ID: 606044108682) con cuenta `alepolch@gmail.com`.

- Service account: `tickets-sheets@tickets-se.iam.gserviceaccount.com`
- Key file: `%TEMP%\tickets-se-sa-key.json` (generada 2026-06-02, NO commitear)
- APIs: Sheets API + Drive API habilitadas
- Spreadsheet: `1jAV80R_HYPKozGFTtoMAi7R9zyd-ws0CoVi6ES98zao` compartido con la SA como editor
- Las service accounts de Gmail personal NO pueden crear archivos en Drive (necesitan domain-wide delegation). Solo pueden escribir en sheets que les compartan.
- PowerShell 5.1 no tiene ImportPkcs8PrivateKey -- usar Node.js para firmar JWTs con RSA.

Related: [[project-setup]]
