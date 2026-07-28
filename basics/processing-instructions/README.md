# Custom Instruction Data

Let's take a look at how to pass our own custom instruction data to a program. This data must be _serialized_ to _Berkeley Packet Filter (BPF)_ format - which is what the Solana runtime supports for serialized data.

BPF is exactly why we use `cargo build-sbf` to build Solana programs in Rust. For instructions sent over RPC it's no different. We'll use a library called `borsh` on both client and program side.

---

**For native**, we need to add `borsh` and `borsh-derive` to `Cargo.toml` so we can mark a struct as serializable to/from **BPF format**.

**For Anchor**, you'll see that they've made it quite easy (as in, they do all of the serializing for you).
