'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Loads configuration before any other module reads `process.env`.
 * `.env.local` (git-ignored developer overrides, e.g. a local Docker database)
 * takes precedence over `.env` (deployment values). Set ENV_FILE to load a
 * single explicit file instead, e.g. `ENV_FILE=.env.production npm start`.
 */
const envFileNames = process.env.ENV_FILE ? [process.env.ENV_FILE] : ['.env.local', '.env'];
const envFilePaths = envFileNames.map((fileName) => path.resolve(PROJECT_ROOT, fileName));

require('dotenv').config({ path: envFilePaths, quiet: true });

const loadedEnvFiles = envFilePaths.filter((filePath) => fs.existsSync(filePath));

module.exports = { PROJECT_ROOT, loadedEnvFiles };
