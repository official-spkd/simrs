import { browser } from '@simrs/config/eslint';

export default [...browser, { ignores: ['postcss.config.mjs', 'playwright-report/**', 'test-results/**'] }];
