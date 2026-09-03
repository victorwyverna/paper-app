import { createServer } from 'node:http';

import { routeRequest } from './routes/index.js';

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';

export function createApp() {
  return createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', frontendOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      await routeRequest(request, response);
    } catch (error) {
      console.error(error);

      response.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
      });

      response.end(JSON.stringify({ message: 'Internal server error' }));
    }
  });
}
