const STORAGE_KEY = "zkp2p.plugin.session";

export async function loadSession() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (
    result[STORAGE_KEY] || {
      activeProofId: null,
      sessions: {}
    }
  );
}

export async function saveSession(sessionRoot) {
  await chrome.storage.session.set({ [STORAGE_KEY]: sessionRoot });
}

export async function patchSession(proofId, patch) {
  const root = await loadSession();
  const current = root.sessions[proofId] || {};
  root.sessions[proofId] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  root.activeProofId = proofId;
  await saveSession(root);
  return root.sessions[proofId];
}

export async function getProofSession(proofId) {
  const root = await loadSession();
  return root.sessions[proofId] || null;
}

export async function resetProofSession(proofId) {
  const root = await loadSession();
  if (root.sessions[proofId]) {
    delete root.sessions[proofId];
    if (root.activeProofId === proofId) {
      root.activeProofId = null;
    }
    await saveSession(root);
  }
}
