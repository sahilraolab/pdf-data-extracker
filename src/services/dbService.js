'use strict';

const path      = require('path');
const fs        = require('fs');
const Datastore = require('@seald-io/nedb');

const DATA_DIR = path.join(__dirname, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const users = new Datastore({ filename: path.join(DATA_DIR, 'users.db'), autoload: true });
const leads = new Datastore({ filename: path.join(DATA_DIR, 'leads.db'),  autoload: true });

users.ensureIndex({ fieldName: 'email', unique: true });
leads.ensureIndex({ fieldName: 'createdAt' });

module.exports = { users, leads };
