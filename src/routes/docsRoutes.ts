import { Router } from 'express';
import { openApiDocument } from '../docs/openapi.js';

const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Digital Twin Backend API</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>body { margin: 0; background: #fafafa; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true,
        tryItOutEnabled: true
      });
    </script>
  </body>
</html>`;

export const createDocsRouter = (): Router => {
  const router = Router();

  router.get('/openapi.json', (_request, response) => {
    response.status(200).json(openApiDocument);
  });

  router.get('/', (_request, response) => {
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .type('html')
      .send(swaggerHtml);
  });

  return router;
};

