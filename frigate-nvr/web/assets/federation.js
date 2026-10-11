// Federation UI Client (Disabled in Standalone Deployment)
document.addEventListener('DOMContentLoaded', () => {
  const importBox = document.getElementById('federationImportBox');
  const selFederatedPeers = document.getElementById('selFederatedPeers');
  if (!importBox || !selFederatedPeers) {
    // Federation UI elements not present in DOM; safely exit
    return;
  }
});
