import { setLogLevel } from '../../src/lib/logger.js';

// The dispatcher logs every delivery, which is right in production and noise in a test run.
// Errors still print. Set LOG_LEVEL=debug to see everything while debugging a test.
setLogLevel(process.env['LOG_LEVEL'] === 'debug' ? 'debug' : 'error');
