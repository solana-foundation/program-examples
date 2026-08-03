import { readFileSync } from 'node:fs';

export function getDepsCount(files: string[] = []): Record<string, Record<string, string[]>> {
    const map: Record<string, JSON> = {};
    const depsCounter: Record<string, Record<string, string[]>> = {};

    for (const file of files) {
        const content = JSON.parse(readFileSync(file).toString('utf-8'));
        map[file] = content;

        const deps = content.dependencies ?? {};
        const devDeps = content.devDependencies ?? {};

        const merged = { ...deps, ...devDeps };

        for (const pkg of Object.keys(merged).sort()) {
            const pkgVersion = merged[pkg];
            if (!depsCounter[pkg]) {
                depsCounter[pkg] = { [pkgVersion]: [file] };
                continue;
            }
            if (!depsCounter[pkg][pkgVersion]) {
                depsCounter[pkg][pkgVersion] = [file];
                continue;
            }
            depsCounter[pkg][pkgVersion] = [...depsCounter[pkg][pkgVersion], file];
        }
    }
    return depsCounter;
}
