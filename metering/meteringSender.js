'use strict';

const https = require('node:https');
const { randomUUID } = require('node:crypto');
const debug = require('debug')('petclinic:metering');

let bindingWarned = false;

/**
 * Read the `metering-service` binding from VCAP_SERVICES. Returns null when
 * the binding, credentials or ingestion endpoint are absent.
 */
function readMeteringBinding() {
    const raw = process.env.VCAP_SERVICES;
    if (!raw) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        debug('metering binding parse failed: %s', err.message);
        return null;
    }

    let instance = null;
    for (const key of Object.keys(parsed)) {
        const entries = Array.isArray(parsed[key]) ? parsed[key] : [];
        for (const entry of entries) {
            if (entry && (entry.label === 'metering-service' || entry.name === 'metering-service')) {
                instance = entry;
                break;
            }
        }
        if (instance) {
            break;
        }
    }
    if (!instance) {
        return null;
    }

    const credentials = instance.credentials || {};
    const endpoints = credentials.endpoints || {};
    const certificate = credentials.certificate;
    const privateKey = credentials.key;
    const usageIngestion = endpoints.usageIngestion;

    if (!certificate || !privateKey || !usageIngestion) {
        return null;
    }

    return {
        cert: String(certificate).replace(/\\n/g, '\n'),
        key: String(privateKey).replace(/\\n/g, '\n'),
        usageIngestion: usageIngestion
    };
}

/**
 * Build the consumer object from environment configuration. subAccount wins
 * when provided (non-empty); otherwise globalAccount is used. Neither is ever
 * sent as an empty string.
 */
function buildConsumer() {
    const btp = {
        environment: process.env.UM_ENVIRONMENT
    };
    const subAccount = process.env.UM_SUBACCOUNT_ID;
    const globalAccount = process.env.UM_GLOBAL_ACCOUNT_ID;
    if (subAccount && subAccount.length > 0) {
        btp.subAccount = subAccount;
    } else if (globalAccount && globalAccount.length > 0) {
        btp.globalAccount = globalAccount;
    }
    return {
        region: process.env.UM_REGION,
        btp: btp
    };
}

/**
 * Fire-and-forget submission of a single measure value to the SAP BTP Unified
 * Metering datastream (REST ingestion, mutual TLS). The payload contains only
 * the measure id, numeric value, timestamp, generated event id and non-personal
 * consumer/product identifiers from configuration. Only the HTTP status code is
 * logged; the payload is never logged. This function never throws.
 */
async function sendMeasure(measureId, value) {
    const binding = readMeteringBinding();
    if (!binding) {
        if (!bindingWarned) {
            bindingWarned = true;
            debug('metering binding absent \u2013 skipping submission');
        }
        return;
    }

    const body = [{
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        consumer: buildConsumer(),
        product: {
            service: {
                id: process.env.UM_SERVICE_ID
            }
        },
        measure: {
            id: measureId,
            value: value
        }
    }];

    let url;
    try {
        const base = binding.usageIngestion.replace(/\/$/, '');
        url = new URL(base + '/namespaces/metering/datastreams/eventBatch');
    } catch (err) {
        debug('metering endpoint invalid: %s', err.message);
        return;
    }

    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const agent = new https.Agent({ cert: binding.cert, key: binding.key });

    const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + (url.search || ''),
        agent: agent,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    };

    try {
        await new Promise(function(resolve) {
            const req = https.request(options, function(res) {
                // Drain the response so the socket can be reused/closed.
                res.on('data', function() {});
                res.on('end', function() {
                    debug('metering submission status=%d', res.statusCode);
                    resolve();
                });
            });
            req.on('error', function(err) {
                debug('metering submission failed: %s', err.message);
                resolve();
            });
            req.write(payload);
            req.end();
        });
    } catch (err) {
        debug('metering submission threw: %s', err && err.message ? err.message : err);
    }
}

module.exports = { sendMeasure };
