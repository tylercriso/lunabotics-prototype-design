import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/lunabotics-prototype-design/' : '/',
});
