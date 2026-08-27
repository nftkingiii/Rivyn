import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BrowserProvider, Contract, getAddress, isAddress, parseEther } from 'ethers';
import { CREDITCOIN, ESCROW_ABI, SEPOLIA, SOURCE_APPROVAL_ABI, type ChainConfig } from './chains.js';
import {
  randomInvoiceId,
  shortAddress,
  validateAddress,
  validateAmount,
  validateBytes32,
  validateTxHash,
} from './validation.js';

type Tab = 'overview' | 'fund' | 'approve' | 'prove';
type ActionState = { kind: 'idle' | 'pending' | 'success' | 'error'; message: string; hash?: string; explorer?: string };
type FormErrors = Record<string, string>;

const proofApi = (import.meta.env.VITE_PROOF_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const sourceContract = import.meta.env.VITE_SOURCE_APPROVAL_CONTRACT ?? '';
const escrowContract = import.meta.env.VITE_ESCROW_CONTRACT ?? '';

function isConfiguredAddress(value: string) {
  return isAddress(value) && getAddress(value) !== '0x0000000000000000000000000000000000000000';
}

function expiryDefault() {
  const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function friendlyError(error: unknown) {
  const candidate = error as { code?: number | string; shortMessage?: string; message?: string };
  if (candidate?.code === 4001 || candidate?.code === 'ACTION_REJECTED') return 'Wallet request rejected.';
  const message = candidate?.shortMessage ?? candidate?.message ?? 'The request could not be completed.';
  return message.replace(/^Error:\s*/i, '').slice(0, 220);
}

function Icon({ name }: { name: 'wallet' | 'shield' | 'arrow' | 'copy' | 'check' | 'bolt' }) {
  const paths: Record<typeof name, ReactNode> = {
    wallet: <><path d="M4 7.5h14a2 2 0 0 1 2 2v8.5H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h11v4.5"/><path d="M15 11h6v4h-6a2 2 0 1 1 0-4Z"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ProofField() {
  return (
    <div className="proof-field" aria-label="Ethereum Sepolia approval is verified by Attestcoin before Creditcoin settlement">
      <div className="proof-grid" />
      <div className="chain-node node-sepolia">
        <span className="node-mark">Ξ</span>
        <span>Sepolia</span>
        <small>buyer approval</small>
      </div>
      <svg className="proof-path" viewBox="0 0 620 390" role="img" aria-label="Attested proof path from Sepolia to Creditcoin">
        <defs>
          <linearGradient id="signal" x1="0" x2="1">
            <stop offset="0" stopColor="#4c6a3d" stopOpacity=".2" />
            <stop offset=".48" stopColor="#b7ff45" />
            <stop offset="1" stopColor="#3cff8f" stopOpacity=".35" />
          </linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path className="path-shadow" d="M120 91 C260 50 300 326 495 280" />
        <path className="path-line" d="M120 91 C260 50 300 326 495 280" />
        {Array.from({ length: 28 }, (_, index) => {
          const x = 214 + (index % 7) * 28;
          const y = 125 + Math.floor(index / 7) * 28;
          const hidden = index === 10 || index === 17;
          return <circle key={index} cx={x} cy={y} r={hidden ? 0 : 2.4} fill="#b7ff45" opacity={0.35 + (index % 4) * 0.14} />;
        })}
        <circle className="signal-dot" cx="309" cy="204" r="7" fill="#b7ff45" filter="url(#glow)" />
      </svg>
      <div className="attest-core">
        <span className="core-ring"><span /></span>
        <strong>Attestcoin</strong>
        <small>inclusion + continuity</small>
      </div>
      <div className="chain-node node-creditcoin">
        <span className="node-mark">C</span>
        <span>Creditcoin</span>
        <small>escrow release</small>
      </div>
      <div className="field-status"><span /> Proof path enforced on-chain</div>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field-message" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function ActionNotice({ state }: { state: ActionState }) {
  if (state.kind === 'idle') return null;
  return (
    <div className={`action-notice notice-${state.kind}`} role={state.kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-symbol">{state.kind === 'pending' ? <span className="spinner" /> : state.kind === 'success' ? <Icon name="check" /> : '!'}</span>
      <div><strong>{state.kind === 'pending' ? 'Wallet action in progress' : state.kind === 'success' ? 'Transaction confirmed' : 'Action blocked'}</strong><p>{state.message}</p></div>
      {state.hash && state.explorer ? <a href={`${state.explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer">View transaction <Icon name="arrow" /></a> : null}
    </div>
  );
}

function StepRail({ active }: { active: Tab }) {
  const steps = [
    { id: 'fund', number: '01', title: 'Lock settlement', text: 'A funder creates the invoice escrow on Creditcoin.' },
    { id: 'approve', number: '02', title: 'Approve terms', text: 'The buyer confirms the same invoice on Sepolia.' },
    { id: 'prove', number: '03', title: 'Prove + release', text: 'Attestcoin verifies the source receipt before payout.' },
  ];
  return <ol className="step-rail">{steps.map((step) => <li key={step.id} className={active === step.id ? 'active' : ''}><span>{step.number}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>)}</ol>;
}

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletAction, setWalletAction] = useState<ActionState>({ kind: 'idle', message: '' });
  const [action, setAction] = useState<ActionState>({ kind: 'idle', message: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [copied, setCopied] = useState(false);
  const walletAreaRef = useRef<HTMLDivElement>(null);

  const [fund, setFund] = useState({ invoiceId: '', buyer: '', payee: '', amount: '', expiry: expiryDefault() });
  const [approval, setApproval] = useState({ invoiceId: '', payee: '', amount: '' });
  const [proof, setProof] = useState({ invoiceId: '', txHash: '', buyer: '', payee: '', amount: '' });

  const contractsReady = isConfiguredAddress(sourceContract) && isConfiguredAddress(escrowContract);
  const activeChain = chainId === SEPOLIA.id ? SEPOLIA : chainId === CREDITCOIN.id ? CREDITCOIN : null;
  const requiredChain = tab === 'approve' ? SEPOLIA : CREDITCOIN;
  const walletNeedsSwitch = Boolean(account && requiredChain && chainId !== requiredChain.id);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const sync = async () => {
      const [accounts, chain] = await Promise.all([
        ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>,
        ethereum.request({ method: 'eth_chainId' }) as Promise<string>,
      ]);
      setAccount(accounts[0] ?? '');
      setChainId(Number.parseInt(chain, 16));
    };
    const onAccounts = (...args: unknown[]) => setAccount(((args[0] as string[]) ?? [])[0] ?? '');
    const onChain = (...args: unknown[]) => setChainId(Number.parseInt(args[0] as string, 16));
    void sync();
    ethereum.on?.('accountsChanged', onAccounts);
    ethereum.on?.('chainChanged', onChain);
    return () => {
      ethereum.removeListener?.('accountsChanged', onAccounts);
      ethereum.removeListener?.('chainChanged', onChain);
    };
  }, []);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!walletAreaRef.current?.contains(event.target as Node)) setWalletMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWalletMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [walletMenuOpen]);

  const routeStatus = useMemo(() => [
    { label: 'Source registry', value: isConfiguredAddress(sourceContract) ? shortAddress(sourceContract) : 'Not deployed', ready: isConfiguredAddress(sourceContract) },
    { label: 'CC3 escrow', value: isConfiguredAddress(escrowContract) ? shortAddress(escrowContract) : 'Not deployed', ready: isConfiguredAddress(escrowContract) },
    { label: 'Proof API', value: proofApi.replace(/^https?:\/\//, ''), ready: true },
  ], []);

  async function connectWallet() {
    if (!window.ethereum) {
      setWalletAction({ kind: 'error', message: 'Install an EIP-1193 wallet such as MetaMask to continue.' });
      return;
    }
    setWalletBusy(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      setAccount(accounts[0] ?? '');
      if (requiredChain) {
        await ensureChain(requiredChain);
      } else {
        const chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
        setChainId(Number.parseInt(chain, 16));
      }
      setAction({ kind: 'idle', message: '' });
      setWalletAction({ kind: 'idle', message: '' });
    } catch (error) {
      setWalletAction({ kind: 'error', message: friendlyError(error) });
    } finally {
      setWalletBusy(false);
    }
  }

  async function ensureChain(chain: ChainConfig) {
    if (!window.ethereum) throw new Error('Wallet provider unavailable.');
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hexId }] });
    } catch (error) {
      const candidate = error as { code?: number; message?: string; data?: { originalError?: { code?: number; message?: string } } };
      const code = candidate.code ?? candidate.data?.originalError?.code;
      const message = `${candidate.message ?? ''} ${candidate.data?.originalError?.message ?? ''}`;
      const chainIsMissing = code === 4902 || /(?:unrecognized|unknown|not added).{0,30}chain|chain.{0,30}(?:unrecognized|unknown|not added)/i.test(message);
      if (!chainIsMissing) throw error;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: chain.hexId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls, blockExplorerUrls: [chain.explorer] }],
      });
    }
    setChainId(chain.id);
  }

  async function signerFor(chain: ChainConfig) {
    if (!account) throw new Error('Connect a wallet first.');
    await ensureChain(chain);
    const provider = new BrowserProvider(window.ethereum!);
    return provider.getSigner();
  }

  async function switchToRequiredChain() {
    if (!requiredChain) return;
    setWalletBusy(true);
    setWalletAction({ kind: 'pending', message: `Requesting ${requiredChain.name} in your wallet…` });
    try {
      await ensureChain(requiredChain);
      setWalletAction({ kind: 'idle', message: '' });
    } catch (error) {
      setWalletAction({ kind: 'error', message: friendlyError(error) });
    } finally {
      setWalletBusy(false);
    }
  }

  function requireDeployment() {
    if (!contractsReady) {
      setAction({ kind: 'error', message: 'Contracts are not deployed yet. Configure both public contract addresses before transacting.' });
      return false;
    }
    return true;
  }

  function validateCommon(values: { invoiceId: string; payee: string; amount: string; buyer?: string; txHash?: string }) {
    const next: FormErrors = {
      invoiceId: validateBytes32(values.invoiceId),
      payee: validateAddress(values.payee, 'Payee'),
      amount: validateAmount(values.amount),
    };
    if (values.buyer !== undefined) next.buyer = validateAddress(values.buyer, 'Buyer');
    if (values.txHash !== undefined) next.txHash = validateTxHash(values.txHash);
    setErrors(next);
    return !Object.values(next).some(Boolean);
  }

  async function submitFund(event: FormEvent) {
    event.preventDefault();
    const expirySeconds = Math.floor(new Date(fund.expiry).getTime() / 1000);
    const valid = validateCommon(fund);
    if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= Date.now() / 1000) {
      setErrors((current) => ({ ...current, expiry: 'Choose a future expiry time.' }));
      return;
    }
    if (!valid || !requireDeployment()) return;
    setAction({ kind: 'pending', message: 'Switching to Creditcoin Testnet and requesting escrow funding…' });
    try {
      const signer = await signerFor(CREDITCOIN);
      const contract = new Contract(escrowContract, ESCROW_ABI, signer);
      const tx = await contract.getFunction('fundInvoice')(fund.invoiceId.trim(), fund.buyer.trim(), fund.payee.trim(), expirySeconds, { value: parseEther(fund.amount.trim()) });
      setAction({ kind: 'pending', message: 'Funding submitted. Waiting for Creditcoin confirmation…', hash: tx.hash, explorer: CREDITCOIN.explorer });
      await tx.wait();
      setAction({ kind: 'success', message: 'Invoice escrow is funded on Creditcoin. The buyer can now approve the exact terms on Sepolia.', hash: tx.hash, explorer: CREDITCOIN.explorer });
    } catch (error) {
      setAction({ kind: 'error', message: friendlyError(error) });
    }
  }

  async function submitApproval(event: FormEvent) {
    event.preventDefault();
    if (!validateCommon(approval) || !requireDeployment()) return;
    setAction({ kind: 'pending', message: 'Switching to Sepolia and requesting buyer approval…' });
    try {
      const signer = await signerFor(SEPOLIA);
      const contract = new Contract(sourceContract, SOURCE_APPROVAL_ABI, signer);
      const tx = await contract.getFunction('approveInvoice')(approval.invoiceId.trim(), approval.payee.trim(), parseEther(approval.amount.trim()));
      setAction({ kind: 'pending', message: 'Approval submitted. Waiting for Sepolia confirmation…', hash: tx.hash, explorer: SEPOLIA.explorer });
      await tx.wait();
      setProof((current) => ({ ...current, invoiceId: approval.invoiceId, txHash: tx.hash, buyer: account, payee: approval.payee, amount: approval.amount }));
      setAction({ kind: 'success', message: 'Buyer approval is confirmed on Sepolia. Continue to Prove + release after the block is attested.', hash: tx.hash, explorer: SEPOLIA.explorer });
    } catch (error) {
      setAction({ kind: 'error', message: friendlyError(error) });
    }
  }

  async function submitProof(event: FormEvent) {
    event.preventDefault();
    if (!validateCommon(proof) || !requireDeployment()) return;
    setAction({ kind: 'pending', message: 'Checking the Sepolia receipt and requesting its Attestcoin proof…' });
    try {
      const response = await fetch(`${proofApi}/v1/proofs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txHash: proof.txHash.trim(), invoiceId: proof.invoiceId.trim(), buyer: proof.buyer.trim(), payee: proof.payee.trim(), amount: parseEther(proof.amount.trim()).toString(),
        }),
      });
      const payload = await response.json() as { error?: { message?: string }; releaseCall?: Record<string, unknown> };
      if (!response.ok || !payload.releaseCall) throw new Error(payload.error?.message ?? 'Proof service rejected the request.');
      setAction({ kind: 'pending', message: 'Proof ready. Switching to Creditcoin for verified release…' });
      const signer = await signerFor(CREDITCOIN);
      const release = payload.releaseCall as {
        invoiceId: string; chainKey: number; blockHeight: number; encodedTransaction: string; merkleRoot: string;
        siblings: Array<{ hash: string; isLeft: boolean }>; lowerEndpointDigest: string; continuityRoots: string[];
      };
      const contract = new Contract(escrowContract, ESCROW_ABI, signer);
      const tx = await contract.getFunction('releaseWithProof')(release.invoiceId, release.chainKey, release.blockHeight, release.encodedTransaction, release.merkleRoot, release.siblings, release.lowerEndpointDigest, release.continuityRoots);
      setAction({ kind: 'pending', message: 'Release submitted. Waiting for Creditcoin verification and settlement…', hash: tx.hash, explorer: CREDITCOIN.explorer });
      await tx.wait();
      setAction({ kind: 'success', message: 'Attestcoin proof verified and the invoice escrow was released to the payee.', hash: tx.hash, explorer: CREDITCOIN.explorer });
    } catch (error) {
      setAction({ kind: 'error', message: friendlyError(error) });
    }
  }

  function changeTab(next: Tab) {
    setTab(next);
    setWalletMenuOpen(false);
    setErrors({});
    setAction({ kind: 'idle', message: '' });
  }

  function disconnectWallet() {
    setAccount('');
    setWalletMenuOpen(false);
    setAction({ kind: 'idle', message: '' });
    setWalletAction({ kind: 'idle', message: '' });
  }

  async function copyInvoiceId(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="site-frame">
      <header className="app-header">
        <button className="brand" onClick={() => changeTab('overview')} aria-label="Open Rivyn overview">
          <span className="brand-mark"><span /></span><span>Rivyn</span>
        </button>
        <nav className="top-nav" aria-label="Primary navigation">
          {(['overview', 'fund', 'approve', 'prove'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => changeTab(item)}>{item === 'prove' ? 'Prove + release' : item}</button>)}
        </nav>
        <div className="wallet-area" ref={walletAreaRef}>
          {account && !walletNeedsSwitch ? <span className="network-pill"><i className={activeChain ? 'online' : 'warning'} />{activeChain?.shortName ?? 'Unsupported network'}</span> : null}
          <button
            className={`wallet-button ${walletNeedsSwitch ? 'network-switch' : ''}`}
            onClick={() => void (walletNeedsSwitch ? switchToRequiredChain() : account ? setWalletMenuOpen((open) => !open) : connectWallet())}
            disabled={walletBusy}
            aria-expanded={account && !walletNeedsSwitch ? walletMenuOpen : undefined}
            aria-haspopup={account && !walletNeedsSwitch ? 'menu' : undefined}
            aria-controls={account && !walletNeedsSwitch ? 'wallet-menu' : undefined}
          >
            <Icon name={walletNeedsSwitch ? 'bolt' : 'wallet'} />{walletBusy ? (walletNeedsSwitch ? 'Switching…' : 'Connecting…') : walletNeedsSwitch ? `Switch to ${requiredChain?.shortName}` : account ? shortAddress(account) : 'Connect wallet'}
          </button>
          {account && !walletNeedsSwitch && walletMenuOpen ? <div className="wallet-menu" id="wallet-menu" role="menu">
            <div className="wallet-menu-account"><span>Connected account</span><strong>{shortAddress(account)}</strong><small>{activeChain?.name ?? 'Unsupported network'}</small></div>
            <button type="button" role="menuitem" onClick={disconnectWallet}>Disconnect from Rivyn</button>
            <p>Wallet permissions remain managed by your extension.</p>
          </div> : null}
        </div>
      </header>
      {walletAction.kind !== 'idle' ? <div className="wallet-feedback"><ActionNotice state={walletAction} /></div> : null}

      <main>
        {tab === 'overview' ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <h1>Settle the invoice.<br /><span>Prove the approval.</span></h1>
                <p>Rivyn releases Creditcoin escrow only after Attestcoin proves the buyer approved matching terms on Ethereum Sepolia.</p>
                <div className="hero-actions">
                  <button className="button-primary" onClick={() => changeTab('fund')}>Fund an invoice <Icon name="arrow" /></button>
                  <a className="button-secondary" href="https://github.com/nftkingiii/Rivyn" target="_blank" rel="noreferrer">Inspect the code</a>
                </div>
                <div className="hero-facts" aria-label="Architecture facts">
                  <div><strong>2</strong><span>testnet chains</span></div>
                  <div><strong>1</strong><span>verified receipt</span></div>
                  <div><strong>0</strong><span>trusted relayers</span></div>
                </div>
              </div>
              <ProofField />
            </section>

            <section className="system-strip">
              <div className="system-title"><span className="pulse-dot" /><div><strong>{contractsReady ? 'Settlement route ready' : 'Deployment pending'}</strong><p>{contractsReady ? 'Public contract configuration is complete.' : 'The interface is live locally; contract addresses remain unconfigured.'}</p></div></div>
              {routeStatus.map((item) => <div className="system-item" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><i className={item.ready ? 'ready' : 'pending'}>{item.ready ? 'ready' : 'waiting'}</i></div>)}
            </section>

            <section className="mechanism-section">
              <div className="section-heading"><h2>One proof. One release.</h2><p>Every visible state maps to an enforceable contract condition.</p></div>
              <div className="mechanism-grid">
                <div className="mechanism-visual">
                  <span className="corner-label">SETTLEMENT / 001</span>
                  <div className="invoice-sheet"><div className="sheet-head"><span>INVOICE</span><strong>bytes32</strong></div><div className="sheet-line wide"/><div className="sheet-line"/><div className="sheet-line short"/><div className="sheet-seal"><Icon name="shield"/> exact terms</div></div>
                  <div className="scan-line" />
                </div>
                <ol className="mechanism-copy">
                  <li><span>01</span><div><strong>Lock value on Creditcoin</strong><p>The funder fixes the buyer, payee, amount, and expiry in native tCTC escrow.</p></div></li>
                  <li><span>02</span><div><strong>Approve on Sepolia</strong><p>The buyer emits the exact invoice terms from Rivyn’s registered source contract.</p></div></li>
                  <li><span>03</span><div><strong>Verify before payout</strong><p>The Creditcoin contract checks inclusion, receipt success, event origin, terms, and replay state.</p></div></li>
                </ol>
              </div>
            </section>
          </>
        ) : (
          <section className="workspace">
            <div className="workspace-intro">
              <h1>{tab === 'fund' ? 'Fund the settlement.' : tab === 'approve' ? 'Confirm the invoice.' : 'Prove it. Release it.'}</h1>
              <p>{tab === 'fund' ? 'Create the Creditcoin escrow and freeze the exact settlement terms.' : tab === 'approve' ? 'The buyer signs matching terms through the Sepolia registry.' : 'Turn the confirmed Sepolia transaction into an Attestcoin-backed release.'}</p>
            </div>
            <div className="workspace-grid">
              <aside><StepRail active={tab} /><div className="trust-note"><Icon name="shield"/><div><strong>Fail-closed settlement</strong><p>The UI preflights inputs. The Creditcoin contract remains the authority.</p></div></div></aside>
              <div className="form-panel">
                <div className="panel-header"><div><span>{tab === 'fund' ? 'CREDITCOIN / ESCROW' : tab === 'approve' ? 'SEPOLIA / APPROVAL' : 'ATTESTCOIN / PROOF'}</span><h2>{tab === 'fund' ? 'Invoice terms' : tab === 'approve' ? 'Buyer confirmation' : 'Release evidence'}</h2></div><span className="panel-network"><i />{tab === 'approve' ? 'Sepolia' : 'CC3 Testnet'}</span></div>

                {tab === 'fund' ? <form onSubmit={(event) => void submitFund(event)} noValidate>
                  <Field id="fund-invoice" label="Invoice ID" error={errors.invoiceId} hint="A unique 32-byte identifier shared across both chains."><div className="compound-input"><input id="fund-invoice" value={fund.invoiceId} onChange={(event) => setFund({ ...fund, invoiceId: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/><button type="button" onClick={() => setFund({ ...fund, invoiceId: randomInvoiceId() })}>Generate</button><button className="icon-button" type="button" onClick={() => void copyInvoiceId(fund.invoiceId)} aria-label="Copy invoice ID"><Icon name={copied ? 'check' : 'copy'} /></button></div></Field>
                  <div className="field-row"><Field id="fund-buyer" label="Buyer address" error={errors.buyer}><input id="fund-buyer" value={fund.buyer} onChange={(event) => setFund({ ...fund, buyer: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field><Field id="fund-payee" label="Payee address" error={errors.payee}><input id="fund-payee" value={fund.payee} onChange={(event) => setFund({ ...fund, payee: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field></div>
                  <div className="field-row"><Field id="fund-amount" label="Settlement amount" error={errors.amount}><div className="unit-input"><input id="fund-amount" inputMode="decimal" value={fund.amount} onChange={(event) => setFund({ ...fund, amount: event.target.value })} placeholder="0.00"/><span>tCTC</span></div></Field><Field id="fund-expiry" label="Refund becomes available" error={errors.expiry}><input id="fund-expiry" type="datetime-local" value={fund.expiry} onChange={(event) => setFund({ ...fund, expiry: event.target.value })}/></Field></div>
                  <div className="review-bar"><div><span>Irreversible action</span><p>Your wallet will lock the entered tCTC until proof-backed release or expiry refund.</p></div><button className="button-primary" type="submit" disabled={action.kind === 'pending'}>{action.kind === 'pending' ? 'Funding…' : 'Fund invoice'} <Icon name="arrow" /></button></div>
                </form> : null}

                {tab === 'approve' ? <form onSubmit={(event) => void submitApproval(event)} noValidate>
                  <Field id="approve-invoice" label="Invoice ID" error={errors.invoiceId}><input id="approve-invoice" value={approval.invoiceId} onChange={(event) => setApproval({ ...approval, invoiceId: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field>
                  <div className="field-row"><Field id="approve-payee" label="Payee address" error={errors.payee}><input id="approve-payee" value={approval.payee} onChange={(event) => setApproval({ ...approval, payee: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field><Field id="approve-amount" label="Approved amount" error={errors.amount}><div className="unit-input"><input id="approve-amount" inputMode="decimal" value={approval.amount} onChange={(event) => setApproval({ ...approval, amount: event.target.value })} placeholder="0.00"/><span>tCTC</span></div></Field></div>
                  <div className="proof-checklist"><span><Icon name="check"/> Buyer is the connected Sepolia account</span><span><Icon name="check"/> Terms must match the Creditcoin escrow exactly</span><span><Icon name="check"/> Each buyer may approve an invoice ID once</span></div>
                  <div className="review-bar"><div><span>Source-chain action</span><p>This emits the approval event that Attestcoin will later prove.</p></div><button className="button-primary" type="submit" disabled={action.kind === 'pending'}>{action.kind === 'pending' ? 'Approving…' : 'Approve on Sepolia'} <Icon name="arrow" /></button></div>
                </form> : null}

                {tab === 'prove' ? <form onSubmit={(event) => void submitProof(event)} noValidate>
                  <Field id="prove-tx" label="Sepolia approval transaction" error={errors.txHash} hint="The proof service accepts only a mined, successful Rivyn approval."><input id="prove-tx" value={proof.txHash} onChange={(event) => setProof({ ...proof, txHash: event.target.value })} placeholder="0x transaction hash…" spellCheck={false} autoComplete="off"/></Field>
                  <Field id="prove-invoice" label="Invoice ID" error={errors.invoiceId}><input id="prove-invoice" value={proof.invoiceId} onChange={(event) => setProof({ ...proof, invoiceId: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field>
                  <div className="field-row"><Field id="prove-buyer" label="Buyer address" error={errors.buyer}><input id="prove-buyer" value={proof.buyer} onChange={(event) => setProof({ ...proof, buyer: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field><Field id="prove-payee" label="Payee address" error={errors.payee}><input id="prove-payee" value={proof.payee} onChange={(event) => setProof({ ...proof, payee: event.target.value })} placeholder="0x…" spellCheck={false} autoComplete="off"/></Field></div>
                  <Field id="prove-amount" label="Settlement amount" error={errors.amount}><div className="unit-input compact"><input id="prove-amount" inputMode="decimal" value={proof.amount} onChange={(event) => setProof({ ...proof, amount: event.target.value })} placeholder="0.00"/><span>tCTC</span></div></Field>
                  <div className="review-bar"><div><span>Two-part verification</span><p>Merkle inclusion proves the transaction; continuity links its block to Creditcoin.</p></div><button className="button-primary" type="submit" disabled={action.kind === 'pending'}>{action.kind === 'pending' ? 'Verifying…' : 'Build proof + release'} <Icon name="bolt" /></button></div>
                </form> : null}
                <ActionNotice state={action} />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer><div className="footer-brand"><span className="brand-mark"><span /></span><strong>Rivyn</strong><p>Proof-bound invoice settlement on Creditcoin.</p></div><div><span>Networks</span><a href={SEPOLIA.explorer} target="_blank" rel="noreferrer">Ethereum Sepolia</a><a href={CREDITCOIN.explorer} target="_blank" rel="noreferrer">Creditcoin Testnet</a></div><div><span>Evidence</span><a href="https://github.com/nftkingiii/Rivyn" target="_blank" rel="noreferrer">Source repository</a><a href="https://docs.creditcoin.org/attestcoin-protocol" target="_blank" rel="noreferrer">Attestcoin docs</a></div></footer>
    </div>
  );
}
