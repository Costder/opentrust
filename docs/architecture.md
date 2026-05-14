# Architecture

OpenTrust is split into public trust primitives and private payment implementation.

The public repo owns schemas, registry APIs, CLI, badges, frontend, and abstract payment contracts. The private repo owns real Circle/USDC integration, escrow, checkout, and webhook processing.
