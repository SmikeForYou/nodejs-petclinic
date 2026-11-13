'use strict';

const mongoose = require('mongoose');

const requestCountSchema = new mongoose.Schema({
    month: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    count: {
        type: Number,
        required: true,
        default: 0
    }
});

module.exports = mongoose.model('RequestCount', requestCountSchema);
