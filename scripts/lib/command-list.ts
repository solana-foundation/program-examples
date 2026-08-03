import { basename } from 'node:path';
import { getRecursiveFileList } from './get-recursive-file-list';

export function commandList(path: string) {
    const files = getRecursiveFileList(path).filter(file => basename(file) === 'package.json');
    for (const file of files) {
        console.log(file);
    }
}
