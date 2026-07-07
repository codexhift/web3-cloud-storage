// ═══════════════════════════════════════════════
// CLD Web3 Module — Wallet, Contract, SIWE, Events
// ═══════════════════════════════════════════════

let provider, signer, contract;
let userAddress = '';
let authToken = '';

function getNativeCurrency() {
    return CONFIG.NETWORK.nativeCurrency || CONFIG.NETWORK.currency || {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18
    };
}

async function ensureConfiguredNetwork() {
    const chainId = String(CONFIG.NETWORK.chainId);

    try {
        console.log('Switching to chain:', chainId);
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId }]
        });
    } catch (switchError) {
        console.warn('Switch chain error:', switchError);
        if (switchError.code !== 4902 && switchError.code !== -32603) throw switchError;

        console.log('Adding chain:', chainId);
        const nativeCurrency = getNativeCurrency();
        await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId,
                chainName: CONFIG.NETWORK.chainName,
                rpcUrls: [CONFIG.NETWORK.rpcUrl],
                nativeCurrency: {
                    name: nativeCurrency.name || 'Ether',
                    symbol: nativeCurrency.symbol || 'ETH',
                    decimals: Number(nativeCurrency.decimals || 18)
                }
            }]
        });
    }
}

// ─── Connect Wallet ─────────────────────────────
async function connectWallet() {
    if (!window.ethereum) throw new Error('MetaMask not found');

    await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureConfiguredNetwork();

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    contract = new ethers.Contract(CONFIG.CONTRACT.address, CONFIG.CONTRACT.abi, signer);

    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(CONFIG.NETWORK.chainId)) {
        throw new Error(`Wrong network. Expected ${CONFIG.NETWORK.chainName}, got chain ${network.chainId}.`);
    }

    const code = await provider.getCode(CONFIG.CONTRACT.address);
    if (code === '0x') {
        throw new Error(`Contract not found on ${CONFIG.NETWORK.chainName}. Restart Hardhat and run npm run deploy.`);
    }

    // Auto SIWE after connect
    try {
        await signInWithEthereum();
    } catch (e) {
        console.warn('SIWE skipped:', e.message);
    }

    return userAddress;
}

// ─── SIWE Authentication ────────────────────────
async function signInWithEthereum() {
    // Request nonce from server
    const nonceResp = await fetch(CONFIG.SERVER.url + '/api/auth/nonce');
    const { nonce } = await nonceResp.json();

    const message = [
        'Sign in to CLD Cloud Storage',
        '',
        'This request will not trigger a blockchain transaction.',
        '',
        'Wallet: ' + userAddress,
        'Nonce: ' + nonce,
        'Issued At: ' + new Date().toISOString()
    ].join('\n');

    const signature = await signer.signMessage(message);

    const verifyResp = await fetch(CONFIG.SERVER.url + '/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: userAddress, message, signature })
    });

    const result = await verifyResp.json();
    if (!verifyResp.ok) throw new Error(result.error || 'SIWE verification failed');

    authToken = result.token;
    console.log('🔐 SIWE authenticated');
    return authToken;
}

function getAuthHeaders() {
    const headers = {};
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    return headers;
}

// ─── Network & Balance ──────────────────────────
async function getNetworkName() {
    const network = await provider.getNetwork();
    return CONFIG.NETWORK.chainName || 'Chain ' + network.chainId;
}

async function getBalance() {
    const balance = await provider.getBalance(userAddress);
    return ethers.formatEther(balance);
}

async function getWalletSummary() {
    if (!provider || !userAddress) throw new Error('Wallet not connected');
    const [network, balance, code] = await Promise.all([
        provider.getNetwork(),
        provider.getBalance(userAddress),
        provider.getCode(CONFIG.CONTRACT.address)
    ]);

    return {
        address: userAddress,
        shortAddress: userAddress.substring(0, 6) + '...' + userAddress.substring(38),
        balance: ethers.formatEther(balance),
        networkName: CONFIG.NETWORK.chainName || 'Chain ' + network.chainId,
        chainId: network.chainId.toString(),
        rpcUrl: CONFIG.NETWORK.rpcUrl,
        contractAddress: CONFIG.CONTRACT.address,
        contractReady: code !== '0x'
    };
}

// ─── Contract: Upload ───────────────────────────
async function uploadFileOnChain(fileId, ipfsHash, fileName, fileSize, isEncrypted, folderName) {
    if (!contract) throw new Error('Wallet not connected');
    await ensureConfiguredNetwork();
    const tx = await contract.uploadFile(fileId, ipfsHash || '', fileName, fileSize, isEncrypted || false, folderName || '');
    await tx.wait();
    return tx.hash;
}

// ─── Contract: Get Files ────────────────────────
async function getFilesFromChain() {
    if (!contract) throw new Error('Wallet not connected');
    const files = await contract.getMyFiles();
    return files.map((file, index) => ({
        index,
        fileId: file.fileId,
        ipfsHash: file.ipfsHash || '',
        fileName: file.fileName,
        fileSize: Number(file.fileSize),
        uploadTime: Number(file.uploadTime) * 1000,
        owner: file.owner,
        isEncrypted: file.isEncrypted || false,
        folderName: file.folderName || ''
    }));
}

