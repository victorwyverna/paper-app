/**
 * The API contract. Keep this in the backend so `/openapi.json`, Swagger UI,
 * and the generated Postman collection always describe the running API.
 */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Paper API',
    version: '0.1.0',
    description:
      'API for publishing articles and uploading images. Open `/docs` for an interactive reference.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Articles', description: 'Create and manage published articles.' },
    { name: 'Uploads', description: 'Upload and retrieve article images.' },
  ],
  paths: {
    '/articles': {
      post: {
        tags: ['Articles'],
        summary: 'Create an article',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateArticleInput' } } },
        },
        responses: {
          '201': { description: 'Article created', content: { 'application/json': { schema: { $ref: '#/components/schemas/CreatedArticle' } } } },
          '400': { $ref: '#/components/responses/InvalidArticle' },
          '413': { $ref: '#/components/responses/BodyTooLarge' },
        },
      },
    },
    '/articles/{slug}': {
      parameters: [{ $ref: '#/components/parameters/Slug' }],
      get: {
        tags: ['Articles'], summary: 'Get a public article',
        responses: {
          '200': { description: 'Article', content: { 'application/json': { schema: { $ref: '#/components/schemas/Article' } } } },
          '404': { $ref: '#/components/responses/ArticleNotFound' },
        },
      },
      patch: {
        tags: ['Articles'], summary: 'Update an article',
        parameters: [{ $ref: '#/components/parameters/EditToken' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateArticleInput' } } } },
        responses: {
          '200': { description: 'Updated article', content: { 'application/json': { schema: { $ref: '#/components/schemas/Article' } } } },
          '400': { $ref: '#/components/responses/InvalidArticle' },
          '401': { $ref: '#/components/responses/EditTokenRequired' },
          '403': { $ref: '#/components/responses/InvalidEditToken' },
          '413': { $ref: '#/components/responses/BodyTooLarge' },
        },
      },
      delete: {
        tags: ['Articles'], summary: 'Delete an article',
        parameters: [{ $ref: '#/components/parameters/EditToken' }],
        responses: {
          '204': { description: 'Article deleted' },
          '401': { $ref: '#/components/responses/EditTokenRequired' },
          '403': { $ref: '#/components/responses/InvalidEditToken' },
        },
      },
    },
    '/uploads': {
      post: {
        tags: ['Uploads'], summary: 'Upload an image',
        description: 'Send the raw file as the request body, not `multipart/form-data`. Maximum size: 5 MiB.',
        requestBody: {
          required: true,
          content: {
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
            'image/gif': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: {
          '201': { description: 'Image uploaded', content: { 'application/json': { schema: { $ref: '#/components/schemas/UploadedImage' } } } },
          '400': { $ref: '#/components/responses/ImageRequired' },
          '413': { $ref: '#/components/responses/ImageTooLarge' },
          '415': { $ref: '#/components/responses/UnsupportedImage' },
        },
      },
    },
    '/uploads/{key}': {
      parameters: [{ $ref: '#/components/parameters/UploadKey' }],
      get: {
        tags: ['Uploads'], summary: 'Get an uploaded image',
        responses: {
          '200': { description: 'Image bytes', content: { 'image/jpeg': {}, 'image/png': {}, 'image/webp': {}, 'image/gif': {} } },
          '404': { $ref: '#/components/responses/ImageNotFound' },
        },
      },
    },
  },
  components: {
    parameters: {
      Slug: { name: 'slug', in: 'path', required: true, schema: { type: 'string' }, example: 'my-first-article' },
      UploadKey: { name: 'key', in: 'path', required: true, schema: { type: 'string' }, example: '550e8400-e29b-41d4-a716-446655440000.png' },
      EditToken: { name: 'X-Edit-Token', in: 'header', required: true, schema: { type: 'string' }, description: 'Token returned only when the article is created.' },
    },
    responses: {
      InvalidArticle: { description: 'Invalid JSON or article data', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      BodyTooLarge: { description: 'JSON body exceeds 1 MiB', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      ArticleNotFound: { description: 'Article not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      EditTokenRequired: { description: 'X-Edit-Token header is missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      InvalidEditToken: { description: 'Edit token is invalid', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      ImageRequired: { description: 'Image body is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      ImageTooLarge: { description: 'Image exceeds 5 MiB', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      UnsupportedImage: { description: 'Unsupported image content type', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      ImageNotFound: { description: 'Image not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    schemas: {
      TiptapDocument: {
        type: 'object', required: ['type', 'content'],
        properties: { type: { type: 'string', const: 'doc' }, content: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        example: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello, world!' }] }] },
      },
      CreateArticleInput: { type: 'object', required: ['title', 'content'], properties: { title: { type: 'string', minLength: 1, maxLength: 200, example: 'My first article' }, content: { $ref: '#/components/schemas/TiptapDocument' } } },
      UpdateArticleInput: { type: 'object', minProperties: 1, properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, content: { $ref: '#/components/schemas/TiptapDocument' } } },
      Article: { type: 'object', required: ['id', 'slug', 'title', 'content', 'createdAt', 'updatedAt'], properties: { id: { type: 'integer', example: 1 }, slug: { type: 'string', example: 'my-first-article' }, title: { type: 'string', example: 'My first article' }, content: { $ref: '#/components/schemas/TiptapDocument' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      CreatedArticle: { type: 'object', required: ['article', 'editToken'], properties: { article: { $ref: '#/components/schemas/Article' }, editToken: { type: 'string', description: 'Save this value; it cannot be retrieved later.', example: '0bb8e84c-3bf1-4de9-88b0-56457fb7ff82' } } },
      UploadedImage: { type: 'object', required: ['key'], properties: { key: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000.png' } } },
      Error: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
    },
  },
} as const;

export const swaggerUiHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paper API reference</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',persistAuthorization:true})</script></body></html>`;
