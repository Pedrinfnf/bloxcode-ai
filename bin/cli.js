#!/usr/bin/env node

import { createApp } from "../src/index.js";

try {
  const app = await createApp();
  await app.run();
} catch (err) {
  if (err?.code !== "ERR_USE_AFTER_CLOSE") {
    console.error("\n💥 FATAL:", err.message || err);
  }
  process.exit(0);
}
