/**
 * Example projects for the browser-only build, which has no server to ask.
 * (The server build gets the same files from GET /api/workbench/samples.)
 */
import paymentApi from '../../../samples/openapi/payment-service/payment-api.yaml?raw';
import paymentV2 from '../../../samples/openapi/payment-service/payment-v2.yaml?raw';
import paymentAdmin from '../../../samples/openapi/payment-service/payment-admin.yaml?raw';
import paymentWebhook from '../../../samples/openapi/payment-service/payment-webhook.yaml?raw';
import userApi from '../../../samples/openapi/user-service/user-api.yaml?raw';
import manifest from '../../../samples/openapi/projects.json';

export default [
  {
    ...manifest.projects['payment-service'],
    files: [
      { fileName: 'payment-admin.yaml', text: paymentAdmin },
      { fileName: 'payment-api.yaml', text: paymentApi },
      { fileName: 'payment-v2.yaml', text: paymentV2 },
      { fileName: 'payment-webhook.yaml', text: paymentWebhook },
    ],
  },
  { ...manifest.projects['user-service'], files: [{ fileName: 'user-api.yaml', text: userApi }] },
];
