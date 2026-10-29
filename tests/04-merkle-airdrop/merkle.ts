import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";

export interface AirdropEntry {
  account: PublicKey;
  amount: BN;
}

export const sha256 = (data: Buffer): Buffer =>
  crypto.createHash("sha256").update(data).digest();

export const hashPair = (a: Buffer, b: Buffer): Buffer => {
  return Buffer.compare(a, b) <= 0
    ? sha256(Buffer.concat([a, b]))
    : sha256(Buffer.concat([b, a]));
};

export const hashLeaf = (entry: AirdropEntry): Buffer => {
  const buf = Buffer.concat([
    entry.account.toBuffer(),
    entry.amount.toArrayLike(Buffer, "le", 8),
  ]);
  return sha256(buf);
};

export class MerkleTree {
  layers: Buffer[][];

  constructor(entries: AirdropEntry[]) {
    const leaves = entries.map(hashLeaf);
    this.layers = [leaves];

    let current = leaves;
    while (current.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(hashPair(current[i], current[i + 1]));
        } else {
          next.push(current[i]);
        }
      }
      current = next;
      this.layers.push(current);
    }
  }

  get root(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): Buffer[] {
    const proof: Buffer[] = [];
    let idx = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRightNode = idx % 2 === 1;
      const pairIndex = isRightNode ? idx - 1 : idx + 1;

      if (pairIndex < layer.length) {
        proof.push(layer[pairIndex]);
      }
      idx = Math.floor(idx / 2);
    }

    return proof;
  }
}
