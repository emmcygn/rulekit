import { defineConfig } from 'vite';

// Vite's SPA fallback would answer /plain with index.html, so the fallback gate
// would redirect into itself forever. Rewrite /plain -> /plain.html before the
// static handlers see it. Production (`serve dist`) already resolves /plain the
// same way via its default clean-URL handling.
function plainCleanUrl() {
  const rewrite = (req, _res, next) => {
    const path = req.url.split('?')[0];
    if (path === '/plain') req.url = '/plain.html' + req.url.slice(path.length);
    next();
  };
  return {
    name: 'plain-clean-url',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  base: './',
  plugins: [plainCleanUrl()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Vite 8 bundles with rolldown, which only accepts the function form here.
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/gsap')) return 'gsap';
        },
      },
    },
  },
  server: { port: 5173 },
});
