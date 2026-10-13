'use strict';
// POST /api/orders: the hamper builder's quotation request. Logic lives in lib/endpoints.js.
module.exports = require('../lib/endpoints').makeEndpoint('order', process.env);
