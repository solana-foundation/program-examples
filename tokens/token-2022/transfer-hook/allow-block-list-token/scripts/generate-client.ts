import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appRoot = path.join(__dirname, '..');
// `anchor build` writes an IDL carrying whatever program id `declare_id!` currently holds, so
// preferring it keeps the generated client pointed at the program a local deploy actually
// creates - including after `anchor keys sync` assigns a fresh keypair. The committed copy
// under `idl/` is the fallback for checkouts that have never been built, such as CI and
// `next build`.
const builtIdlPath = path.join(appRoot, 'anchor', 'target', 'idl', 'abl_token.json');
const committedIdlPath = path.join(appRoot, 'idl', 'abl_token.json');
const idlPath = fs.existsSync(builtIdlPath) ? builtIdlPath : committedIdlPath;
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as AnchorIdl;
const generatedDir = path.join(appRoot, 'src', 'generated');

console.log(`Generating client from ${path.relative(appRoot, idlPath)}`);

const codama = createFromRoot(rootNodeFromAnchor(idl));

void (async () => {
    await Promise.resolve(
        codama.accept(
            renderVisitor(generatedDir, {
                deleteFolderBeforeRendering: true,
                dependencyVersions: {
                    '@solana/kit': '^7.1.0',
                    '@solana/program-client-core': '^7.1.0',
                },
                formatCode: true,
                generatedFolder: '.',
            }),
        ),
    );
})();
