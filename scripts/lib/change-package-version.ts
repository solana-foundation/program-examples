import { readFileSync } from 'node:fs';

export function changePackageVersion(file: string, pkgName: string, pkgVersion: string): [boolean, string] {
    const content = JSON.parse(readFileSync(file).toString('utf-8'));
    if (content.dependencies?.[pkgName] && content.dependencies[pkgName] !== pkgVersion) {
        content.dependencies[pkgName] = pkgVersion;
        return [true, content];
    }
    if (content.devDependencies?.[pkgName] && content.devDependencies[pkgName] !== pkgVersion) {
        content.devDependencies[pkgName] = pkgVersion;
        return [true, content];
    }
    return [false, content];
}
