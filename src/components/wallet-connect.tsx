"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, WalletCards } from "lucide-react";
import { createPublicClient, createWalletClient, custom, formatEther, parseAbi, type Address, type EIP1193Provider } from "viem";
import { bscTestnet } from "viem/chains";
import { t, type Locale } from "@/lib/i18n";
import { loadBrowserChainConfig } from "@/lib/browser-chain-config";
import { rememberBrowserWalletProvider } from "@/lib/browser-wallet";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnect({ locale }: { locale: Locale }) {
  const [address, setAddress] = useState<Address>();
  const [balance, setBalance] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const providerRef = useRef<EIP1193Provider | undefined>(undefined);

  const syncWallet = useCallback(async (requestAccess: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const chainConfig = await loadBrowserChainConfig().catch(() => undefined);
      const tokenAddress = chainConfig?.contracts.token;
      const walletConnectProjectId = chainConfig?.walletConnectProjectId;
      let provider = providerRef.current ?? window.ethereum;
      if (!provider && requestAccess && walletConnectProjectId) {
        const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
        const walletConnect = await EthereumProvider.init({
          projectId: walletConnectProjectId,
          chains: [bscTestnet.id],
          optionalChains: [56],
          showQrModal: true,
          rpcMap: { [bscTestnet.id]: bscTestnet.rpcUrls.default.http[0] },
          metadata: {
            name: "AgentGrid",
            description: "Stake-gated agent work and maintenance rewards",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon.svg`],
          },
        });
        await walletConnect.connect();
        provider = walletConnect as unknown as EIP1193Provider;
        providerRef.current = provider;
      }
      if (!provider) {
        if (requestAccess) setError(t(locale, "installWallet"));
        return;
      }
      rememberBrowserWalletProvider(provider);
      providerRef.current = provider;
      const transport = custom(provider);
      const wallet = createWalletClient({ chain: bscTestnet, transport });
      const addresses = requestAccess ? await wallet.requestAddresses() : await wallet.getAddresses();
      if (!addresses[0]) {
        setAddress(undefined);
        return;
      }
      const chainId = await wallet.getChainId();
      if (chainId !== bscTestnet.id) {
        try {
          await wallet.switchChain({ id: bscTestnet.id });
        } catch {
          await wallet.addChain({ chain: bscTestnet });
          await wallet.switchChain({ id: bscTestnet.id });
        }
      }
      const connected = addresses[0];
      setAddress(connected);
      const sessionResponse = await fetch("/api/auth/session", { credentials: "same-origin" });
      const sessionBody = await sessionResponse.json() as { session?: { address?: string } | null };
      let sessionMatches = sessionBody.session?.address?.toLowerCase() === connected.toLowerCase();
      if (requestAccess && !sessionMatches) {
        const challengeResponse = await fetch("/api/auth/nonce", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: connected }),
        });
        if (!challengeResponse.ok) throw new Error("Unable to create wallet challenge");
        const challenge = await challengeResponse.json() as { nonce: string; message: string };
        const signature = await wallet.signMessage({ account: connected, message: challenge.message });
        const verifyResponse = await fetch("/api/auth/verify", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: connected, nonce: challenge.nonce, message: challenge.message, signature }),
        });
        if (!verifyResponse.ok) throw new Error("Wallet signature verification failed");
        sessionMatches = true;
      }
      setVerified(sessionMatches);
      const client = createPublicClient({ chain: bscTestnet, transport });
      if (tokenAddress) {
        const amount = await client.readContract({ address: tokenAddress, abi: balanceAbi, functionName: "balanceOf", args: [connected] });
        setBalance(`${Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 2 })} tAGT`);
      } else {
        const amount = await client.getBalance({ address: connected });
        setBalance(`${Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.split("\n")[0] : "Wallet connection failed");
    } finally {
      setBusy(false);
    }
  }, [locale]);

  useEffect(() => {
    void syncWallet(false);
    const provider = providerRef.current ?? window.ethereum;
    if (!provider?.on) return;
    const refresh = () => void syncWallet(false);
    provider.on("accountsChanged", refresh);
    provider.on("chainChanged", refresh);
    return () => {
      provider.removeListener?.("accountsChanged", refresh);
      provider.removeListener?.("chainChanged", refresh);
    };
  }, [syncWallet]);

  if (error) {
    return (
      <button className="wallet-pill wallet-error" onClick={() => void syncWallet(true)} title={error}>
        <span className="wallet-avatar"><CircleAlert size={14} /></span>
        <span>{t(locale, "walletUnavailable")}</span>
      </button>
    );
  }

  if (!address) {
    return (
      <button className="wallet-pill" onClick={() => void syncWallet(true)} disabled={busy}>
        <span className="wallet-avatar">{busy ? <LoaderCircle className="spin" size={14} /> : <WalletCards size={14} />}</span>
        <span>{busy ? t(locale, "connecting") : t(locale, "connectWallet")}</span>
      </button>
    );
  }

  return (
    <button className="wallet-pill" onClick={() => void syncWallet(true)} title="Connected to BSC Testnet">
      <span className="wallet-avatar"><WalletCards size={14} /></span>
      <span className="wallet-identity"><strong>{shortAddress(address)}</strong><small>{verified ? t(locale, "walletVerified") : balance ?? t(locale, "bscTestnet")}</small></span>
    </button>
  );
}
