import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ROOT } from './config.js';
import { HttpError } from './util.js';
import { authenticate } from './auth.js';
import * as schemas from './schemas.js';
import { publicRoutes, systemRoutes } from './routes/system.js';
import { ledgerRoutes } from './routes/ledger.js';
import { planningRoutes } from './routes/planning.js';
import { plannedRoutes } from './routes/planned.js';

// Turns Ajv errors into one plain sentence per problem.
function describeValidation(errors, where) {
  return errors.map((e) => {
    const field = e.instancePath.replace(/^\//, '').replace(/\//g, '.');
    if (e.keyword === 'required') return `Missing required field "${e.params.missingProperty}".`;
    if (e.keyword === 'additionalProperties') return `Unknown field "${e.params.additionalProperty}". Remove it.`;
    if (e.keyword === 'enum') return `"${field}" must be one of: ${e.params.allowedValues.join(', ')}.`;
    if (e.keyword === 'type') return `"${field || where}" must be a ${e.params.type}.`;
    if (e.keyword === 'exclusiveMinimum') return `"${field}" must be greater than ${e.params.limit}.`;
    if (e.keyword === 'pattern' && field.endsWith('date')) return `"${field}" must be in YYYY-MM-DD format.`;
    return `"${field || where}" ${e.message}.`;
  });
}

export async function buildApp({ db, config }) {
  const app = Fastify({
    logger: config.logger ? { level: 'info' } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
    ajv: {
      // Reject unknown fields instead of silently dropping them; still accept
      // "12.50" for a number, which small models often produce.
      customOptions: { removeAdditional: false, coerceTypes: true, useDefaults: true, allErrors: true },
    },
  });
  app.decorate('db', db);
  app.decorate('config', config);

  app.setErrorHandler((err, request, reply) => {
    if (err.validation) {
      const details = describeValidation(err.validation, err.validationContext);
      return reply.code(400).send({ error: 'validation_error', message: details.join(' '), details });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...err.extra });
    }
    if (err.statusCode && err.statusCode < 500) {
      const code = err.statusCode === 429 ? 'too_many_requests' : 'bad_request';
      return reply.code(err.statusCode).send({ error: code, message: err.message });
    }
    request.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong on the server.' });
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    hideUntagged: true,
    openapi: {
      info: {
        title: 'Knab API',
        version: '1',
        description: 'Create and read budget data. Authenticate with an API token from Settings: `Authorization: Bearer knab_...`. A token belongs to one budget, so payloads never name a budget. Accounts and categories are always referred to by name.',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // Everything except the API docs page gets strict security headers.
  await app.register(async (site) => {
    await site.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          // Left off so the app also works over plain HTTP on a home network.
          upgradeInsecureRequests: null,
        },
      },
      hsts: config.cookieSecure,
    });

    await site.register(async (api) => {
      publicRoutes(api);
      api.get('/schema/transaction', async () => schemas.transactionCreate);
      api.get('/schema/transfer', async () => schemas.transferCreate);
      api.get('/schema/recurring', async () => schemas.recurringCreate);
      api.get('/openapi.json', async () => app.swagger());
      // The user manual, as Markdown. Public: it describes the app, not anyone's data.
      api.get('/manual', async (request, reply) => {
        reply.header('Content-Type', 'text/markdown; charset=utf-8');
        return fs.promises.readFile(path.join(ROOT, 'docs', 'MANUAL.md'), 'utf8');
      });

      await api.register(async (secure) => {
        secure.addHook('onRequest', authenticate(app));
        systemRoutes(secure);
        ledgerRoutes(secure);
        planningRoutes(secure);
        plannedRoutes(secure);
      });
    }, { prefix: '/api/v1' });

    const dist = path.join(ROOT, 'dist');
    const hasWeb = fs.existsSync(path.join(dist, 'index.html'));
    if (hasWeb) await site.register(fastifyStatic, { root: dist });

    site.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET' || !hasWeb) {
        return reply.code(404).send({ error: 'not_found', message: `No such endpoint: ${request.method} ${request.url}` });
      }
      // Single-page app: unknown paths are client-side routes.
      return reply.sendFile('index.html');
    });
  });

  return app;
}