async function getSharedFilesFromChain() {
    if (!contract) throw new Error('Wallet not connected');
    const files = await contract.getFilesSharedWithMe();
    return files.map(file => ({
        index: null,
        fileId: file.fileId,
        ipfsHash: file.ipfsHash || '',
        fileName: file.fileName,
        fileSize: Number(file.fileSize),
        uploadTime: Number(file.uploadTime) * 1000,
        owner: file.owner,
        isEncrypted: file.isEncrypted || false,
        folderName: file.folderName || '',
        isShared: true
    }));
}

async function getFoldersFromChain() {
    if (!contract) throw new Error('Wallet not connected');
    return await contract.getMyFolders();
}

async function createFolderOnChain(folderName) {
    if (!contract) throw new Error('Wallet not connected');
    const tx = await contract.createFolder(folderName);
    await tx.wait();
    return tx.hash;
}

async function shareFileOnChain(fileId, recipient) {
    if (!contract) throw new Error('Wallet not connected');
    if (!ethers.isAddress(recipient)) throw new Error('Invalid wallet address');
    const tx = await contract.shareFile(fileId, recipient);
    await tx.wait();
    return tx.hash;
}

// ─── Contract: Delete ───────────────────────────
async function deleteFileOnChain(fileId) {
    if (!contract) throw new Error('Wallet not connected');
    const tx = await contract.deleteFile(fileId);
    await tx.wait();
    return tx.hash;
}

// ─── Contract: Rename ───────────────────────────
async function renameFileOnChain(fileId, newName) {
    if (!contract) throw new Error('Wallet not connected');
    const tx = await contract.renameFile(fileId, newName);
    await tx.wait();
    return tx.hash;
}

async function moveFileToFolderOnChain(fileId, folderName) {
    if (!contract) throw new Error('Wallet not connected');
    const tx = await contract.moveFileToFolder(fileId, folderName || '');
    await tx.wait();
    return tx.hash;
}

// ─── Contract: Get File Count ───────────────────
async function getFileCount() {
    if (!contract) throw new Error('Wallet not connected');
    const count = await contract.getFileCount();
    return Number(count);
}

// ─── Blockchain Activity Log ────────────────────
async function getActivityLog() {
    if (!contract) return [];

    try {
        const events = [];

        // Query FileUploaded events
        const uploadFilter = contract.filters.FileUploaded(userAddress);
        const uploadEvents = await contract.queryFilter(uploadFilter);
        for (const e of uploadEvents) {
            events.push({
                type: 'upload',
                label: 'File Uploaded',
                fileName: e.args[3],
                fileId: e.args[1],
                ipfsHash: e.args[2] || '',
                fileSize: Number(e.args[4]),
                isEncrypted: e.args[6] || false,
                folderName: e.args[7] || '',
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: Number(e.args[5]) * 1000
            });
        }

        // Query FileDeleted events
        const deleteFilter = contract.filters.FileDeleted(userAddress);
        const deleteEvents = await contract.queryFilter(deleteFilter);
        for (const e of deleteEvents) {
            const block = await provider.getBlock(e.blockNumber);
            events.push({
                type: 'delete',
                label: 'File Deleted',
                fileName: '',
                fileId: e.args[1],
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: block ? block.timestamp * 1000 : Date.now()
            });
        }

        // Query FileRenamed events
        const renameFilter = contract.filters.FileRenamed(userAddress);
        const renameEvents = await contract.queryFilter(renameFilter);
        for (const e of renameEvents) {
            const block = await provider.getBlock(e.blockNumber);
            events.push({
                type: 'rename',
                label: 'File Renamed',
                fileId: e.args[1],
                fileName: e.args[2] + ' → ' + e.args[3],
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: block ? block.timestamp * 1000 : Date.now()
            });
        }

        const shareFilter = contract.filters.FileShared(userAddress);
        const shareEvents = await contract.queryFilter(shareFilter);
        for (const e of shareEvents) {
            const block = await provider.getBlock(e.blockNumber);
            events.push({
                type: 'share',
                label: 'File Shared',
                fileName: e.args[3],
                fileId: e.args[2],
                recipient: e.args[1],
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: block ? block.timestamp * 1000 : Date.now()
            });
        }

        const moveFilter = contract.filters.FileMoved(userAddress);
        const moveEvents = await contract.queryFilter(moveFilter);
        for (const e of moveEvents) {
            const block = await provider.getBlock(e.blockNumber);
            events.push({
                type: 'folder',
                label: 'File Moved',
                fileName: (e.args[2] || 'Home') + ' → ' + (e.args[3] || 'Home'),
                fileId: e.args[1],
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: block ? block.timestamp * 1000 : Date.now()
            });
        }

        const folderFilter = contract.filters.FolderCreated(userAddress);
        const folderEvents = await contract.queryFilter(folderFilter);
        for (const e of folderEvents) {
            const block = await provider.getBlock(e.blockNumber);
            events.push({
                type: 'folder',
                label: 'Folder Created',
                fileName: e.args[1],
                blockNumber: e.blockNumber,
                txHash: e.transactionHash,
                timestamp: block ? block.timestamp * 1000 : Date.now()
            });
        }

        // Sort by block number descending (newest first)
        events.sort((a, b) => b.blockNumber - a.blockNumber);
        return events;
    } catch (error) {
        console.error('Activity log error:', error);
        return [];
    }
}

// ─── Wallet Listeners ───────────────────────────
function setupWalletListeners(onChainChanged, onAccountChanged) {
    if (!window.ethereum) return;
    window.ethereum.on('chainChanged', onChainChanged);
    window.ethereum.on('accountsChanged', onAccountChanged);
}
