'use strict';

const debug = require('debug')('petclinic:metering');
const RequestCount = require('../models/RequestCount');
const { sendMeasure } = require('./meteringSender');

const MEASURE_ID = 'HS_PET_CLINIC_MONTLY_USER_COUNT';
const FLUSH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Read the current calendar-month (UTC) counter and submit it as the current
 * monthly aggregate to SAP Unified Metering. Submitting a running monthly SUM
 * matches Unified Metering's monthly aggregation semantics (the service takes
 * the max/last value per measure per month), so hourly resubmission of the
 * growing counter produces the correct calendar-month total.
 */
async function flush() {
    const month = new Date().toISOString().slice(0, 7);
    let value = 0;
    try {
        const doc = await RequestCount.findOne({ month: month }).lean().exec();
        value = doc && typeof doc.count === 'number' ? doc.count : 0;
    } catch (err) {
        debug('metering flush read failed: %s', err && err.message ? err.message : err);
        return;
    }
    await sendMeasure(MEASURE_ID, value);
}

/**
 * Start the hourly flush. Fires an immediate tick on startup so the first
 * submission does not have to wait an hour. All errors are logged and never
 * propagated.
 */
function startMeteringScheduler() {
    flush().catch(function(err) {
        debug('metering flush failed: %s', err && err.message ? err.message : err);
    });
    const handle = setInterval(function() {
        flush().catch(function(err) {
            debug('metering flush failed: %s', err && err.message ? err.message : err);
        });
    }, FLUSH_INTERVAL_MS);
    if (handle && typeof handle.unref === 'function') {
        handle.unref();
    }
    return handle;
}

module.exports = { startMeteringScheduler };
