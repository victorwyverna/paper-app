import 'dotenv/config';

import { ensureBucket } from './storage/s3.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const server = createApp();

async function main(): Promise<void> {
  await ensureBucket();

  server.listen(port, '0.0.0.0', () => {
    console.log(`Backend started on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
