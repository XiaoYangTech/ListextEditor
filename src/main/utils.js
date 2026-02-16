const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupCrypto() {
  const { v4: uuidv4 } = require('uuid');
  let nodeRandomUUID = null;
  try {
    nodeRandomUUID = require('crypto').randomUUID;
  } catch (e) {
    nodeRandomUUID = null;
  }
  if (!global.crypto) {
    global.crypto = {};
  }
  if (!global.crypto.randomUUID) {
    global.crypto.randomUUID = nodeRandomUUID || uuidv4;
  }
}

module.exports = {
  ensureDir,
  isNetworkError,
  sleep,
  setupCrypto
};
