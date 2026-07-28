/*
 * 亿方听力大师 (ListextEditor)
 * Copyright (C) 2026 The InspireWorks Development Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  const NETWORK_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'];
  if (NETWORK_CODES.includes(code)) return true;
  // msedge-tts 经 WebSocket 包装后的错误常无 code，用 message 兜底
  const msg = String(error?.message || error || '');
  return /network|socket|getaddrinfo|fetch failed|unexpected server response|stream closed|econn|timed? ?out/i.test(msg);
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
