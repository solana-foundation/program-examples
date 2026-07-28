import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as p from 'picocolors';
import { changePackageVersion } from './change-package-version';

import { getDepsCount } from './get-deps-count';
import { getRecursiveFileList } from './get-recursive-file-list';

export function commandUpdate(path = '.', packageNames: string[] = []) {
    const files = getRecursiveFileList(path).filter(file => basename(file) === 'package.json');
    const depsCounter = getDepsCount(files);
    const pkgNames = Object.keys(depsCounter).sort();
    if (packageNames.length > 0) {
        console.log(`Updating ${packageNames.join(', ')} in ${files.length} files`);
    }

    let total = 0;
    for (const pkgName of pkgNames.filter(pkgName => packageNames.length === 0 || packageNames.includes(pkgName))) {
        // Get latest version from npm
        const npmVersion = execSync(`npm view ${pkgName} version`).toString().trim();

        let count = 0;
        for (const file of files) {
            const [changed, content] = changePackageVersion(file, pkgName, `^${npmVersion}`);
            if (changed) {
                writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
                count++;
            }
        }
        total += count;

        if (count === 0) {
            console.log(p.dim(`Package ${pkgName} is up to date ${npmVersion}`));
            continue;
        }
        console.log(p.green(` -> Updated ${count} files with ${pkgName} ${npmVersion}`));
    }

    if (total === 0) {
        console.log('No files updated');
    } else {
        console.log(`Updated ${total} files`);
    }
}
