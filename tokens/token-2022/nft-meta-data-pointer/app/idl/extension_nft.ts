export type ExtensionNft = {
    address: 'H31ofLpWqeAzF2Pg54HSPQGYifJad843tTJg8vCYVoh3';
    metadata: {
        name: 'extension_nft';
        version: '0.1.0';
        spec: '0.1.0';
    };
    version: '0.1.0';
    name: 'extension_nft';
    instructions: [
        {
            name: 'initPlayer';
            discriminator: [218, 66, 97, 209, 99, 22, 158, 199];
            accounts: [
                {
                    name: 'player';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'gameData';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'signer';
                    isMut: true;
                    isSigner: true;
                },
                {
                    name: 'systemProgram';
                    isMut: false;
                    isSigner: false;
                },
            ];
            args: [
                {
                    name: 'levelSeed';
                    type: 'string';
                },
            ];
        },
        {
            name: 'chopTree';
            discriminator: [239, 143, 6, 72, 108, 119, 167, 156];
            accounts: [
                {
                    name: 'sessionToken';
                    isMut: false;
                    isSigner: false;
                    optional: true;
                },
                {
                    name: 'player';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'gameData';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'signer';
                    isMut: true;
                    isSigner: true;
                },
                {
                    name: 'systemProgram';
                    isMut: false;
                    isSigner: false;
                },
                {
                    name: 'mint';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'nftAuthority';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'tokenProgram';
                    isMut: false;
                    isSigner: false;
                },
            ];
            args: [
                {
                    name: 'levelSeed';
                    type: 'string';
                },
                {
                    name: 'counter';
                    type: 'u16';
                },
            ];
        },
        {
            name: 'mintNft';
            discriminator: [245, 247, 58, 90, 129, 73, 62, 228];
            accounts: [
                {
                    name: 'signer';
                    isMut: true;
                    isSigner: true;
                },
                {
                    name: 'systemProgram';
                    isMut: false;
                    isSigner: false;
                },
                {
                    name: 'tokenProgram';
                    isMut: false;
                    isSigner: false;
                },
                {
                    name: 'tokenAccount';
                    isMut: true;
                    isSigner: false;
                },
                {
                    name: 'mint';
                    isMut: true;
                    isSigner: true;
                },
                {
                    name: 'rent';
                    isMut: false;
                    isSigner: false;
                },
                {
                    name: 'associatedTokenProgram';
                    isMut: false;
                    isSigner: false;
                },
                {
                    name: 'nftAuthority';
                    isMut: true;
                    isSigner: false;
                },
            ];
            args: [];
        },
    ];
    accounts: [
        {
            name: 'nftAuthority';
            discriminator: [3, 176, 246, 106, 104, 231, 175, 162];
        },
        {
            name: 'gameData';
            discriminator: [193, 17, 100, 157, 52, 32, 121, 71];
        },
        {
            name: 'playerData';
            discriminator: [13, 233, 221, 44, 139, 185, 62, 42];
        },
    ];
    types: [
        {
            name: 'nftAuthority';
            type: {
                kind: 'struct';
                fields: [];
            };
        },
        {
            name: 'gameData';
            type: {
                kind: 'struct';
                fields: [
                    {
                        name: 'totalWoodCollected';
                        type: 'u64';
                    },
                ];
            };
        },
        {
            name: 'playerData';
            type: {
                kind: 'struct';
                fields: [
                    {
                        name: 'authority';
                        type: 'pubkey';
                    },
                    {
                        name: 'name';
                        type: 'string';
                    },
                    {
                        name: 'level';
                        type: 'u8';
                    },
                    {
                        name: 'xp';
                        type: 'u64';
                    },
                    {
                        name: 'wood';
                        type: 'u64';
                    },
                    {
                        name: 'energy';
                        type: 'u64';
                    },
                    {
                        name: 'lastLogin';
                        type: 'i64';
                    },
                    {
                        name: 'lastId';
                        type: 'u16';
                    },
                ];
            };
        },
    ];
    errors: [
        {
            code: 6000;
            name: 'NotEnoughEnergy';
            msg: 'Not enough energy';
        },
        {
            code: 6001;
            name: 'WrongAuthority';
            msg: 'Wrong Authority';
        },
    ];
};

