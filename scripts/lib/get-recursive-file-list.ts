// Point method at path and return a list of all the files in the directory recursively
import { readdirSync, statSync } from 'node:fs';

export function getRecursiveFileList(path: string): string[] {
    const ignore = ['.git', '.github', '.idea', '.next', '.vercel', '.vscode', 'coverage', 'dist', 'node_modules'];
    const files: string[] = [];

    const items = readdirSync(path);

    for (const item of items) {
        if (!ignore.includes(item)) {
            // Check out if it's a directory or a file
            const isDir = statSync(`${path}/${item}`).isDirectory();
            if (isDir) {
                // If it's a directory, recursively call the method
                files.push(...getRecursiveFileList(`${path}/${item}`));
            } else {
                // If it's a file, add it to the array of files
                files.push(`${path}/${item}`);
            }
        }
    }

    return files.filter(file => {
        // Remove package.json from the root directory
        return path === '.' ? file !== './package.json' : true;
    });
}
