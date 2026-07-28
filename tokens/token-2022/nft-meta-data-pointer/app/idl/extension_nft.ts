export type ExtensionNft = {
    version: '0.1.0';
    name: 'extension_nft';
    instructions: [
        {
            name: 'initPlayer';
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
            accounts: [
                {
                    name: 'sessionToken';
                    isMut: false;
                    isSigner: false;
                    isOptional: true;
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
                        type: 'publicKey';
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
    version: '0.1.0',
    name: 'extension_nft',
    instructions: [
        {
            name: 'initPlayer',
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
            accounts: [
                {
                    name: 'sessionToken',
                    isMut: false,
                    isSigner: false,
                    isOptional: true,
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
                        type: 'publicKey',
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
