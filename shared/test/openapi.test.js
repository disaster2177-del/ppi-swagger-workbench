import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  buildApiModel,
  buildRequest,
  extractEndpoints,
  joinUrl,
  parseDefinitionText,
  resolveSchema,
  sampleValue,
  toCurl,
  validateDefinition,
  validateValue,
  widgetFor,
  initialValue,
} from '../openapi/index.js';

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/openapi');
const read = (rel) => fs.readFileSync(path.join(samples, rel), 'utf8');
const load = (rel) => buildApiModel(parseDefinitionText(read(rel)));
const op = (model, id) => model.operations.find((o) => o.id === id);

test('parses YAML and reports the line of a syntax error', () => {
  assert.equal(parseDefinitionText(read('user-service/user-api.yaml')).info.title, 'User API');
  assert.throws(
    () => parseDefinitionText(read('invalid/broken-indentation.yaml')),
    (e) => e instanceof AppError && e.code === 'INVALID_YAML' && typeof e.details.line === 'number',
  );
  assert.throws(() => parseDefinitionText('   '), (e) => e.code === 'EMPTY_FILE');
  assert.throws(() => parseDefinitionText('- a\n- b\n'), (e) => e.code === 'NOT_AN_OBJECT');
});

test('rejects YAML that is not OpenAPI unless validation is lenient', () => {
  const def = parseDefinitionText(read('invalid/not-openapi.yaml'));
  assert.equal(validateDefinition(def).valid, false);
  assert.equal(validateDefinition(def, { mode: 'lenient' }).valid, true);
});

test('flags unresolvable $refs and bad parameter locations', () => {
  const def = {
    openapi: '3.0.3',
    info: { title: 't', version: '1' },
    paths: {
      '/a': { get: { parameters: [{ name: 'x', in: 'body' }], responses: { 200: { $ref: '#/components/responses/Nope' } } } },
    },
  };
  const r = validateDefinition(def);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /invalid "in"/.test(e.message)));
  assert.ok(r.errors.some((e) => /points to nothing/.test(e.message)));
});

test('strict mode treats warnings as errors', () => {
  const def = { openapi: '3.0.0', paths: { '/a': { get: {} } } };
  assert.equal(validateDefinition(def).valid, true);
  assert.equal(validateDefinition(def, { mode: 'strict' }).valid, false);
});

test('all sample definitions validate and expose their endpoints', () => {
  for (const f of ['payment-service/payment-api.yaml', 'payment-service/payment-v2.yaml', 'payment-service/payment-admin.yaml', 'payment-service/payment-webhook.yaml', 'user-service/user-api.yaml']) {
    const def = parseDefinitionText(read(f));
    const r = validateDefinition(def);
    assert.equal(r.valid, true, `${f}: ${JSON.stringify(r.errors)}`);
  }
  const users = extractEndpoints(load('user-service/user-api.yaml')).map((e) => `${e.method} ${e.path}`);
  assert.deepEqual(users, ['GET /users', 'POST /users', 'GET /users/{id}', 'PUT /users/{id}', 'DELETE /users/{id}']);
});

test('path-level parameters are inherited and undocumented path params are added', () => {
  const m = load('payment-service/payment-api.yaml');
  const get = op(m, 'GET /payments/{paymentId}');
  assert.equal(get.parameters.find((p) => p.name === 'paymentId').required, true);
  const orphan = buildApiModel({ openapi: '3.0.0', info: {}, paths: { '/x/{y}': { get: { responses: {} } } } });
  assert.equal(orphan.operations[0].parameters[0].undocumented, true);
});

test('Swagger 2.0: body, formData, enums and servers are normalised', () => {
  const m = load('payment-service/payment-admin.yaml');
  assert.equal(m.format, 'swagger');
  assert.equal(m.servers[0].url, 'https://admin.payments.example.com/admin');
  assert.equal(op(m, 'POST /merchants').requestBody.contents[0].mediaType, 'application/json');
  const upload = op(m, 'POST /merchants/{merchantId}/documents').requestBody.contents[0];
  assert.equal(upload.mediaType, 'multipart/form-data');
  assert.equal(upload.schema.properties.file.format, 'binary');
  assert.deepEqual(upload.schema.properties.kind.enum, ['incorporation', 'tax_id', 'bank_statement', 'identity']);
  assert.equal(m.securitySchemes[0].type, 'apiKey');
});

test('server variables are expanded', () => {
  assert.equal(load('payment-service/payment-v2.yaml').servers[0].url, 'https://payments.example.com/v2');
});