export const IDL: ExtensionNft = {
    address: 'H31ofLpWqeAzF2Pg54HSPQGYifJad843tTJg8vCYVoh3',
    metadata: {
        name: 'extension_nft',
        version: '0.1.0',
        spec: '0.1.0',
    },
    version: '0.1.0',
    name: 'extension_nft',
    instructions: [
        {
            name: 'initPlayer',
            discriminator: [218, 66, 97, 209, 99, 22, 158, 199],
            accounts: [
                {
                    name: 'player',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'gameData',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'signer',
                    isMut: true,
                    isSigner: true,
                },
                {
                    name: 'systemProgram',
                    isMut: false,
                    isSigner: false,
                },
            ],
            args: [
                {
                    name: 'levelSeed',
                    type: 'string',
                },
            ],
        },
        {
            name: 'chopTree',
            discriminator: [239, 143, 6, 72, 108, 119, 167, 156],
            accounts: [
                {
                    name: 'sessionToken',
                    isMut: false,
                    isSigner: false,
                    optional: true,
                },
                {
                    name: 'player',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'gameData',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'signer',
                    isMut: true,
                    isSigner: true,
                },
                {
                    name: 'systemProgram',
                    isMut: false,
                    isSigner: false,
                },
                {
                    name: 'mint',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'nftAuthority',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'tokenProgram',
                    isMut: false,
                    isSigner: false,
                },
            ],
            args: [
                {
                    name: 'levelSeed',
                    type: 'string',
                },
                {
                    name: 'counter',
                    type: 'u16',
                },
            ],
        },
        {
            name: 'mintNft',
            discriminator: [245, 247, 58, 90, 129, 73, 62, 228],
            accounts: [
                {
                    name: 'signer',
                    isMut: true,
                    isSigner: true,
                },
                {
                    name: 'systemProgram',
                    isMut: false,
                    isSigner: false,
                },
                {
                    name: 'tokenProgram',
                    isMut: false,
                    isSigner: false,
                },
                {
                    name: 'tokenAccount',
                    isMut: true,
                    isSigner: false,
                },
                {
                    name: 'mint',
                    isMut: true,
                    isSigner: true,
                },
                {
                    name: 'rent',
                    isMut: false,
                    isSigner: false,
                },
                {
                    name: 'associatedTokenProgram',
                    isMut: false,
                    isSigner: false,
                },
                {
                    name: 'nftAuthority',
                    isMut: true,
                    isSigner: false,
                },
            ],
            args: [],
        },
    ],
    accounts: [
        {
            name: 'nftAuthority',
            discriminator: [3, 176, 246, 106, 104, 231, 175, 162],
        },
        {
            name: 'gameData',
            discriminator: [193, 17, 100, 157, 52, 32, 121, 71],
        },
        {
            name: 'playerData',
            discriminator: [13, 233, 221, 44, 139, 185, 62, 42],
        },
    ],
    types: [
        {
            name: 'nftAuthority',
            type: {
                kind: 'struct',
                fields: [],
            },
        },
        {
            name: 'gameData',
            type: {
                kind: 'struct',
                fields: [
                    {
                        name: 'totalWoodCollected',
                        type: 'u64',
                    },
                ],
            },
        },
        {
            name: 'playerData',
            type: {
                kind: 'struct',
                fields: [
                    {
                        name: 'authority',
                        type: 'pubkey',
                    },
                    {
                        name: 'name',
                        type: 'string',
                    },
                    {
                        name: 'level',
                        type: 'u8',
                    },
                    {
                        name: 'xp',
                        type: 'u64',
                    },
                    {
                        name: 'wood',
                        type: 'u64',
                    },
                    {
                        name: 'energy',
                        type: 'u64',
                    },
                    {
                        name: 'lastLogin',
                        type: 'i64',
                    },
                    {
                        name: 'lastId',
                        type: 'u16',
                    },
                ],
            },
        },
    ],
    errors: [
        {
            code: 6000,
            name: 'NotEnoughEnergy',
            msg: 'Not enough energy',
        },
        {
            code: 6001,
            name: 'WrongAuthority',
            msg: 'Wrong Authority',
        },
    ],
};
