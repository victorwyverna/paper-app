import 'dotenv/config';

import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const server = createApp();

server.listen(port, '0.0.0.0', () => {
  console.log(`Backend started on http://localhost:${port}`);
});
