'use strict';
// POST /api/enquiries: the homepage enquiry form. Logic lives in lib/endpoints.js.
module.exports = require('../lib/endpoints').makeEndpoint('enquiry', process.env);
