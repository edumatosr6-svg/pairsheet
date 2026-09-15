import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
await viteBuild({configFile:'vite.standalone.config.ts'});
await build({entryPoints:['server/index.ts'],outfile:'dist/node/server.mjs',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await build({entryPoints:['server/vercel-api.ts'],outfile:'api/index.mjs',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
console.log('SIMAS pronto: npm start');
