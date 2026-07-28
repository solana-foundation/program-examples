// @ts-check
const path = require('node:path');
const programDir = path.join(__dirname);
const idlDir = path.join(__dirname, 'idl');
const sdkDir = path.join(__dirname, 'ts', 'generated');
const binaryInstallDir = path.join(__dirname, 'target', 'solita');

module.exports = {
    idlGenerator: 'shank',
    programName: 'counter_mpl_stack',
    programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
    idlDir,
    sdkDir,
    binaryInstallDir,
    programDir,
};
