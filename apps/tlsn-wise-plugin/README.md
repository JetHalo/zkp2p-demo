# tlsn-wise-plugin

This folder is a local scaffold to build a Wise-specific TLSNotary plugin artifact (`wise.plugin.wasm`) that your existing `proof-plugin` can call.

## Why this folder exists

- You already have one Railway verifier service (`apps/tlsn-verifier`).
- What is missing is a browser-side attestation generator plugin artifact.
- This folder standardizes that artifact build flow so you do not need to manually assemble files each time.

## What you do here

1. Pull official TLSNotary boilerplate
2. Apply Wise-oriented config
3. Build plugin wasm
4. Publish/copy wasm URL into your app flow

## Quick start

```bash
cd /Users/jethalo/projects/zkp2p/apps/tlsn-wise-plugin
bash ./scripts/bootstrap-boilerplate.sh
```

After bootstrap:

1. Open `wise-plugin-config.example.json`
2. Fill actual Wise API patterns/selectors you want to attest
3. Build with upstream boilerplate instructions
4. Output `wise.plugin.wasm`

## Output usage

Your frontend/startProof payload field:

```ts
tlsnPluginUrl: "<URL to wise.plugin.wasm>"
```

Your Railway verifier remains unchanged:

```text
https://tlsnotary-production.up.railway.app/verify-wise-attestation
```

## Notes

- This folder does not replace your verifier service.
- This folder is only for browser-side plugin artifact generation.
- If you later decide to bundle wasm directly into `apps/proof-plugin`, you can skip remote URL hosting.
