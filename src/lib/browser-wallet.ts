import type { EIP1193Provider } from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

let rememberedProvider: EIP1193Provider | undefined;

export function rememberBrowserWalletProvider(provider: EIP1193Provider) {
  rememberedProvider = provider;
  return provider;
}

export function browserWalletProvider() {
  const provider = rememberedProvider ?? window.ethereum;
  if (!provider) throw new Error("WALLET_NOT_INSTALLED");
  return provider;
}
