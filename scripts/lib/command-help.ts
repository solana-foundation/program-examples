export function commandHelp() {
    console.log('Usage: yarn sync-package-json <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  check  <path>        Check package.json files');
    console.log('  help                 Show this help');
    console.log('  list   <path>        List package.json files');
    console.log('  set    [ver] <path>  Set specific version in package.json files');
    console.log('  update <path> <pkgs> Update all versions in package.json files');
    console.log('');
    console.log('Arguments:');
    console.log('  path    Path to directory');
    console.log('');
    console.log('Examples:');
    console.log('  yarn sync-package-json check');
    console.log('  yarn sync-package-json check basics');
    console.log('  yarn sync-package-json list');
    console.log('  yarn sync-package-json list basics');
    console.log('  yarn sync-package-json help');
    console.log('  yarn sync-package-json set @coral-xyz/anchor@0.29.0');
    console.log('  yarn sync-package-json set @coral-xyz/anchor@0.29.0 basics');
    console.log('  yarn sync-package-json update');
    console.log('  yarn sync-package-json update basics');
    console.log('  yarn sync-package-json update . @solana/web3.js @solana/spl-token');
    process.exit(0);
}
