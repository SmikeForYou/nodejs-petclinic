'use strict';

const debug = require('debug')('petclinic:metering');
const RequestCount = require('../models/RequestCount');

/**
 * Express middleware that counts every inbound HTTP request handled by the
 * PetClinic application exactly once, independent of path, method, outcome or
 * authentication state. Requests are assigned to a calendar month (UTC) using
 * event time and persisted atomically via an upsert $inc on the RequestCount
 * collection, so counts survive process restarts and span the full month.
 *
 * The increment is fire-and-forget: next() is invoked synchronously before the
 * Mongoose write is awaited, so metering never delays or breaks the request.
 */
function meteringMiddleware(req, res, next) {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)

    // Fire-and-forget atomic increment. Any error (including no DB connection)
    // is logged and swallowed; it must never affect request handling.
    RequestCount.findOneAndUpdate(
        { month: month },
        { $inc: { count: 1 } },
        { upsert: true, setDefaultsOnInsert: true }
    )
        .exec()
        .catch(function(err) {
            debug('metering increment failed: %s', err && err.message ? err.message : err);
        });

    next();
}

module.exports = meteringMiddleware;
