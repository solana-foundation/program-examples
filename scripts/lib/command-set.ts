import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { changePackageVersion } from './change-package-version';
import { getRecursiveFileList } from './get-recursive-file-list';

export function commandSet(version: string, path = '.') {
    if (!version) {
        console.error('Version is required');
        process.exit(1);
    }
    if (
        !version
            // Strip first character if it's a `@`
            .replace(/^@/, '')
            .includes('@')
    ) {
        console.error(`Invalid package version: ${version}. Provide package with version, e.g. @solana/web3.js@1.0.0`);
        process.exit(1);
    }
    // Take anything after the second `@` as the version, the rest is the package name
    const [pkg, ...rest] = version.split('@').reverse();
    const pkgName = rest.reverse().join('@');

    // Make sure pkgVersions has a ^ prefix, if not add it
    const pkgVersion = pkg.startsWith('^') ? pkg : `^${pkg}`;

    console.log(`Setting package ${pkgName} to ${pkgVersion} in ${path}`);

    const files = getRecursiveFileList(path).filter(file => basename(file) === 'package.json');
    let count = 0;
    for (const file of files) {
        const [changed, content] = changePackageVersion(file, pkgName, pkgVersion);
        if (changed) {
            writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
            count++;
        }
    }
    if (count === 0) {
        console.log('No files updated');
    } else {
        console.log(`Updated ${count} files`);
    }
}
