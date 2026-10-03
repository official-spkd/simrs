import { loadConfig } from './config';
import { buildServer } from './server';
import { MockState } from './state';

const config = loadConfig();
const app = buildServer(config, new MockState());

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.warn(`Mock integrasi + panel kendali: http://localhost:${config.port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
