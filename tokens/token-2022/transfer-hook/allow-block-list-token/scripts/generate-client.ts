import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appRoot = path.join(__dirname, '..');
const idlPath = path.join(appRoot, 'idl', 'abl_token.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as AnchorIdl;
const generatedDir = path.join(appRoot, 'src', 'generated');

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