test('schemas: $ref, allOf, oneOf and nullable types resolve; enums read from the YAML', () => {
  const m = load('payment-service/payment-api.yaml');
  const payment = resolveSchema({ $ref: '#/components/schemas/Payment' }, m.root).schema;
  assert.ok(payment.properties.amount && payment.properties.status);
  assert.ok(payment.required.includes('amount'));
  const status = resolveSchema(payment.properties.status, m.root).schema;
  assert.equal(widgetFor(status), 'enum');
  assert.deepEqual(status.enum, ['pending', 'authorized', 'captured', 'failed', 'refunded']);
  const method = resolveSchema(payment.properties.method, m.root).schema;
  assert.equal(widgetFor(method), 'variant');
  const v2 = load('payment-service/payment-v2.yaml');
  const desc = op(v2, 'POST /payment-intents').requestBody.contents[0].schema.properties.statementDescriptor;
  const r = resolveSchema(desc, v2.root).schema;
  assert.equal(r.type, 'string');
  assert.equal(r.nullable, true);
});

test('recursive schemas are detected instead of looping', () => {
  const root = { components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } } };
  const top = resolveSchema({ $ref: '#/components/schemas/Node' }, root);
  const child = resolveSchema(top.schema.properties.child, root, top.refs);
  assert.equal(child.recursive, true);
  assert.equal(sampleValue({ $ref: '#/components/schemas/Node' }, root).child?.child, undefined);
});

test('value validation: required, enum, ranges, formats, nested objects and arrays', () => {
  const m = load('user-service/user-api.yaml');
  const schema = op(m, 'POST /users').requestBody.contents[0].schema;
  const errs = validateValue(schema, { name: 'A', email: 'nope', status: 'archived', age: 9, address: { country: 'FR' } }, m.root, {
    path: 'body',
    required: true,
  });
  assert.match(errs['body.name'], /at least 2/);
  assert.match(errs['body.email'], /email/);
  assert.match(errs['body.status'], /Active, Inactive, Pending/);
  assert.match(errs['body.age'], /at least 13/);
  assert.match(errs['body.address.country'], /Choose one of/);

  const missing = validateValue(schema, undefined, m.root, { path: 'body', required: true });
  assert.deepEqual(Object.keys(missing).sort(), ['body.email', 'body.name', 'body.status']);

  const ok = validateValue(schema, { name: 'Asha', email: 'a@b.co', status: 'active' }, m.root, { path: 'body', required: true });
  assert.deepEqual(ok, {});

  const arr = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'integer' } };
  assert.match(validateValue(arr, [1, 1], {}, { path: 'a' }).a, /unique/);
  assert.match(validateValue(arr, [1.5], {}, { path: 'a' })['a[0]'], /whole number/);
});

test('defaults pre-fill and sample data follows examples', () => {
  const m = load('payment-service/payment-api.yaml');
  const schema = op(m, 'POST /payments').requestBody.contents[0].schema;
  assert.deepEqual(initialValue(schema, m.root), { currency: 'USD', captureMode: 'automatic' });
  const sample = sampleValue(schema, m.root);
  assert.equal(sample.amount, 2500);
  assert.equal(sample.method.number, '4242424242424242');
  assert.equal(sample.customer.email, 'user@example.com');
  assert.equal(sample.id, undefined, 'readOnly fields are skipped');
  assert.deepEqual(validateValue(schema, sample, m.root, { path: 'body', required: true }), {});
});

test('request URL = base URL + base path + endpoint, with params, headers and body', () => {
  assert.equal(joinUrl('https://api.example.com', '/api/v1', '/users'), 'https://api.example.com/api/v1/users');
  assert.equal(joinUrl('https://api.example.com/', 'api/v1/', 'users'), 'https://api.example.com/api/v1/users');
  assert.equal(joinUrl('', '/api/v1', '/users'), '/api/v1/users');

  const m = load('user-service/user-api.yaml');
  const req = buildRequest({
    operation: op(m, 'GET /users/{id}'),
    values: { path: { id: 42 }, query: { status: 'active' } },
    settings: { baseUrl: 'https://api.example.com', basePath: '/api/v1', defaultHeaders: [{ name: 'X-Team', value: 'radar' }] },
    servers: m.servers,
  });
  assert.equal(req.url, 'https://api.example.com/api/v1/users/42?status=active');
  assert.equal(req.headers['X-Team'], 'radar');

  const fallback = buildRequest({ operation: op(m, 'GET /users'), values: {}, settings: {}, servers: m.servers });
  assert.equal(fallback.url, 'https://api.example.com/users', 'falls back to the YAML server');

  const post = buildRequest({
    operation: op(m, 'POST /users'),
    body: { name: 'Asha', email: '', status: 'active' },
    settings: { baseUrl: 'https://x.test' },
    auth: { type: 'bearer', token: 'secret' },
  });
  assert.deepEqual(post.body.json, { name: 'Asha', status: 'active' }, 'empty values are not sent');
  assert.equal(post.headers.Authorization, 'Bearer secret');
  assert.match(toCurl(post), /Authorization: ••••••/);
  assert.doesNotMatch(toCurl(post), /secret/);
});
