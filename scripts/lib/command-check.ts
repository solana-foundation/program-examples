import { basename } from 'node:path';
import * as p from 'picocolors';
import { getDepsCount } from './get-deps-count';
import { getRecursiveFileList } from './get-recursive-file-list';

export function commandCheck(path = '.') {
    const files = getRecursiveFileList(path).filter(file => basename(file) === 'package.json');
    const depsCounter = getDepsCount(files);

    const single: string[] = [];
    const multiple: string[] = [];

    for (const pkg of Object.keys(depsCounter).sort()) {
        const versions = depsCounter[pkg];
        const versionMap = Object.keys(versions).sort();
        const versionsLength = versionMap.length;

        if (versionsLength === 1) {
            const count = versions[versionMap[0]].length;
            single.push(`${p.green('✔')} ${pkg}@${versionMap[0]} (${count})`);
            continue;
        }

        const versionCount: { version: string; count: number }[] = [];
        for (const version of versionMap) {
            versionCount.push({ version, count: versions[version].length });
        }
        versionCount.sort((a, b) => b.count - a.count);

        multiple.push(`${p.yellow('⚠')} ${pkg} has ${versionsLength} versions:`);

        for (const { count, version } of versionCount) {
            multiple.push(`  - ${p.bold(version)} (${count})`);
        }
    }

    for (const string of [...single.sort(), ...multiple]) {
        console.log(string);
    }
}
