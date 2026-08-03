import { commandCheck, commandHelp, commandList, commandSet, commandUpdate } from './lib';

const params: string[] = process.argv.slice(3);

switch (process.argv[2]) {
    case 'check':
        commandCheck(params[0]);
        break;
    case 'list':
        commandList(params[0]);
        break;
    case 'set':
        commandSet(params[0], params[1]);
        break;
    case 'update':
        commandUpdate(params[0], params.slice(1));
        break;
    default:
        commandHelp();
        break;
}
