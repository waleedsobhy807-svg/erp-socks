/**
 * @module index
 * @description AWS Lambda entry point for the Socks Factory ERP API.
 * API Gateway HTTP API calls this single function; the router dispatches
 * to the correct module handler based on method + path.
 */

import { dispatch } from './router.js';

export const handler = dispatch;
