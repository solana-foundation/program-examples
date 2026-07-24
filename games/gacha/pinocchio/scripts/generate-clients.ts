import type { AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor as renderJavaScriptVisitor } from '@codama/renderers-js';
import { renderVisitor as renderRustVisitor } from '@codama/renderers-rust';
import { createFromJson } from 'codama';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.join(__dirname, '..');
const idlPath = path.join(projectRoot, 'idl', 'gacha.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8')) as AnchorIdl;
const rustClientsDir = path.join(projectRoot, 'clients', 'rust');
const typescriptClientsDir = path.join(projectRoot, 'clients', 'typescript');

const codama = createFromJson(JSON.stringify(idl));

void codama.accept(
    renderRustVisitor(rustClientsDir, {
        anchorTraits: false,
        deleteFolderBeforeRendering: true,
        formatCode: true,
        generatedFolder: 'src/generated',
    }),
);

void codama.accept(
    renderJavaScriptVisitor(typescriptClientsDir, {
        deleteFolderBeforeRendering: true,
        formatCode: true,
        generatedFolder: 'src/generated',
    }),
);
