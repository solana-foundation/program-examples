## Token Extension MetaData Pointer NFT

This is a simple example of a program that creates a NFT using the new token extension program and facilitating the token extension meta data pointer.

The cool thing about this especially for games is that we can now have additional metadata fields on chain as a key value store which can be used to save the state of the game character. In this example we save the level and the collected wood of the player.

This opens all kind of interesting possibilities for games. You can for example save the level and xp of the player, the current weapon and armor, the current quest and so on. When market places will eventually support additional meta data the nfts could be filtered and ordered by the meta data fields and NFTs with better values like higher level could potentially gain more value by playing.

The nft will be created in an anchor program so it is very easy to mint from the js client. The name, uri and symbol are saved in the meta data extension which is pointed to the mint.

The nft will have a name, symbol and a uri. The uri is a link to a json file which contains the meta data of the nft.

There is a video walkthrough of this example on the Solana Foundation Youtube channel.

[![Solana Foundation Youtube channel]](https://www.youtube.com/@SolanaFndn/videos)

# How to run this example

Running the tests

```shell
cd program
anchor test --detach
```

Then you can set your https://solana.explorer.com url to local net an look at the transactions.

The program is also already deployed to dev net so you can try it out on dev net.
Starting the js client

```shell
cd app
yarn install
yarn dev
```

# Minting the NFT

For the creating of the NFT we perform the following steps:

1. Create a mint account
2. Initialize the mint account
3. Create a metadata pointer account
4. Initialize the metadata pointer account
5. Create the metadata account
6. Initialize the metadata account
7. Create the associated token account
8. Mint the token to the associated token account
9. Freeze the mint authority

Here is the rust code for the minting of the NFT:

```rust
let space = ExtensionType::try_calculate_account_len::<Mint>(
        &[ExtensionType::MetadataPointer])
        .unwrap();

    // This is the space required for the metadata account.
    // We put the meta data into the mint account at the end so we
    // don't need to create and additional account.
    let meta_data_space = 250;

    let lamports_required = (Rent::get()?).minimum_balance(space + meta_data_space);

    msg!(
        "Create Mint and metadata account size and cost: {} lamports: {}",
        space as u64,
        lamports_required
    );

    system_program::create_account(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports_required,
        space as u64,
        &ctx.accounts.token_program.key(),
    )?;

    // Assign the mint to the token program
    system_program::assign(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            system_program::Assign {
                account_to_assign: ctx.accounts.mint.to_account_info(),
            },
        ),
        &token_2022::ID,
    )?;

    // Initialize the metadata pointer (Need to do this before initializing the mint)
    let init_meta_data_pointer_ix =
    spl_token_2022::extension::metadata_pointer::instruction::initialize(
        &Token2022::id(),
        &ctx.accounts.mint.key(),
        Some(ctx.accounts.nft_authority.key()),
        Some(ctx.accounts.mint.key()),
    )
    .unwrap();

    invoke(
        &init_meta_data_pointer_ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.nft_authority.to_account_info()
        ],
    )?;

    // Initialize the mint cpi
    let mint_cpi_ix = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_2022::InitializeMint2 {
            mint: ctx.accounts.mint.to_account_info(),
        },
    );

    token_2022::initialize_mint2(
        mint_cpi_ix,
        0,
        &ctx.accounts.nft_authority.key(),
        None).unwrap();

    // We use a PDA as a mint authority for the metadata account because
    // we want to be able to update the NFT from the program.
    let seeds = b"nft_authority";
    let bump = ctx.bumps.nft_authority;
    let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

    msg!("Init metadata {0}", ctx.accounts.nft_authority.to_account_info().key);

    // Init the metadata account
    let init_token_meta_data_ix =
    &spl_token_metadata_interface::instruction::initialize(
        &spl_token_2022::id(),
        ctx.accounts.mint.key,
        ctx.accounts.nft_authority.to_account_info().key,
        ctx.accounts.mint.key,
        ctx.accounts.nft_authority.to_account_info().key,
        "Beaver".to_string(),
        "BVA".to_string(),
        "https://arweave.net/MHK3Iopy0GgvDoM7LkkiAdg7pQqExuuWvedApCnzfj0".to_string(),
    );

    invoke_signed(
        init_token_meta_data_ix,
        &[ctx.accounts.mint.to_account_info().clone(), ctx.accounts.nft_authority.to_account_info().clone()],
        signer,
    )?;

    // Update the metadata account with an additional metadata field in this case the player level
    invoke_signed(
        &spl_token_metadata_interface::instruction::update_field(
            &spl_token_2022::id(),
            ctx.accounts.mint.key,
            ctx.accounts.nft_authority.to_account_info().key,
            spl_token_metadata_interface::state::Field::Key("level".to_string()),
            "1".to_string(),
        ),
        &[
            ctx.accounts.mint.to_account_info().clone(),
            ctx.accounts.nft_authority.to_account_info().clone(),
        ],
        signer
    )?;

    // Create the associated token account
    associated_token::create(
        CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: ctx.accounts.signer.to_account_info(),
            associated_token: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    // Mint one token to the associated token account of the player
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.nft_authority.to_account_info(),
            },
            signer
        ),
        1,
    )?;

    // Freeze the mint authority so no more tokens can be minted to make it an NFT
    token_2022::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::SetAuthority {
                current_authority: ctx.accounts.nft_authority.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer
        ),
        AuthorityType::MintTokens,
        None,
    )?;
```

The example is based on the Solana Games Preset

```shell
npx create-solana-game gamName
```

# Solana Game Preset

This game is ment as a starter game for on chain games.
There is a js and a unity client for this game and both are talking to a solana anchor program.

This game uses gum session keys for auto approval of transactions.
Note that neither the program nor session keys are audited. Use at your own risk.

# How to run this example

## Quickstart

The unity client and the js client are both connected to the same program and should work out of the box connecting to the already deployed program.

### Unity

Open the Unity project with Unity Version 2021.3.32.f1 (or similar), open the GameScene or LoginScene and hit play.
Use the editor login button in the bottom left. If you cant get devnet sol you can copy your address from the console and use the faucet here: https://faucet.solana.com/ to request some sol.

### Js Client

To start the js client open the project in visual studio code and run:

```bash
cd app
yarn install
yarn dev
```

To start changing the program and connecting to your own program follow the steps below.

## Installing Solana dependencies

Follow the installation here: https://www.anchor-lang.com/docs/installation
Install the latest 1.16 solana version (1.17 is not supported yet)
sh -c "$(curl -sSfL https://release.solana.com/v1.16.18/install)"

Anchor program

1. Install the [Anchor CLI](https://project-serum.github.io/anchor/getting-started/installation.html)
2. `cd anchor` to end the program directory
3. Run `anchor build` to build the program
4. Run `anchor deploy` to deploy the program
5. Copy the program id from the terminal into the lib.rs, anchor.toml and within the unity project in the AnchorService and if you use js in the anchor.ts file
6. Build and deploy again

Next js client

1. Install [Node.js](https://nodejs.org/en/download/)
2. Copy the program id into app/utils/anchor.ts
3. `cd app` to end the app directory
4. Run `yarn install` to install node modules
5. Run `yarn dev` to start the client
6. After doing changes to the anchor program make sure to copy over the types from the program into the client so you can use them. You can find the js types in the target/idl folder.

Unity client

1. Install [Unity](https://unity.com/)
2. Open the MainScene
3. Hit play
4. After doing changes to the anchor program make sure to regenerate the C# client: https://solanacookbook.com/gaming/porting-anchor-to-unity.html#generating-the-client
   Its done like this (after you have build the program):

```bash
cd program
dotnet tool install Solana.Unity.Anchor.Tool <- run once
dotnet anchorgen -i target/idl/extension_nft.json -o target/idl/ExtensionNft.cs
```

(Replace extension_nft with the name of your program)

then copy the c# code into the unity project.

## Connect to local host (optional)

To connect to local host from Unity add these links on the wallet holder game object:
http://localhost:8899
ws://localhost:8900

## Video walkthroughs

Here are two videos explaining the energy logic and session keys:
Session keys:
https://www.youtube.com/watch?v=oKvWZoybv7Y&t=17s&ab_channel=Solana
Energy system:
https://www.youtube.com/watch?v=YYQtRCXJBgs&t=4s&ab_channel=Solana

# Project structure

The anchor project is structured like this:

The entry point is in the lib.rs file. Here we define the program id and the instructions.
The instructions are defined in the instructions folder.
The state is defined in the state folder.

So the calls arrive in the lib.rs file and are then forwarded to the instructions.
The instructions then call the state to get the data and update it.

```shell
├── src
│   ├── instructions
│   │   ├── chop_tree.rs
│   │   ├── init_player.rs
│   │   └── update_energy.rs
│   ├── state
│   │   ├── game_data.rs
│   │   ├── mod.rs
│   │   └── player_data.rs
│   ├── lib.rs
│   └── constants.rs
│   └── errors.rs

```

The project uses session keys (maintained by Magic Block) for auto approving transactions using an expiring token.

# Energy System

Many casual games in traditional gaming use energy systems. This is how you can build it on chain.

If you have no prior knowledge in solana and rust programming it is recommended to start with the Solana cookbook [Hello world example](<[https://unity.com/](https://solanacookbook.com/gaming/hello-world.html#getting-started-with-your-first-solana-game)>).

## Anchor program

Here we will build a program which refills energy over time which the player can then use to perform actions in the game.
In our example it will be a lumber jack which chops trees. Every tree will reward on wood and cost one energy.

### Creating the player account

First the player needs to create an account which saves the state of our player. Notice the last_login time which will save the current unix time stamp of the player he interacts with the program.
Like this we will be able to calculate how much energy the player has at a certain point in time.
We also have a value for wood which will store the wood the lumber jack chucks in the game.

```rust

pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
    ctx.accounts.player.energy = MAX_ENERGY;
    ctx.accounts.player.last_login = Clock::get()?.unix_timestamp;
    ctx.accounts.player.authority = ctx.accounts.signer.key();
    Ok(())
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(
        init,
        payer = signer,
        space = 1000, // 8+32+x+1+8+8+8 But taking 1000 to have space to expand easily.
        seeds = [b"player".as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerData>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 1000, // 8 + 8 for anchor account discriminator and the u64. Using 1000 to have space to expand easily.
        seeds = [b"gameData".as_ref()],
        bump,
    )]
    pub game_data: Account<'info, GameData>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

### Chopping trees

Then whenever the player calls the chop_tree instruction we will check if the player has enough energy and reward him with one wood.

```rust
    #[error_code]
    pub enum ErrorCode {
        #[msg("Not enough energy")]
        NotEnoughEnergy,
    }

    pub fn chop_tree(mut ctx: Context<ChopTree>) -> Result<()> {
        let account = &mut ctx.accounts;
        update_energy(account)?;

        if ctx.accounts.player.energy == 0 {
            return err!(ErrorCode::NotEnoughEnergy);
        }

        ctx.accounts.player.wood = ctx.accounts.player.wood + 1;
        ctx.accounts.player.energy = ctx.accounts.player.energy - 1;
        msg!("You chopped a tree and got 1 log. You have {} wood and {} energy left.", ctx.accounts.player.wood, ctx.accounts.player.energy);
        Ok(())
    }
```

### Calculating the energy

The interesting part happens in the update_energy function. We check how much time has passed and calculate the energy that the player will have at the given time.
The same thing we will also do in the client. So we basically lazily update the energy instead of polling it all the time.
The is a common technic in game development.

```rust

const TIME_TO_REFILL_ENERGY: i64 = 60;
const MAX_ENERGY: u64 = 10;

pub fn update_energy(&mut self) -> Result<()> {
    // Get the current timestamp
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Calculate the time passed since the last login
    let mut time_passed: i64 = current_timestamp - self.last_login;

    // Calculate the time spent refilling energy
    let mut time_spent = 0;

    while time_passed >= TIME_TO_REFILL_ENERGY && self.energy < MAX_ENERGY {
        self.energy += 1;
        time_passed -= TIME_TO_REFILL_ENERGY;
        time_spent += TIME_TO_REFILL_ENERGY;
    }

    if self.energy >= MAX_ENERGY {
        self.last_login = current_timestamp;
    } else {
        self.last_login += time_spent;
    }

    Ok(())
}
```

## Js client

### Subscribe to account updates

It is possible to subscribe to account updates via a websocket. This get updates to this account pushed directly back to the client without the need to poll this data. This allows fast gameplay because the updates usually arrive after around 500ms.

```js
useEffect(() => {
    if (!publicKey) {
        return;
    }
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('player', 'utf8'), publicKey.toBuffer()],
        new PublicKey(ExtensionNft_PROGRAM_ID),
    );
    try {
        program.account.playerData.fetch(pda).then(data => {
            setGameState(data);
        });
    } catch (e) {
        window.alert('No player data found, please init!');
    }

    connection.onAccountChange(pda, account => {
        setGameState(program.coder.accounts.decode('playerData', account.data));
    });
}, [publicKey]);
```

### Calculate energy and show countdown

In the java script client we can then perform the same logic and show a countdown timer for the player so that he knows when the next energy will be available:

```js
const interval = setInterval(async () => {
    if (gameState == null || gameState.lastLogin == undefined || gameState.energy >= 10) {
        return;
    }

    const lastLoginTime = gameState.lastLogin * 1000;
    const currentTime = Date.now();
    const timePassed = (currentTime - lastLoginTime) / 1000;

    while (timePassed > TIME_TO_REFILL_ENERGY && gameState.energy < MAX_ENERGY) {
        gameState.energy++;
        gameState.lastLogin += TIME_TO_REFILL_ENERGY;
        timePassed -= TIME_TO_REFILL_ENERGY;
    }

    setTimePassed(timePassed);

    const nextEnergyIn = Math.floor(TIME_TO_REFILL_ENERGY - timePassed);
    setEnergyNextIn(nextEnergyIn > 0 ? nextEnergyIn : 0);
    }, 1000);

    return () => clearInterval(interval);
}, [gameState, timePassed]);

...

{(gameState && <div className="flex flex-col items-center">
    {("Wood: " + gameState.wood + " Energy: " + gameState.energy + " Next energy in: " + nextEnergyIn )}
</div>)}

```

## Unity client

In the Unity client everything interesting happens in the AnchorService.
To generate the client code you can follow the instructions here: https://solanacookbook.com/gaming/porting-anchor-to-unity.html#generating-the-client

```bash
cd program
dotnet tool install Solana.Unity.Anchor.Tool <- run once
dotnet anchorgen -i target/idl/extension_nft.json -o target/idl/ExtensionNft.cs
```

### Session keys

Session keys is an optional component. What it does is creating a local key pair which is toped up with some sol which can be used to autoapprove transactions. The session token is only allowed on certain functions of the program and has an expiry of 23 hours. Then the player will get the sol back and can create a new session.

With this you can now build any energy based game and even if someone builds a bot for the game the most he can do is play optimally, which maybe even easier to achieve when playing normally depending on the logic of your game.

This game becomes even better when combined with the Token example from Solana Cookbook and you actually drop some spl token to the players.
