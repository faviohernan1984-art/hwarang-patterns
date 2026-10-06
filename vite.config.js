/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(async ({ command }) => {
  const plugins = [react()];
  if (command === 'serve' && process.env.PATTERNS_DEV_PRESIDENT === 'true') {
    const { devPresidentPlugin } = await import('./scripts/devPresidentPlugin.js');
    plugins.push(devPresidentPlugin(process.env));
  }
  return { plugins };
})
