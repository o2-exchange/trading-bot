import { Signer, sha256, arrayify } from 'fuels';
import type { B256Address, Address } from 'fuels';
import type { SessionSigner, SignatureInput } from './types';

export class FuelSessionSigner implements SessionSigner {
  private signer: Signer;

  constructor(privateKey?: B256Address) {
    this.signer = FuelSessionSigner.createSigner(privateKey);
  }

  static createSigner(privateKey?: B256Address): Signer {
    if (privateKey) return new Signer(privateKey);
    return new Signer(Signer.generatePrivateKey());
  }

  get address(): Address {
    return this.signer.address;
  }

  /** Returns the private key for persistence / session restoration */
  get privateKey(): string {
    return this.signer.privateKey;
  }

  async sign(data: Uint8Array): Promise<SignatureInput> {
    const signature = this.signer.sign(sha256(data));
    const bytes = Array.from(arrayify(signature));
    return { Secp256k1: { bits: bytes as any } };
  }
}
