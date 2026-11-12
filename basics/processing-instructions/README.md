# Custom Instruction Data

Let's take a look at how to pass our own custom instruction data to a program. The runtime hands a program its instruction data as raw bytes, so client and program must agree on an encoding. We'll use `borsh` on both sides.

---

**For native**, we add `borsh` to `Cargo.toml` and derive `BorshSerialize`/`BorshDeserialize` on the instruction struct.

**For Anchor**, you'll see that they've made it quite easy (as in, they do all of the serializing for you).
