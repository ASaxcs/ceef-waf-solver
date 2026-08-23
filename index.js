/**
 * Root entry point for CEEF WAF Solver.
 * Forwards execution to src/index.js.
 * This guarantees compatibility when running `node index.js`, `node .`, or `npm start`
 * across all hosting panels (including Pterodactyl Panel).
 */
require('./src/index.js');
